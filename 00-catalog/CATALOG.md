# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it, or checking what it does not do. |
| `hooks/register.tsx` | You are changing what is copied, when, the write guard, or the toasts. |
| `tests/sync.test.tsx`, `tests/register.test.tsx`, `tests/review-*.test.tsx` | You changed the module: `tests/release.sh` runs them (the tests: the copy on a mocked disk, both hooks with the engine beneath, and the review cases: a copy cut short, two runs at once, linked files, a hand-made link). |
| `tests/real-disk.cjs` | You changed filesystem handling: a separate Node probe against a compiled hooks module, covering type conflicts, cross-copy symlinks, overlapping runs and retry after a failed write. `tests/release.sh` runs it. |
| `tests/release.sh`, `tests/typecheck.sh`, `tests/checklist.py`, `tests/review-checks.py` | You are releasing: validate, test, type check, plugin directory checklist, version check; exit non-zero on any failing. `nightlab-release.json` names the release command for the maintainer's release tooling. |
| `CHANGELOG.md` | You are cutting a version: what changed and why. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how the plugin loads, its `home` option, or which module it runs. |
| `preview/project/` | You are checking it on a screen: a project with `.agents/skills/house-style/` to copy and its own `.claude/skills/release-notes/`. |
| `01-context/purpose.md` | You wonder who this is for and what request it answers. |
| `04-memory/STATE.md`, `04-memory/log/` | You need what is true now, or history. |
