import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

// Disk double is review-gate's, links resolved.
type On = Parameters<TestBody>[1]
const ROOT = '/gate2'
const A = `${ROOT}/.agents/skills`
const C = `${ROOT}/.claude/skills`

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

const world = (on: On, d: ReturnType<typeof disk>, root = ROOT) => {
  const toasts: string[] = []
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: root }))
  on('fs.read', async (_, e) => ({ value: await d.fs.read(e.path) }))
  on('fs.write', async (_, e) => ({ value: await d.fs.write(e.path, e.text) }))
  on('fs.exists', async (_, e) => ({ value: await d.fs.exists(e.path) }))
  on('fs.list', async (_, e) => ({ value: await d.fs.list(e.path!) as never }))
  on('fs.stat', async (_, e) => ({ value: await d.fs.stat(e.path) as never }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  return toasts
}

const inCopy = (d: ReturnType<typeof disk>) => [...d.map.keys()].filter(p => p.startsWith(`${C}/style/`)).length

// H1 (kind 10 and 4; the class 68ac382 set out to close, "a copy cannot take in its own
// project and grow each session"). filesOf refuses only a link to a folder *above* the
// source skill (register.tsx:56). A link from the source skill sideways into the folder that
// holds the copies (or into the copy itself) is walked: session 1 copies the copies' folder
// into the copy, session 2 copies that plus session 1's copy of it, and so on; the copy
// doubles each session.
test('a source link into the copies folder does not grow the copy session after session', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/mine/SKILL.md`]: 'M' }, { [`${A}/style/installed`]: C })
  await sync(d.fs, A, C)
  const afterOne = inCopy(d)
  await sync(d.fs, A, C)
  const afterTwo = inCopy(d)
  await sync(d.fs, A, C)
  expect([afterTwo, inCopy(d)]).toEqual([afterOne, afterOne])
})
test('a source link to the copy itself does not grow the copy session after session', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, { [`${A}/style/self`]: `${C}/style` })
  await sync(d.fs, A, C)
  const afterOne = inCopy(d)
  await sync(d.fs, A, C)
  await sync(d.fs, A, C)
  expect(inCopy(d)).toBe(afterOne)
})
test('comparison: a source link to the project root (the fixed case) does not grow the copy', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/mine/SKILL.md`]: 'M' }, { [`${A}/style/proj`]: ROOT })
  await sync(d.fs, A, C)
  const afterOne = inCopy(d)
  await sync(d.fs, A, C)
  await sync(d.fs, A, C)
  expect(inCopy(d)).toBe(afterOne)
})
test('comparison: a source link to a folder outside both trees copies it once and stays', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${ROOT}/docs/r.md`]: 'R' }, { [`${A}/style/ref`]: `${ROOT}/docs` })
  await sync(d.fs, A, C)
  const afterOne = inCopy(d)
  await sync(d.fs, A, C)
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/ref/r.md`)).toBe('R')
  expect(inCopy(d)).toBe(afterOne)
})

// H2 control (kind 3, look-alikes): the `home` option naming the session's root under another
// spelling (a link) is not the same string; `run` awaits the pairs in turn, so the second finds
// the copy marked and keeps it. Expected to pass.
test('control: home naming the root through a link counts each skill once', { options: { home: `${ROOT}-link` } }, async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, { [`${ROOT}-link`]: ROOT })
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
  expect(toasts.filter(t => t.includes('/reload-skills'))).toEqual(['copied 1 skill(s) to a new .claude/skills; run /reload-skills to load them'])
})
test('comparison: home spelled as the root with a trailing slash counts each skill once', { options: { home: `${ROOT}/` } }, async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(toasts.filter(t => t.includes('/reload-skills'))).toEqual(['copied 1 skill(s) to a new .claude/skills; run /reload-skills to load them'])
})

// H3 (four questions, runs twice): two session starts on one disk, the second after the first
// finished: no write, no second note. Control, expected to pass.
test('control: a second start on an unchanged source writes nothing', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  const n = d.writes.length
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.writes.length).toBe(n)
  expect(toasts.filter(t => t.includes('/reload-skills')).length).toBe(1)
  expect(d.map.has(`${C}/style/${MARK}`)).toBe(true)
})

// H4 (two at once): session.start and classic.SessionStart dispatched together on a disk that
// yields at every call. One copy, one note, the reload asked. Control, expected to pass.
test('control: both hooks at once make one copy and still ask for the reload', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const tick = () => new Promise(r => setTimeout(r, 0))
  for (const k of ['read', 'write', 'exists', 'stat', 'list'] as const) {
    const f = d.fs[k] as (...a: never[]) => Promise<unknown>
    ;(d.fs as Record<string, unknown>)[k] = async (...a: never[]) => { await tick(); return f(...a) }
  }
  const toasts = world(on, d)
  const [, r] = await Promise.all([
    $.session.start({ cwd: ROOT, surface: null } as never),
    $.classic.SessionStart({ source: 'startup' } as never),
  ])
  expect(r.reloadSkills).toBe(true)
  expect(d.writes.filter(w => w === `${C}/style/SKILL.md`).length).toBe(1)
  expect(toasts.filter(t => t.includes('/reload-skills')).length).toBe(1)
})

// H5 (dies halfway): the session dies while writing the second of two skills; the next session
// keeps the first and finishes the second, and the first-copy note is not shown again for a
// folder that already exists. Control, expected to pass.
test('control: a death inside the second skill is finished by the next session', async ($, on) => {
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B', [`${A}/b/ref/r.md`]: 'R' })
  const write = d.fs.write
  d.fs.write = async (path, text) => {
    if (path === `${A.replace('.agents', '.claude')}/b/ref/r.md`) throw new Error('killed')
    await write(path, text)
  }
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.has(`${C}/b/${MARK}`)).toBe(true)
  expect(d.map.has(`${C}/b/ref/r.md`)).toBe(false)
  d.fs.write = write
  const before = d.writes.length
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/b/ref/r.md`)).toBe('R')
  expect(d.writes.slice(before).some(w => w.startsWith(`${C}/a/`))).toBe(false)
  expect(toasts.filter(t => t.includes('/reload-skills')).length).toBe(1)
})
