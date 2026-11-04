import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { MARK, register, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

type On = Parameters<TestBody>[1]
const ROOT = '/regressions'
const A = `${ROOT}/.agents/skills`
const C = `${ROOT}/.claude/skills`

// Missing paths reject stat; dangling links stat as other without realPath,
// matching the engine declarations. Explicit directories allow empty-folder cases.
const disk = (files: Record<string, string>, links: Record<string, string> = {}, dirs: string[] = []) => {
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
  const under = (path: string) => [...map.keys(), ...Object.keys(links), ...dirs].filter(f => f.startsWith(`${path}/`))
  const fs: Fs = {
    read: async path => {
      const text = map.get(real(path))
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    write: async (path, text) => { const target = real(path); writes.push(target); map.set(target, text) },
    exists: async path => map.has(real(path)) || dirs.includes(real(path)) || under(real(path)).length > 0,
    stat: async path => {
      const target = real(path)
      if (!map.has(target) && !dirs.includes(target) && !under(target).length) {
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
  on('fs.stat', async (_, e) => ({ value: await d.fs.stat(e.path, e.resolve) as never }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  return toasts
}

test('regression: a user folder holding only a star gitignore is not claimed', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/style/.gitignore`]: '*\n' })
  await sync(d.fs, A, C)
  expect(d.writes).toEqual([])
})
test('comparison: a user folder holding a different gitignore is not claimed', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${C}/style/.gitignore`]: 'cache/\n' })
  await sync(d.fs, A, C)
  expect(d.writes).toEqual([])
})
test('regression: an empty user folder is not claimed', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, {}, [`${C}/style`])
  await sync(d.fs, A, C)
  expect(d.writes).toEqual([])
})

const copyFiles = () => ({
  [`${A}/style/SKILL.md`]: 'new', [`${C}/style/SKILL.md`]: 'old',
  [`${C}/style/${MARK}`]: 'm', [`${C}/style/.gitignore`]: '*\n',
})
test('regression: a writable copy with a write-only gitignore still refreshes', async () => {
  const d = disk(copyFiles())
  const read = d.fs.read
  d.fs.read = async path => {
    if (path === `${C}/style/.gitignore`) throw new Error('EACCES')
    return read(path)
  }
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
})
test('comparison: a writable copy with a readable gitignore refreshes', async () => {
  const d = disk(copyFiles())
  await sync(d.fs, A, C)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('new')
})

// Call the registered hook directly so Windows path spellings do not depend on
// the POSIX test host's handling of session roots and filesystem calls.
const startOn = async (fs: Fs, root: string) => {
  type Start = (api: unknown, event: unknown, next: (event: unknown) => Promise<unknown>) => Promise<unknown>
  let start: Start = async () => { throw new Error('session.start not registered') }
  register(((name: string, hook: Start) => { if (name === 'session.start') start = hook }) as never, {})
  await start({
    fs: { ...fs, stat: (path: string, options?: { resolve: boolean }) => fs.stat(path, options?.resolve) },
    session: { root: async () => root }, ui: { toast: () => {} },
  }, {}, async event => event)
}

test('regression: resolved Windows backslashes allow a regular copy refresh', async () => {
  const root = 'C:/regressions'
  const files = Object.fromEntries(Object.entries(copyFiles()).map(([path, text]) => [`C:${path}`, text]))
  const d = disk(files)
  const stat = d.fs.stat
  d.fs.stat = async (path, resolve) => {
    const own = await stat(path, resolve)
    return { ...own, realPath: own.realPath?.replaceAll('/', '\\') }
  }
  await startOn(d.fs, root)
  expect(d.map.get(`${root}/.claude/skills/style/SKILL.md`)).toBe('new')
})
test('comparison: resolved slash paths allow a regular copy refresh', async () => {
  const root = 'C:/regressions'
  const files = Object.fromEntries(Object.entries(copyFiles()).map(([path, text]) => [`C:${path}`, text]))
  const d = disk(files)
  await startOn(d.fs, root)
  expect(d.map.get(`${root}/.claude/skills/style/SKILL.md`)).toBe('new')
})

test('control: a linked skills root and not-yet-created nested files are writable', async ($, on) => {
  const target = `${ROOT}/dotfiles/skills`
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/style/ref/r.md`]: 'R' }, { [C]: target }, [target])
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${target}/style/ref/r.md`)).toBe('R')
})
test('control: a source ancestor cycle terminates and copies the regular files', async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' }, { [`${A}/style/ref/back`]: `${A}/style` })
  world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})
test('control: the toast counts completed skills and names the failed one', async ($, on) => {
  const d = disk({ [`${A}/a/SKILL.md`]: 'A', [`${A}/b/SKILL.md`]: 'B' })
  const read = d.fs.read
  d.fs.read = async path => {
    if (path === `${A}/b/SKILL.md`) throw new Error('EACCES')
    return read(path)
  }
  const toasts = world(on, d)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(toasts.some(t => t.startsWith('could not copy .agents/skills (b:'))).toBe(true)
  expect(toasts.filter(t => t.includes('/reload-skills'))).toEqual([
    'copied 1 skill(s) to a new .claude/skills; run /reload-skills to load them',
  ])
})
