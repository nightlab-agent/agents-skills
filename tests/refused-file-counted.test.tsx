import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

// A skill with one refused file still landed its other files: it counts as copied, so the
// session is told to reload them.

type On = Parameters<TestBody>[1]
const ROOT = '/g4'
const A = `${ROOT}/.agents/skills`
const C = `${ROOT}/.claude/skills`

// The link-aware in-memory disk of tests/review-second-pass.test.tsx.
const disk = (files: Record<string, string>, links: Record<string, string> = {}) => {
  const map = new Map(Object.entries(files))
  const writes: string[] = []
  const real = (path: string): string => {
    for (let i = 0; i < 40; i++) {
      const link = Object.keys(links).find(l => path === l || path.startsWith(`${l}/`))
      if (link === undefined) return path
      path = links[link]! + path.slice(link.length)
    }
    throw new Error('ELOOP')
  }
  const under = (path: string) => [...map.keys(), ...Object.keys(links)].filter(f => f.startsWith(`${path}/`))
  const fs: Fs = {
    read: async path => {
      const text = map.get(real(path))
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    write: async (path, text) => {
      const target = real(path)
      writes.push(target)
      map.set(target, text)
    },
    exists: async path => map.has(real(path)) || under(real(path)).length > 0,
    stat: async path => {
      const target = real(path)
      if (!map.has(target) && !under(target).length) {
        if (path in links) return { kind: 'other' }
        throw new Error('ENOENT')
      }
      return { kind: map.has(target) ? 'file' : 'dir', realPath: target }
    },
    list: async path => {
      const target = real(path)
      const names = new Set(under(target).map(f => f.slice(target.length + 1).split('/')[0]!))
      return [...names].map(name => {
        const full = `${target}/${name}`
        return { name, kind: full in links ? 'other' : map.has(full) ? 'file' : 'dir' }
      })
    },
  }
  return { fs, map, writes }
}

const world = (on: On, d: ReturnType<typeof disk>) => {
  const toasts: string[] = []
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', async (_, e) => ({ value: await d.fs.read(e.path) }))
  on('fs.write', async (_, e) => ({ value: await d.fs.write(e.path, e.text) }))
  on('fs.exists', async (_, e) => ({ value: await d.fs.exists(e.path) }))
  on('fs.list', async (_, e) => ({ value: await d.fs.list(e.path!) as never }))
  on('fs.stat', async (_, e) => ({ value: await d.fs.stat(e.path) as never }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  return toasts
}

// A marked copy whose entry `a` the user turned into a link to a folder outside .claude/skills.
const linked = () => disk(
  { [`${A}/style/SKILL.md`]: 'new', [`${A}/style/a/ref.md`]: 'R', [`${A}/style/z.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [`${C}/style/SKILL.md`]: 'old', [`${C}/style/z.md`]: 'old', [`${ROOT}/elsewhere/keep.md`]: 'K' },
  { [`${C}/style/a`]: `${ROOT}/elsewhere` },
)

// sync() alone has no write guard, that is run()'s: refuse the linked path as it would.
const guarded = (d: ReturnType<typeof disk>) => {
  const write = d.fs.write
  d.fs.write = async (path, text) => {
    if (path.startsWith(`${C}/style/a/`)) throw new Error(`refused to write through a link: ${path}`)
    await write(path, text)
  }
  return d
}

test('a skill with one refused file counts as copied', async () => {
  const d = guarded(linked())
  const s = await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
  expect(d.map.get(`${C}/style/z.md`)).toBe('new')
  expect(d.map.has(`${ROOT}/elsewhere/ref.md`)).toBe(false)
  expect(s.failed.length).toBe(1)
  expect(s.copied.length + s.kept.length).toBe(1)
})

test('classic SessionStart asks for a reload after refreshing a skill with one refused file', async ($, on) => {
  const d = linked()
  const toasts = world(on, d)
  const r = (await $.classic.SessionStart({ source: 'startup' } as never)) as { reloadSkills?: boolean }
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
  expect(toasts.some(t => t.includes('refused to write through a link'))).toBe(true)
  expect(r?.reloadSkills).toBe(true)
})

test('the same skill with a type conflict instead of a link is counted and reloaded', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${A}/style/a/ref.md`]: 'R', [`${A}/style/z.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [`${C}/style/SKILL.md`]: 'old', [`${C}/style/a`]: 'was a file' })
  const toasts = world(on, d)
  const r = (await $.classic.SessionStart({ source: 'startup' } as never)) as { reloadSkills?: boolean }
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
  expect(toasts.some(t => t.includes('ENOTDIR'))).toBe(true)
  expect(r?.reloadSkills).toBe(true)
})

test('no refused file, the refreshed skill is reloaded', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${A}/style/z.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [`${C}/style/SKILL.md`]: 'old' })
  world(on, d)
  const r = (await $.classic.SessionStart({ source: 'startup' } as never)) as { reloadSkills?: boolean }
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
  expect(r?.reloadSkills).toBe(true)
})

test('runs twice: a type conflict with nothing changed writes nothing', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${A}/style/a/ref.md`]: 'R', [`${A}/style/z.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [`${C}/style/SKILL.md`]: 'old', [`${C}/style/a`]: 'was a file' })
  await sync(d.fs, A, C)
  const before = d.writes.length
  const s = await sync(d.fs, A, C)
  expect(s.failed.length).toBe(1)
  expect(d.writes.length - before).toBe(0)
})
