import { expect, test } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

// An in-memory disk: files by absolute path, folders implied by them, and `links` for folders
// that are symbolic links (listed as `other`, stat says `dir`). `writes` logs every write.
const disk = (files: Record<string, string>, links: string[] = []) => {
  const map = new Map(Object.entries(files))
  const writes: string[] = []
  const isFolder = (p: string) => [...map.keys()].some(f => f.startsWith(`${p}/`))
  const fs: Fs = {
    read: async p => {
      const t = map.get(p)
      if (t === undefined) throw new Error(`ENOENT ${p}`)
      return t
    },
    write: async (p, t) => {
      writes.push(p)
      map.set(p, t)
    },
    exists: async p => map.has(p) || isFolder(p),
    stat: async p => ({ kind: isFolder(p) ? 'dir' : 'file' }),
    list: async p => {
      const names = new Set([...map.keys()].filter(f => f.startsWith(`${p}/`)).map(f => f.slice(p.length + 1).split('/')[0]!))
      return [...names].map(name => {
        const full = `${p}/${name}`
        return { name, kind: links.includes(full) ? ('other' as const) : isFolder(full) ? ('dir' as const) : ('file' as const) }
      })
    },
  }
  return { fs, map, writes }
}

const A = '/w/.agents/skills'
const C = '/w/.claude/skills'

test('copies a skill with its nested files, a .gitignore and the mark', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/ref/rules.md`]: 'R' })
  const s = await sync(d.fs, A, C)
  expect(s.copied).toEqual(['style'])
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
  expect(d.map.get(`${C}/style/ref/rules.md`)).toBe('R')
  expect(d.map.get(`${C}/style/.gitignore`)).toBe('*\n')
  expect(d.map.has(`${C}/style/${MARK}`)).toBe(true)
})

test("never writes over the user's own skill of the same name", async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${C}/style/SKILL.md`]: 'mine' })
  const s = await sync(d.fs, A, C)
  expect(s.skipped).toEqual(['style'])
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('mine')
  expect(d.writes).toEqual([])
})

test('comparison: a copy it made earlier is refreshed when the original changed', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${C}/style/SKILL.md`]: 'old', [`${C}/style/${MARK}`]: 'm' })
  const s = await sync(d.fs, A, C)
  expect(s.copied).toEqual(['style'])
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
})

test('an unchanged copy is kept: no write, so no skill reload', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/style/SKILL.md`]: 'S', [`${C}/style/${MARK}`]: 'm' })
  const s = await sync(d.fs, A, C)
  expect(s).toEqual({ copied: [], kept: ['style'], skipped: [] })
  expect(d.writes).toEqual([])
})

test('a changed nested file alone is enough to refresh', async () => {
  const d = disk({
    [`${A}/style/SKILL.md`]: 'S', [`${A}/style/ref/rules.md`]: 'R2',
    [`${C}/style/SKILL.md`]: 'S', [`${C}/style/ref/rules.md`]: 'R1', [`${C}/style/${MARK}`]: 'm',
  })
  expect((await sync(d.fs, A, C)).copied).toEqual(['style'])
  expect(d.map.get(`${C}/style/ref/rules.md`)).toBe('R2')
})

test('look-alikes: a folder without SKILL.md and a loose file are not skills', async () => {
  const d = disk({ [`${A}/notes/README.md`]: 'n', [`${A}/SKILL.md`]: 'loose', [`${A}/style-2/SKILL.md`]: 'S2' })
  const s = await sync(d.fs, A, C)
  expect(s.copied).toEqual(['style-2'])
  expect(d.map.has(`${C}/notes/README.md`)).toBe(false)
})

test('a skill folder that is a symbolic link is followed', async () => {
  const d = disk({ [`${A}/linked/SKILL.md`]: 'L' }, [`${A}/linked`])
  expect((await sync(d.fs, A, C)).copied).toEqual(['linked'])
})

test('no .agents/skills folder: nothing happens', async () => {
  const d = disk({ '/w/README.md': 'x' })
  expect(await sync(d.fs, A, C)).toEqual({ copied: [], kept: [], skipped: [] })
  expect(d.writes).toEqual([])
})

test('two skills, one already the user\'s: the other is still copied', async () => {
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B', [`${C}/a/SKILL.md`]: 'mine' })
  const s = await sync(d.fs, A, C)
  expect(s.skipped).toEqual(['a'])
  expect(s.copied).toEqual(['b'])
})
