# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it, or checking what it does not do. |
| `hooks/register.tsx` | You are changing what is copied, when, the write guard, or the toasts. |
| `tests/sync.test.tsx`, `tests/register.test.tsx` | You changed the module: `tests/release.sh` runs them (15 tests: the copy on a mocked disk, and both hooks with the engine beneath). |
| `tests/release.sh`, `tests/typecheck.sh`, `tests/checklist.py` | You are releasing: validate, test, type check, plugin directory checklist, version check; exit non-zero on any failing. `nightlab-release.json` names the release command for the maintainer's release tooling. |
| `CHANGELOG.md` | You are cutting a version: what changed and why. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how the plugin loads, its `home` option, or which module it runs. |
| `preview/project/` | You are checking it on a screen: a project with only `.agents/skills/house-style/`. |
| `01-context/purpose.md` | You wonder who this is for and what request it answers. |
| `04-memory/STATE.md`, `04-memory/log/` | You need what is true now, or history. |
