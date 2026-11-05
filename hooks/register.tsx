import type { Register } from 'claude-code'

// A copy this mod made carries this file; a skill folder without it is the user's own and is
// never written over.
export const MARK = '.from-agents-skills'

// The .gitignore every copy carries. It and the mark are this mod's own: a source skill's file of
// either name is left out of the copy, or it would undo what they promise.
const IGNORE = '*\n'
const RESERVED = new Set(['.gitignore', MARK.toLowerCase()])

// Minimal surface of $.fs this mod uses, so the sync can be tested on a plain map.
export type Fs = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  exists: (path: string) => Promise<boolean>
  stat: (path: string, resolve?: boolean) => Promise<{ kind: 'file' | 'dir' | 'other'; realPath?: string }>
}

export type Synced = { copied: string[]; kept: string[]; skipped: string[]; failed: string[] }

/** What an entry leads to: a symbolic link (`other`) is followed. */
const kindOf = async (fs: Fs, path: string, kind: string): Promise<string> =>
  kind === 'other' ? (await fs.stat(path)).kind : kind

const isDir = async (fs: Fs, path: string, kind: string): Promise<boolean> => (await kindOf(fs, path, kind)) === 'dir'

/** True when `a` and `b` land on the same folder (a link made by hand from one to the other). */
const sameFolder = async (fs: Fs, a: string, b: string): Promise<boolean> => {
  try {
    const [x, y] = await Promise.all([fs.stat(a, true), fs.stat(b, true)])
    return x.realPath !== undefined && x.realPath === y.realPath
  } catch {
    return false
  }
}

/** A path with one kind of separator: the engine's real paths use backslashes on Windows. */
const slashes = (path: string) => path.replace(/\\/g, '/')

/** Where `path` lands, itself or through its folder when it is not there yet; undefined when a link leads nowhere. */
const placed = async (fs: Fs, path: string): Promise<string | undefined> => {
  const own = await fs.stat(path, true).catch(() => undefined)
  if (own) return own.realPath?.replace(/[\\/]+$/, '')
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return undefined
  const folder = await placed(fs, path.slice(0, cut))
  return folder === undefined ? undefined : `${folder}/${path.slice(cut + 1)}`
}

/** Every file under `dir`, as paths relative to it. A link back to the walk's own path, to a folder that holds where it started, or into `copies` (where the walk's files land) is not walked. */
const filesOf = async (fs: Fs, dir: string, copies: string[], prefix = '', above: string[] = []): Promise<string[]> => {
  const real = (await fs.stat(dir, true)).realPath
  const start = above[0]
  const into = start !== undefined && real !== undefined && copies.some(copy => `${slashes(real)}/`.startsWith(`${slashes(copy)}/`))
  if (into || (real !== undefined && (above.includes(real) || (start !== undefined && `${slashes(start)}/`.startsWith(`${slashes(real)}/`))))) return []
  const inside = real === undefined ? above : [...above, real]
  const out: string[] = []
  for (const e of await fs.list(dir)) {
    const rel = `${prefix}${e.name}`
    const kind = await kindOf(fs, `${dir}/${e.name}`, e.kind)
    if (kind === 'dir') out.push(...(await filesOf(fs, `${dir}/${e.name}`, copies, `${rel}/`, inside)))
    else if (kind === 'file') out.push(rel)
  }
  return out.sort()
}

/**
 * Copies each skill in `from` (a folder holding SKILL.md) to `to/<name>`, unless `to/<name>`
 * exists without MARK (the user's own skill: skipped). A copy whose files already match is kept.
 * `destinations` names all copy roots to exclude from source walks; type conflicts are reported
 * and left in place while other files refresh.
 */
export const sync = (fs: Fs, from: string, to: string, destinations: string[] = [to]): Promise<Synced> => {
  // Two runs on one folder (the two hooks of a session) go one after the other, so the second
  // never sees a copy half made.
  const run = (queue.get(to) ?? Promise.resolve()).then(() => syncNow(fs, from, to, destinations))
  queue.set(to, run.catch(() => undefined))
  return run
}

const queue = new Map<string, Promise<unknown>>()

const syncNow = async (fs: Fs, from: string, to: string, destinations: string[]): Promise<Synced> => {
  const done: Synced = { copied: [], kept: [], skipped: [], failed: [] }
  if (!(await fs.exists(from))) return done
  for (const e of await fs.list(from)) {
    if (e.name === '.' || e.name === '..' || /[\\/]/.test(e.name)) continue
    // One skill that cannot be copied does not stop the others.
    try {
      await syncOne(fs, e, from, to, destinations, done)
    } catch (err) {
      done.failed.push(`${e.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return done
}

/** The engine cannot delete a type conflict. Leave it in place without freezing the other files. */
const typeConflict = async (fs: Fs, dst: string, file: string): Promise<string | undefined> => {
  const parts = file.split('/')
  let path = dst
  for (let i = 0; i < parts.length; i++) {
    path += `/${parts[i]}`
    if (!(await fs.exists(path))) return
    const kind = (await fs.stat(path)).kind
    if (i < parts.length - 1 && kind === 'file') return `ENOTDIR at ${path}`
    if (i === parts.length - 1 && kind === 'dir') return `EISDIR at ${path}`
  }
}

const syncOne = async (fs: Fs, e: { name: string; kind: string }, from: string, to: string, destinations: string[], done: Synced): Promise<void> => {
  const src = `${from}/${e.name}`
  if (!(await isDir(fs, src, e.kind)) || !(await fs.exists(`${src}/SKILL.md`))) return
  const dst = `${to}/${e.name}`
  if ((await fs.exists(dst)) && !(await fs.exists(`${dst}/${MARK}`))) {
    // a link from .claude/skills/<name> to this very skill already does the job
    if (await sameFolder(fs, dst, src)) {
      done.kept.push(e.name)
      return
    }
    done.skipped.push(e.name)
    return
  }
  const copies = (await Promise.all(destinations.map(path => placed(fs, path)))).filter((path): path is string => path !== undefined)
  const files = (await filesOf(fs, src, copies)).filter(f => !RESERVED.has(f.toLowerCase()))
  // A .gitignore that cannot be read is written again, like one that differs.
  const ignored = (await fs.read(`${dst}/.gitignore`).catch(() => undefined)) === IGNORE
  let same = ignored && (await fs.exists(`${dst}/${MARK}`))
  const texts = new Map<string, string>()
  for (const f of files) {
    const conflict = await typeConflict(fs, dst, f)
    if (conflict) {
      done.failed.push(`${e.name}/${f}: ${conflict}; remove the conflicting copy entry to copy this path`)
      continue
    }
    const text = await fs.read(`${src}/${f}`)
    texts.set(f, text)
    if (same && (!(await fs.exists(`${dst}/${f}`)) || (await fs.read(`${dst}/${f}`)) !== text)) same = false
  }
  if (same) {
    done.kept.push(e.name)
    return
  }
  // The mark goes first: a copy cut short is known as this mod's, and the next session
  // finishes it. A folder with no mark is never ours, however empty.
  await fs.write(`${dst}/${MARK}`, `Copied from ${src} by the agents-skills mod; edit the original there.\n`)
  await fs.write(`${dst}/.gitignore`, IGNORE)
  // A refused file does not stop the rest of the skill.
  const refused: string[] = []
  for (const [f, text] of texts) await fs.write(`${dst}/${f}`, text).catch(err => refused.push(`${e.name}/${f}: ${err instanceof Error ? err.message : String(err)}`))
  done.failed.push(...refused)
  if (!refused.length) done.copied.push(e.name)
}

type Run = { copied: number; present: number; skipped: string[]; failed: string[]; fresh: boolean }

/** The `home` option as a folder path without a trailing slash, or '' when unset. */
export const homeOf = (value: unknown): string =>
  (typeof value === 'string' ? value.trim() : '').replace(/[\\/]+$/, '')

/**
 * Copies the project's .agents/skills, and the home folder's when the `home` option names one;
 * `fresh` when this created a .claude/skills folder.
 */
const run = async ($: any, home: string): Promise<Run> => {
  const root = (await $.session.root()).replace(/[\\/]+$/, '')
  const pairs: [string, string][] = [[`${root}/.agents/skills`, `${root}/.claude/skills`]]
  if (home && home !== root) pairs.push([`${home}/.agents/skills`, `${home}/.claude/skills`])
  const fs: Fs = {
    read: path => $.fs.read(path),
    // Writes only ever land inside one of the .claude/skills folders above.
    write: async (path, text) => {
      const dir = pairs.map(([, to]) => to).find(to => path.startsWith(`${to}/`))
      if (dir === undefined || path.slice(dir.length + 1).split('/').includes('..')) throw new Error(`refused to write outside .claude/skills: ${path}`)
      // The spelling is not enough: a link in the path can lead anywhere, or nowhere.
      const [base, land] = await Promise.all([placed(fs, dir), placed(fs, path)])
      if (base === undefined || land === undefined || !slashes(land).startsWith(`${slashes(base)}/`)) throw new Error(`refused to write through a link: ${path}`)
      // user file: a copy of the user's own skill, where Claude Code reads skills.
      await $.fs.write(`${dir}/${path.slice(dir.length + 1)}`, text)
    },
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    stat: (path, resolve) => (resolve ? $.fs.stat(path, { resolve: true }) : $.fs.stat(path)),
  }
  const out: Run = { copied: 0, present: 0, skipped: [], failed: [], fresh: false }
  for (const [from, to] of pairs) {
    // One folder refused leaves the other's result standing.
    try {
      const had = await fs.exists(to)
      const s = await sync(fs, from, to, pairs.map(([, destination]) => destination))
      out.copied += s.copied.length
      out.present += s.copied.length + s.kept.length
      out.skipped.push(...s.skipped)
      out.failed.push(...s.failed)
      if (!had && s.copied.length) out.fresh = true
    } catch (err) {
      out.failed.push(String((err as Error)?.message ?? err))
    }
  }
  if (out.skipped.length) $.ui.toast(`kept your own .claude/skills/${out.skipped.join(', ')}; the .agents copy is not used`)
  if (out.failed.length) fail($, out.failed.join('; '))
  return out
}

const fail = ($: any, err: unknown) => {
  try {
    $.ui.toast(`could not copy .agents/skills (${err instanceof Error ? err.message : String(err)})`)
  } catch {
    // no toast surface; the session goes on
  }
}

export const register: Register = (on, options) => {
  const home = homeOf((options as { home?: unknown } | undefined)?.home)
  // session.start copies first, since another mod may pass classic.SessionStart by. Claude Code
  // does not watch a .claude/skills folder made after the session began, so say how to load it.
  on('session.start', async ($, e, next) => {
    try {
      const r = await run($, home)
      if (r.fresh) $.ui.toast(`copied ${r.copied} skill(s) to a new .claude/skills; run /reload-skills to load them`)
    } catch (err) {
      fail($, err)
    }
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    try {
      const r = await run($, home)
      if (r.present) return { ...result, reloadSkills: true }
    } catch (err) {
      fail($, err)
    }
    return result
  })
}
