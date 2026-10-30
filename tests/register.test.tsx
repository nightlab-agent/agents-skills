import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
const ROOT = '/proj'
const SKILL = '---\nname: house-style\ndescription: Commit titles in house style\n---\nStart with [area].\n'

// The engine beneath: an in-memory disk of absolute paths, the session's root and a shell
// cwd that moved into src/, a toast log, and a record of every path written.
const world = (on: On, files: Record<string, string>, extra: Record<string, string[]> = {}) => {
  const disk = new Map(Object.entries(files))
  const toasts: string[] = []
  const writes: string[] = []
  const under = (p: string) => [...disk.keys()].filter(f => f.startsWith(`${p}/`))
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: `${ROOT}/src` }))
  on('fs.exists', (_, e) => ({ value: disk.has(e.path) || under(e.path).length > 0 }))
  on('fs.stat', (_, e) => ({ value: { kind: disk.has(e.path) ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false } as never }))
  on('fs.list', (_, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of under(e.path)) {
      const rest = f.slice(e.path.length + 1)
      names.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file')
    }
    for (const name of extra[e.path] ?? []) names.set(name, 'dir')
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = disk.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    writes.push(e.path)
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  return { disk, toasts, writes }
}

test('session start copies the project skill under the session root, not the shell cwd', async ($, on) => {
  const w = world(on, { [`${ROOT}/.agents/skills/house-style/SKILL.md`]: SKILL })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.disk.get(`${ROOT}/.claude/skills/house-style/SKILL.md`)).toBe(SKILL)
  expect(w.disk.has(`${ROOT}/src/.claude/skills/house-style/SKILL.md`)).toBe(false)
  expect(w.writes.every(p => p.startsWith(`${ROOT}/.claude/skills/`))).toBe(true)
})

test('the home option set: the home skills are copied too', { options: { home: '/home/u/' } }, async ($, on) => {
  const w = world(on, { '/home/u/.agents/skills/notes/SKILL.md': SKILL })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.disk.get('/home/u/.claude/skills/notes/SKILL.md')).toBe(SKILL)
})

test('comparison: the home option unset, the home folder is never read or written', async ($, on) => {
  const w = world(on, { '/home/u/.agents/skills/notes/SKILL.md': SKILL })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.writes).toEqual([])
})

test('a skill named with ../ never writes outside .claude/skills', async ($, on) => {
  // a listing that hands back a hostile name, as a broken disk or a crafted folder could
  const w = world(on, { [`${ROOT}/.agents/skills/ok/SKILL.md`]: SKILL }, { [`${ROOT}/.agents/skills`]: ['..'] })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.writes.every(p => p.startsWith(`${ROOT}/.claude/skills/`) && !p.slice(ROOT.length).includes('/../'))).toBe(true)
})

test('classic SessionStart asks Claude Code to reload skills when a copy is present', async ($, on) => {
  world(on, { [`${ROOT}/.agents/skills/house-style/SKILL.md`]: SKILL })
  const r = (await $.classic.SessionStart({ source: 'startup' } as never)) as { reloadSkills?: boolean }
  expect(r?.reloadSkills).toBe(true)
})

test('comparison: no .agents/skills, classic SessionStart asks for no reload', async ($, on) => {
  world(on, {})
  const r = (await $.classic.SessionStart({ source: 'startup' } as never)) as { reloadSkills?: boolean } | undefined
  expect(r?.reloadSkills).toBe(undefined)
})
