import { expect, test } from 'claude-code/testing'
import { sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

const A = '/type-change/.agents/skills'
const C = '/type-change/.claude/skills'

// Unlike a bare Map fake, files cannot also be directories: reading a directory
// throws EISDIR, and writing beneath a file throws ENOTDIR (as on a real disk).
const disk = () => {
  const map = new Map<string, string>([[`${A}/style/SKILL.md`, 'S'], [`${A}/style/z.md`, 'old']])
  const dir = (p: string) => [...map.keys()].some(f => f.startsWith(`${p}/`))
  const fs: Fs = {
    read: async p => {
      if (dir(p)) throw new Error('EISDIR')
      const text = map.get(p)
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    write: async (p, text) => {
      if (dir(p)) throw new Error('EISDIR')
      for (let cut = p.lastIndexOf('/'); cut > 0; cut = p.lastIndexOf('/', cut - 1)) {
        if (map.has(p.slice(0, cut))) throw new Error('ENOTDIR')
      }
      map.set(p, text)
    },
    exists: async p => map.has(p) || dir(p),
    stat: async p => {
      if (!map.has(p) && !dir(p)) throw new Error('ENOENT')
      return { kind: dir(p) ? 'dir' : 'file', realPath: p }
    },
    list: async p => {
      const names = new Set([...map.keys()].filter(f => f.startsWith(`${p}/`)).map(f => f.slice(p.length + 1).split('/')[0]!))
      return [...names].map(name => ({ name, kind: dir(`${p}/${name}`) ? 'dir' as const : 'file' as const }))
    },
  }
  return { fs, map }
}

for (const [before, after, errno] of [['a', 'a/ref.md', 'ENOTDIR'], ['a/ref.md', 'a', 'EISDIR']] as const) {
  test(`a source ${before} becoming ${after} does not freeze the rest of the skill`, async () => {
    const d = disk()
    d.map.set(`${A}/style/${before}`, 'before')
    await sync(d.fs, A, C)
    d.map.delete(`${A}/style/${before}`)
    d.map.set(`${A}/style/${after}`, 'after')
    d.map.set(`${A}/style/z.md`, 'new')
    const result = await sync(d.fs, A, C)
    expect(d.map.get(`${C}/style/z.md`)).toBe('new')
    expect(result.failed.some(f => f.includes(after) && f.includes(errno))).toBe(true)
    // The engine cannot delete the old entry; the conflict remains visible.
    expect(d.map.get(`${C}/style/${before}`)).toBe('before')
    const again = await sync(d.fs, A, C)
    expect(again.copied).toEqual([])
    expect(again.failed.length).toBe(1)
  })
}

test('comparison: an entry keeping its type refreshes without a failure', async () => {
  const d = disk()
  await sync(d.fs, A, C)
  d.map.set(`${A}/style/z.md`, 'new')
  expect((await sync(d.fs, A, C)).failed).toEqual([])
  expect(d.map.get(`${C}/style/z.md`)).toBe('new')
})
