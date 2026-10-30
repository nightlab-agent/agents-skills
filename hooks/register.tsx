import type { Register } from 'claude-code'

// A copy this mod made carries this file; a skill folder without it is the user's own and is
// never written over.
export const MARK = '.from-agents-skills'

// Minimal surface of $.fs this mod uses, so the sync can be tested on a plain map.
export type Fs = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<{ kind: 'file' | 'dir' | 'other' }>
}

export type Synced = { copied: string[]; kept: string[]; skipped: string[] }

const isDir = async (fs: Fs, path: string, kind: string): Promise<boolean> =>
  kind === 'dir' || (kind === 'other' && (await fs.stat(path)).kind === 'dir')

/** Every file under `dir`, as paths relative to it. */
const filesOf = async (fs: Fs, dir: string, prefix = ''): Promise<string[]> => {
  const out: string[] = []
  for (const e of await fs.list(dir)) {
    const rel = `${prefix}${e.name}`
    if (await isDir(fs, `${dir}/${e.name}`, e.kind)) out.push(...(await filesOf(fs, `${dir}/${e.name}`, `${rel}/`)))
    else if (e.kind === 'file') out.push(rel)
  }
  return out.sort()
}

/**
 * Copies each skill in `from` (a folder holding SKILL.md) to `to/<name>`, unless `to/<name>`
 * exists without MARK (the user's own skill: skipped). A copy whose files already match is kept.
 */
export const sync = async (fs: Fs, from: string, to: string): Promise<Synced> => {
  const done: Synced = { copied: [], kept: [], skipped: [] }
  if (!(await fs.exists(from))) return done
  for (const e of await fs.list(from)) {
    const src = `${from}/${e.name}`
    if (!(await isDir(fs, src, e.kind)) || !(await fs.exists(`${src}/SKILL.md`))) continue
    const dst = `${to}/${e.name}`
    if ((await fs.exists(dst)) && !(await fs.exists(`${dst}/${MARK}`))) {
      done.skipped.push(e.name)
      continue
    }
    const files = await filesOf(fs, src)
    let same = await fs.exists(`${dst}/${MARK}`)
    const texts = new Map<string, string>()
    for (const f of files) {
      const text = await fs.read(`${src}/${f}`)
      texts.set(f, text)
      if (same && (!(await fs.exists(`${dst}/${f}`)) || (await fs.read(`${dst}/${f}`)) !== text)) same = false
    }
    if (same) {
      done.kept.push(e.name)
      continue
    }
    for (const [f, text] of texts) await fs.write(`${dst}/${f}`, text)
    await fs.write(`${dst}/.gitignore`, '*\n')
    await fs.write(`${dst}/${MARK}`, `Copied from ${src} by the agents-skills mod; edit the original there.\n`)
    done.copied.push(e.name)
  }
  return done
}

type Run = { copied: number; present: number; skipped: string[]; fresh: boolean }

/** Copies project and home .agents/skills; `fresh` when this created a .claude/skills folder. */
const run = async ($: any): Promise<Run> => {
  const cwd = (await $.session.cwd()).replace(/[\\/]+$/, '')
  const home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/[\\/]+$/, '')
  const pairs: [string, string][] = [[`${cwd}/.agents/skills`, `${cwd}/.claude/skills`]]
  if (home && home !== cwd) pairs.push([`${home}/.agents/skills`, `${home}/.claude/skills`])
  const fs: Fs = {
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    stat: path => $.fs.stat(path),
  }
  const out: Run = { copied: 0, present: 0, skipped: [], fresh: false }
  for (const [from, to] of pairs) {
    const had = await fs.exists(to)
    const s = await sync(fs, from, to)
    out.copied += s.copied.length
    out.present += s.copied.length + s.kept.length
    out.skipped.push(...s.skipped)
    if (!had && s.copied.length) out.fresh = true
  }
  if (out.skipped.length) $.ui.toast(`agents-skills: kept your own .claude/skills/${out.skipped.join(', ')}; the .agents copy is not used`)
  return out
}

const fail = ($: any, err: unknown) => {
  try {
    $.ui.toast(`agents-skills: could not copy .agents/skills (${err instanceof Error ? err.message : String(err)})`)
  } catch {
    // no toast surface; the session goes on
  }
}

export const register: Register = on => {
  // session.start copies first, since another mod may pass classic.SessionStart by. Claude Code
  // does not watch a .claude/skills folder made after the session began, so say how to load it.
  on('session.start', async ($, e, next) => {
    try {
      const r = await run($)
      if (r.fresh) $.ui.toast(`agents-skills: copied ${r.copied} skill(s) into a new .claude/skills folder; run /reload-skills once to load them`)
    } catch (err) {
      fail($, err)
    }
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    try {
      const r = await run($)
      if (r.present) return { ...result, reloadSkills: true }
    } catch (err) {
      fail($, err)
    }
    return result
  })
}
