# Changelog

## Unreleased

- README: the opening is rewritten; the install line and the picture are on the first screen.
- README, npm description and marketplace entry say plugin, not mod. The README links the
  Nightlab YouTube channel.
- README: a copied skill loading in the same session is now seen on a screen (a project that
  already had a `.claude/skills/` folder; the skill loaded at the first prompt, no restart). The
  reload request itself is still not seen on a screen.
- Tests: a slow copy still holding a skill's old text, finishing after a newer copy began, does not
  land over the newer one (fails if the two runs on one folder are not kept in order). No change
  to what the code does.

## 0.1.0 (2026-10-30)

- First version: at session start, each skill in the project's `.agents/skills/` (and in
  `<home>/.agents/skills/` when the `home` option is set) is copied into the matching
  `.claude/skills/` folder, and Claude Code is asked to reload its skills (the reload in the same
  session is not yet seen on a real screen). A skill of yours with the
  same name is never written over; an unchanged copy is left alone; each copy ignores
  itself in git (its `.gitignore` is written first, so a copy cut short stays out of git
  and is finished at the next session); skill files that are symbolic links are followed;
  a link you made by hand to the same skill is left alone; a write outside
  `.claude/skills/` is refused.
