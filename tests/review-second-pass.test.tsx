import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

type On = Parameters<TestBody>[1]
const ROOT = '/review'
const A = `${ROOT}/.agents/skills`
const C = `${ROOT}/.claude/skills`

// Like the other disk doubles, with symlinks resolved on every operation.
// The link limit models the OS's ELOOP instead of hanging a cyclic-link test.
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

test('second review: a source .gitignore cannot replace the copy ignore rule', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/.gitignore`]: 'cache/\n' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/.gitignore`)).toBe('*\n')
})
test('second review comparison: no source .gitignore leaves the copy ignored', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/.gitignore`)).toBe('*\n')
})

test('second review: retry completes a copy interrupted while writing its marker', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const write = d.fs.write
  d.fs.write = async (path, text) => {
    if (path === `${C}/style/${MARK}`) throw new Error('ENOSPC')
    await write(path, text)
  }
  expect((await sync(d.fs, A, C)).failed).toEqual(['style: ENOSPC'])
  d.fs.write = write
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})
test('second review comparison: retry completes a copy interrupted after its marker', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const write = d.fs.write
  d.fs.write = async (path, text) => {
    if (path === `${C}/style/SKILL.md`) throw new Error('ENOSPC')
    await write(path, text)
  }
  expect((await sync(d.fs, A, C)).failed).toEqual(['style/SKILL.md: ENOSPC'])
  d.fs.write = write
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})

test('second review: the hook refuses a copy file linked outside .claude/skills', async ($, on) => {
  const other = `${ROOT}/my-notes.md`
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [other]: 'mine' },
    { [`${C}/style/SKILL.md`]: other })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(other)).toBe('mine')
})
test('second review comparison: the hook refreshes a regular copy file inside .claude/skills', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${C}/style/${MARK}`]: 'm', [`${C}/style/SKILL.md`]: 'old' })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
})

test('second review: a source directory link back to its skill does not prevent copying', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, { [`${A}/style/loop`]: `${A}/style` })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})
test('second review comparison: an acyclic source directory link copies its files', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${ROOT}/refs/r.md`]: 'R' },
    { [`${A}/style/ref`]: `${ROOT}/refs` })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
  expect(d.map.get(`${C}/style/ref/r.md`)).toBe('R')
})

test('second review: a later skill read failure does not lose the first-copy reload note', async ($, on) => {
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B' })
  const read = d.fs.read
  d.fs.read = async path => {
    if (path === `${A}/b/SKILL.md`) throw new Error('EACCES')
    return read(path)
  }
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/a/SKILL.md`)).toBe('A')
  // Even a subsequent successful start never emits the lost first-copy note.
  d.fs.read = read
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(toasts.some(t => t.includes('/reload-skills'))).toBe(true)
})
test('second review comparison: two readable skills emit the first-copy reload note', async ($, on) => {
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B' })
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/a/SKILL.md`)).toBe('A')
  expect(toasts.some(t => t.includes('/reload-skills'))).toBe(true)
})

test('a copy file linked to nowhere is refused: the write would land outside', async ($, on) => {
  const gone = `${ROOT}/gone/notes.md`
  const d = disk({ [`${A}/style/SKILL.md`]: 'new', [`${C}/style/${MARK}`]: 'm' }, { [`${C}/style/SKILL.md`]: gone })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.has(gone)).toBe(false)
})
test('a marked copy folder linked outside .claude/skills is refused, and the next skill is still copied', async ($, on) => {
  const out = `${ROOT}/elsewhere`
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B', [`${out}/${MARK}`]: 'm' }, { [`${C}/a`]: out })
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.has(`${out}/SKILL.md`)).toBe(false)
  expect(d.map.get(`${C}/b/SKILL.md`)).toBe('B')
  expect(toasts.some(t => t.includes('refused to write through a link'))).toBe(true)
})
test('.claude/skills itself a link: a copy lands inside it as before', async ($, on) => {
  const out = `${ROOT}/dotfiles/skills`
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${out}/keep/SKILL.md`]: 'K' }, { [C]: out })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${out}/a/SKILL.md`)).toBe('A')
})
test('a stale copy whose .gitignore a source once replaced is put right, though its files match', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/style/SKILL.md`]: 'S', [`${C}/style/.gitignore`]: 'cache/\n', [`${C}/style/${MARK}`]: 'm' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/.gitignore`)).toBe('*\n')
})
test("a source file named like the mark does not replace it, and a nested .gitignore is the skill's own", async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/${MARK}`]: 'x', [`${A}/style/ref/.gitignore`]: 'n' })
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/${MARK}`)).toContain('Copied from')
  expect(d.map.get(`${C}/style/ref/.gitignore`)).toBe('n')
})
test("comparison: the user's folder with one .gitignore of their own stays theirs", async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/style/.gitignore`]: 'node_modules/\n' })
  expect((await sync(d.fs, A, C)).skipped).toEqual(['style'])
  expect(d.writes).toEqual([])
})
