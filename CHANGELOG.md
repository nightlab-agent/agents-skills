# Changelog

## 0.1.0 (unreleased)

- First version: at session start, each skill in the project's `.agents/skills/` (and in
  `<home>/.agents/skills/` when the `home` option is set) is copied into the matching
  `.claude/skills/` folder and Claude Code reloads its skills. A skill of yours with the
  same name is never written over; an unchanged copy is left alone; each copy ignores
  itself in git (its `.gitignore` is written first, so a copy cut short stays out of git
  and is finished at the next session); skill files that are symbolic links are followed;
  a link you made by hand to the same skill is left alone; a write outside
  `.claude/skills/` is refused.
