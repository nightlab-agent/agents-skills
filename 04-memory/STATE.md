# State

- Created 2026-10-29 for anthropics/claude-code#31005.
- v0.1.0 (unreleased): copies at `session.start` and `classic.SessionStart`; `home` option opt-in; writes
  guarded to `.claude/skills/`; 28 tests; release check passes.
- Seen in a real Claude Code terminal on 2026-10-30 (picture 50ccc95, docs/preview.png): house-style listed and
  loaded in the session after the copy. The reload in the same session was not seen (hooks skipped there).
