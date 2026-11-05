import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { Fs } from '../hooks/register'

// Disk double is review-sideways', links resolved; two trees, the project under the home folder.
type On = Parameters<TestBody>[1]
const H = '/gate3/home'
const R = `${H}/proj`
const HA = `${H}/.agents/skills`
const HC = `${H}/.claude/skills`
const RA = `${R}/.agents/skills`
const RC = `${R}/.claude/skills`

const disk = (files: Record<string, string>, links: Record<string, string> = {}) => {
  const map = new Map(Object.entries(files))
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
    write: async (path, text) => { map.set(real(path), text) },
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
  return { fs, map }
}

const world = (on: On, d: ReturnType<typeof disk>) => {
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: R }))
  on('fs.read', async (_, e) => ({ value: await d.fs.read(e.path) }))
  on('fs.write', async (_, e) => ({ value: await d.fs.write(e.path, e.text) }))
  on('fs.exists', async (_, e) => ({ value: await d.fs.exists(e.path) }))
  on('fs.list', async (_, e) => ({ value: await d.fs.list(e.path!) as never }))
  on('fs.stat', async (_, e) => ({ value: await d.fs.stat(e.path) as never }))
  on('ui.toast', () => ({ value: undefined }))
}

const copies = (d: ReturnType<typeof disk>) => [...d.map.keys()].filter(p => p.startsWith(`${RC}/`) || p.startsWith(`${HC}/`)).length

// J1 (kind 3, look-alikes): with the `home` option, copies land in two `.claude/skills` folders,
// and filesOf refuses a link only into the pair's own (register.tsx:111 passes one `to`). A project
// skill linking into the home copies and a home skill linking into the project copies each take in
// the other's copy of themselves, and both copies grow every session.
test('links between the two pairs\' copies do not grow the copies session after session', { options: { home: H } }, async ($, on) => {
  const d = disk({ [`${RA}/style/SKILL.md`]: 'S', [`${HA}/base/SKILL.md`]: 'B' }, { [`${RA}/style/h`]: HC, [`${HA}/base/p`]: RC })
  world(on, d)
  await $.session.start({ cwd: R, surface: null } as never)
  await $.session.start({ cwd: R, surface: null } as never)
  const afterTwo = copies(d)
  await $.session.start({ cwd: R, surface: null } as never)
  expect(copies(d)).toBe(afterTwo)
})
test('comparison: a home skill linking into the project copies alone does not grow', { options: { home: H } }, async ($, on) => {
  const d = disk({ [`${RA}/style/SKILL.md`]: 'S', [`${HA}/base/SKILL.md`]: 'B' }, { [`${HA}/base/p`]: RC })
  world(on, d)
  await $.session.start({ cwd: R, surface: null } as never)
  await $.session.start({ cwd: R, surface: null } as never)
  const afterTwo = copies(d)
  await $.session.start({ cwd: R, surface: null } as never)
  expect(copies(d)).toBe(afterTwo)
})
test('comparison: a project skill linking into its own pair\'s copies (the fixed case) does not grow', { options: { home: H } }, async ($, on) => {
  const d = disk({ [`${RA}/style/SKILL.md`]: 'S', [`${HA}/base/SKILL.md`]: 'B' }, { [`${RA}/style/c`]: RC })
  world(on, d)
  await $.session.start({ cwd: R, surface: null } as never)
  const afterOne = copies(d)
  await $.session.start({ cwd: R, surface: null } as never)
  await $.session.start({ cwd: R, surface: null } as never)
  expect(copies(d)).toBe(afterOne)
})
