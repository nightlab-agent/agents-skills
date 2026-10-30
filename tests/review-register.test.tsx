import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
const ROOT = '/proj'
const SKILL = '---\nname: house-style\ndescription: d\n---\nx\n'

// register.test.tsx's world, plus `links`: a path that is a symbolic link to another
// (the hand-made .claude/skills/<name> -> ../../.agents/skills/<name> the README mentions).
const world = (on: On, files: Record<string, string>, links: Record<string, string> = {}) => {
  const disk = new Map(Object.entries(files))
  const toasts: string[] = []
  const real = (p: string) => { for (const [l, t] of Object.entries(links)) if (p === l || p.startsWith(`${l}/`)) return t + p.slice(l.length); return p }
  const under = (p: string) => [...disk.keys()].filter(f => f.startsWith(`${real(p)}/`))
  on('session.start', (_, e) => e)
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_, e) => ({ value: disk.has(real(e.path)) || under(e.path).length > 0 }))
  on('fs.stat', (_, e) => ({ value: { kind: disk.has(real(e.path)) ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: e.path in links, realPath: real(e.path) } as never }))
  on('fs.list', (_, e) => {
    const names = new Map<string, 'file' | 'dir' | 'other'>()
    for (const f of under(e.path)) {
      const rest = f.slice(real(e.path).length + 1)
      const name = rest.split('/')[0]!
      names.set(name, `${e.path}/${name}` in links ? 'other' : rest.includes('/') ? 'dir' : 'file')
    }
    for (const l of Object.keys(links)) if (l.startsWith(`${e.path}/`) && !l.slice(e.path.length + 1).includes('/')) names.set(l.slice(e.path.length + 1), 'other')
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: kind === 'other' })) }
  })
  on('fs.read', (_, e) => { const t = disk.get(real(e.path)); if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { disk.set(real(e.path), e.text); return { value: undefined } })
  on('ui.toast', (_, e) => { toasts.push(String((e as { text?: unknown }).text ?? e)); return { value: undefined } })
  return { disk, toasts }
}

test('review: a hand-made link .claude/skills/x -> .agents/skills/x is not reported as "not used"', async ($, on) => {
  const w = world(on, { [`${ROOT}/.agents/skills/house-style/SKILL.md`]: SKILL },
    { [`${ROOT}/.claude/skills/house-style`]: `${ROOT}/.agents/skills/house-style` })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.toasts.filter(t => t.includes('is not used'))).toEqual([])
})
test('review comparison: no link, the copy is made and no "not used" note shows', async ($, on) => {
  const w = world(on, { [`${ROOT}/.agents/skills/house-style/SKILL.md`]: SKILL })
  await $.session.start({ cwd: ROOT, surface: null } as never)
  expect(w.toasts.filter(t => t.includes('is not used'))).toEqual([])
})
