// Run with node tests/real-disk.cjs /absolute/path/to/compiled/register.js.
// Compile hooks/register.tsx with tsc --module commonjs into a temporary folder first.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { MARK, register, sync } = require(process.argv[2])

const adapter = () => {
  const writes = []
  const disk = {
    read: p => fs.readFile(p, 'utf8'),
    write: async (p, text) => {
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, text)
      writes.push(p)
    },
    exists: async p => fs.access(p).then(() => true, () => false),
    stat: async p => {
      // The engine answers a link to nowhere as `other`, with no realPath.
      const s = await fs.stat(p).catch(err => err.code === 'ENOENT' ? fs.lstat(p) : Promise.reject(err))
      if (s.isSymbolicLink()) return { kind: 'other' }
      return { kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', realPath: await fs.realpath(p) }
    },
    list: async p => (await fs.readdir(p, { withFileTypes: true })).map(e => ({
      name: e.name, kind: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
    })),
  }
  return { disk, writes }
}

const main = async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-skills-disk-'))
  let failures = 0
  const check = async (name, body) => {
    try { await body(); console.log(`PASS ${name}`) }
    catch (err) { failures++; console.error(`FAIL ${name}: ${err.message}`) }
  }
  try {
    for (const [name, before, after, errno] of [
      ['file to folder', 'a', 'a/ref.md', 'ENOTDIR'],
      ['folder to file', 'a/ref.md', 'a', 'EISDIR'],
      ['same type', 'a', 'a', undefined],
    ]) {
      await check(name, async () => {
        const root = path.join(tmp, name)
        const a = `${root}/.agents/skills`
        const c = `${root}/.claude/skills`
        const { disk, writes } = adapter()
        await disk.write(`${a}/style/SKILL.md`, 'S')
        await disk.write(`${a}/style/z.md`, 'old')
        await disk.write(`${a}/style/${before}`, 'before')
        assert.deepEqual((await sync(disk, a, c)).failed, [])
        if (errno) {
          let code
          await assert.rejects(disk.write(`${c}/style/${after}`, 'probe'), err => {
            code = err.code
            return errno === 'ENOTDIR' ? ['ENOTDIR', 'EEXIST'].includes(code) : code === 'EISDIR'
          })
          console.log(`  native collision: ${code}`)
        }
        await fs.rm(`${a}/style/a`, { recursive: true })
        await disk.write(`${a}/style/${after}`, 'after')
        await disk.write(`${a}/style/z.md`, 'new')
        const [result, overlapping] = await Promise.all([sync(disk, a, c), sync(disk, a, c)])
        assert.equal(overlapping.failed.length, result.failed.length)
        assert.equal(await disk.read(`${c}/style/z.md`), 'new')
        if (errno) {
          assert(result.failed.some(f => f.includes(after) && f.includes(errno)))
          assert.equal(await disk.read(`${c}/style/${before}`), 'before')
        } else {
          assert.deepEqual(result.failed, [])
          assert.equal(await disk.read(`${c}/style/${after}`), 'after')
        }
        const count = writes.length
        const again = await sync(disk, a, c)
        assert.deepEqual(again.copied, [])
        assert.equal(writes.length, count)
      })
    }
    await check('cross-copy symlinks through both hooks, including an aliased home destination', async () => {
      const home = `${tmp}/home`
      const root = `${home}/project`
      const hc = `${home}/.claude/skills`
      const rc = `${root}/.claude/skills`
      const { disk, writes } = adapter()
      await disk.write(`${root}/.agents/skills/style/SKILL.md`, 'S')
      await disk.write(`${home}/.agents/skills/base/SKILL.md`, 'B')
      await fs.mkdir(`${home}/stored-skills`, { recursive: true })
      await fs.mkdir(path.dirname(hc), { recursive: true })
      await fs.symlink(`${home}/stored-skills`, hc)
      await fs.mkdir(rc, { recursive: true })
      await fs.symlink(`${home}/stored-skills`, `${root}/.agents/skills/style/h`)
      await fs.symlink(rc, `${home}/.agents/skills/base/p`)
      const hooks = new Map()
      register((event, hook) => hooks.set(event, hook), { home })
      const api = { fs: disk, session: { root: async () => root }, ui: { toast: () => {} } }
      const start = () => hooks.get('session.start')(api, {}, async e => e)
      const classic = () => hooks.get('classic.SessionStart')(api, {}, async () => ({}))
      await start()
      const count = writes.length
      await Promise.all([start(), classic()])
      await start()
      assert.equal(writes.length, count)
      assert.equal(await disk.read(`${rc}/style/SKILL.md`), 'S')
      assert.equal(await disk.read(`${hc}/base/SKILL.md`), 'B')
    })
    await check('retry after an interrupted payload write', async () => {
      const a = `${tmp}/retry/.agents/skills`
      const c = `${tmp}/retry/.claude/skills`
      const { disk } = adapter()
      await disk.write(`${a}/style/SKILL.md`, 'S')
      const write = disk.write
      disk.write = async (p, text) => {
        if (p === `${c}/style/SKILL.md`) throw new Error('ENOSPC')
        await write(p, text)
      }
      assert.equal((await sync(disk, a, c)).failed.length, 1)
      assert(await disk.exists(`${c}/style/${MARK}`))
      disk.write = write
      assert.deepEqual((await sync(disk, a, c)).failed, [])
      assert.equal(await disk.read(`${c}/style/SKILL.md`), 'S')
    })
  } finally { await fs.rm(tmp, { recursive: true, force: true }) }
  if (failures) process.exitCode = 1
}
main().catch(err => { console.error(err); process.exitCode = 1 })
