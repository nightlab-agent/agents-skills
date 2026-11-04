import { expect, test } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

// Same in-memory disk as sync.test.tsx, plus: `failOn` makes one write reject (a full disk,
// EACCES, the session killed mid-copy), and every op yields so two syncs interleave.
const disk = (files: Record<string, string>, links: string[] = [], failOn?: string) => {
  const map = new Map(Object.entries(files))
  const writes: string[] = []
  const tick = () => new Promise(r => setTimeout(r, 0))
  const isFolder = (p: string) => [...map.keys()].some(f => f.startsWith(`${p}/`))
  const fs: Fs = {
    read: async p => { await tick(); const t = map.get(p); if (t === undefined) throw new Error(`ENOENT ${p}`); return t },
    write: async (p, t) => { await tick(); if (p === failOn) throw new Error(`ENOSPC ${p}`); writes.push(p); map.set(p, t) },
    exists: async p => { await tick(); return map.has(p) || isFolder(p) },
    stat: async p => ({ kind: isFolder(p) ? 'dir' : 'file' }),
    list: async p => {
      await tick()
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

// kind 1: the mark is written last, so a copy cut short is taken for the user's own forever
test('review: a copy cut short after SKILL.md is still refreshed at the next session', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'v1', [`${A}/style/ref/r.md`]: 'R' }, [], `${C}/style/ref/r.md`)
  await sync(d.fs, A, C).catch(() => undefined)
  const next = disk({ ...Object.fromEntries(d.map), [`${A}/style/SKILL.md`]: 'v2' })
  const s = await sync(next.fs, A, C)
  expect(s.skipped).toEqual([])
  expect(next.map.get(`${C}/style/SKILL.md`)).toBe('v2')
})
test('review comparison: a copy that completed is refreshed at the next session', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'v1', [`${A}/style/ref/r.md`]: 'R' })
  await sync(d.fs, A, C)
  const next = disk({ ...Object.fromEntries(d.map), [`${A}/style/SKILL.md`]: 'v2' })
  await sync(next.fs, A, C)
  expect(next.map.get(`${C}/style/SKILL.md`)).toBe('v2')
})

// kind 5: the .gitignore must land before the first private file
test('review: the first write into a new copy is its mark, then its .gitignore', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  await sync(d.fs, A, C)
  expect(d.writes.slice(0, 2)).toEqual([`${C}/style/${MARK}`, `${C}/style/.gitignore`])
})
test('review comparison: the copy carries a .gitignore holding *', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/.gitignore`)).toBe('*\n')
})

// kind 2: the two hooks' runs overlapping on a first copy
test('review: two syncs at once both count the skill, neither calls it the user\'s own', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/a.md`]: 'a', [`${A}/style/b.md`]: 'b' })
  const [x, y] = await Promise.all([sync(d.fs, A, C), sync(d.fs, A, C)])
  expect([...x.skipped, ...y.skipped]).toEqual([])
})
test('review comparison: two syncs one after the other, neither skips', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/a.md`]: 'a', [`${A}/style/b.md`]: 'b' })
  const x = await sync(d.fs, A, C)
  const y = await sync(d.fs, A, C)
  expect([...x.skipped, ...y.skipped]).toEqual([])
})

// kind 4: $.fs.list gives a symbolic link as `other` (claude-code.d.ts:3355); a linked FILE is dropped
test('review: a SKILL.md that is a symbolic link is copied', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, [`${A}/style/SKILL.md`])
  const s = await sync(d.fs, A, C)
  expect(s.copied).toEqual(['style'])
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})
test('review comparison: a SKILL.md that is a plain file is copied', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})

test('review: a second sync starting while the first is mid-copy does not call it the user\'s own', async () => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${A}/style/ref/f${i}.md`, `t${i}`]))
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', ...many })
  const x = sync(d.fs, A, C)
  while (!d.writes.length) await new Promise(r => setTimeout(r, 0))
  const y = await sync(d.fs, A, C)
  expect([...(await x).skipped, ...y.skipped]).toEqual([])
})
