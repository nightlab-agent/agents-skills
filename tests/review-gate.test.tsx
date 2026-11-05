import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { MARK, sync } from '../hooks/register'
import type { Fs } from '../hooks/register'

// Release gate, 2026-11-05 (code-reviewer). Each "gate:" test fails on 9752e36; the
// "gate comparison:" beside it passes. The disk double is review-second-pass's, links resolved.
type On = Parameters<TestBody>[1]
const ROOT = '/gate'
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

// `refuseHome`: fs.exists rejects under <root>/home, as the engine says it does for a network location.
const world = (on: On, d: ReturnType<typeof disk>, refuseHome = false) => {
  const toasts: string[] = []
  const reads: { path: string; as: string }[] = []
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', async (_, e) => { reads.push({ path: e.path, as: e.as }); return { value: await d.fs.read(e.path) } })
  on('fs.write', async (_, e) => ({ value: await d.fs.write(e.path, e.text) }))
  on('fs.exists', async (_, e) => {
    if (refuseHome && e.path.startsWith(`${ROOT}/home/`)) throw new Error('ENOTSUP: network location')
    return { value: await d.fs.exists(e.path) }
  })
  on('fs.list', async (_, e) => ({ value: await d.fs.list(e.path!) as never }))
  on('fs.stat', async (_, e) => ({ value: await d.fs.stat(e.path) as never }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  return { toasts, reads }
}

// G1 (kind 5 and 10): a cut after the first write leaves a file git shows. The first write is the
// mark (holding the source's absolute path) and the `*` .gitignore comes second, so a session killed
// between the two leaves `.claude/skills/<name>/.from-agents-skills` untracked (git 2.43 oracle:
// tests/review-gate-git.py). Every file of a copy that is on disk must sit under a `*` .gitignore.
const cutAfter = (d: ReturnType<typeof disk>, n: number) => {
  const write = d.fs.write
  let count = 0
  d.fs.write = async (path, text) => {
    if (++count > n) throw new Error('killed')
    await write(path, text)
  }
}
const ignoredCopy = (d: ReturnType<typeof disk>) => {
  const inCopy = [...d.map.keys()].filter(p => p.startsWith(`${C}/style/`))
  return inCopy.length === 0 || d.map.get(`${C}/style/.gitignore`) === '*\n'
}

// G2 (kind 4, the claim at register.tsx:52 and the CHANGELOG): "a link back to a folder above it is
// not walked" holds only for folders on the walk's own path. A link to the skill's parent, or to the
// project root, is walked: every sibling skill, and the copy itself, land inside the copy.
test('a link to the folder above the skill is not walked', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/other/SKILL.md`]: 'O' }, { [`${A}/style/up`]: A })
  await sync(d.fs, A, C)
  expect(d.map.has(`${C}/style/up/other/SKILL.md`)).toBe(false)
})
test('comparison: a link back to the skill itself is not walked', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${A}/other/SKILL.md`]: 'O' }, { [`${A}/style/loop`]: `${A}/style` })
  await sync(d.fs, A, C)
  expect(d.map.has(`${C}/style/loop/SKILL.md`)).toBe(false)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
})
test('a link to the project root does not copy the copy into itself at the next session', async () => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S', [`${ROOT}/.git/HEAD`]: 'ref: refs/heads/main' }, { [`${A}/style/proj`]: ROOT })
  await sync(d.fs, A, C)
  await sync(d.fs, A, C)
  const nested = [...d.map.keys()].filter(p => p.startsWith(`${C}/style/proj/`))
  expect(nested.filter(p => p.includes('/.git/'))).toEqual([])
  expect(nested.filter(p => p.startsWith(`${C}/style/proj/.claude/skills/style/`))).toEqual([])
})

// G3 (kind 4; the Dex s450 lesson one level up): the home pair's `fs.exists` rejects, as the engine
// says it does for a network location (index.d.ts:3367-3368), after the project pair copied. `run`
// throws, so the project's copy is on disk but classic.SessionStart answers no reloadSkills and
// session.start shows no /reload-skills note; the toast says the whole copy failed.
test('the home folder refused after the project copied still asks for the reload', { options: { home: `${ROOT}/home` } }, async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  const w = world(on, d, true)
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
  expect(w.toasts.some(t => t.includes('/reload-skills'))).toBe(true)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(r.reloadSkills).toBe(true)
})
test('comparison: a readable home folder: the project copy asks for the reload', { options: { home: `${ROOT}/home` } }, async ($, on) => {
  const d = disk({ [`${A}/style/SKILL.md`]: 'S' })
  world(on, d)
  const r = await $.classic.SessionStart({ source: 'startup' } as never)
  expect(d.map.get(`${C}/style/SKILL.md`)).toBe('S')
  expect(r.reloadSkills).toBe(true)
})

// G4 (kind 4, four questions Q4): every skill file is read as UTF-8 text (`$.fs.read(path)`,
// index.d.ts:3325-3340) and written back as text. A binary asset (the Agent Skills spec's
// assets/ holds images and fonts) does not survive the decode: bun and node both turn the
// 18-byte PNG sample into 28 bytes (scratch probe/oracle.mjs). The fakes store strings, so
// only the `as` argument shows it.
