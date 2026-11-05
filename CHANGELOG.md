# Changelog

## 0.1.2 - 2026-11-05

- A refused home folder no longer drops the project copy's reload.
- Known: with the `home` option, a project skill and a home skill that each link into the other's copies still grow both copies each session.
- Known: a source entry that turns from a file into a folder, or back, stops that skill's copy refreshing until the copy is deleted by hand.
- Known: A session killed between a copy's first two writes leaves the small mark file showing in `git status` until the next session finishes the copy.
- Fixed: a source skill's own `.gitignore` replaced the copy's, so the copy could be committed.
  Files named `.gitignore` or `.from-agents-skills` at the top of a source skill now stay out of
  the copy, and a copy that lost its `.gitignore` this way gets it back at the next session.
- Fixed: a copy file or copy folder that is a symbolic link could take a write outside
  `.claude/skills/` (a copy file linked to your notes was overwritten). The write is now checked
  against where it lands, and refused when a link leads outside or nowhere.
- Fixed: a copy cut short could stay skipped for good. The mark is now written first, so the next
  session finishes it; a folder with no mark stays yours, even an empty one.
- Fixed: a link inside a skill to a folder above it, to the project root, or into `.claude/skills` (`loop -> .`, `root -> ../../..`) stopped the whole copy. Such a link is no longer walked.
- Fixed: one skill that could not be copied stopped the skills after it and lost the note to run
  `/reload-skills`. The others are now copied, the note shows, and the failure is named in a toast.
- Tests: the type check now covers `tests/`, as it said it did. The sample project's README says
  what the project holds.

## 0.1.1 - 2026-11-03

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
