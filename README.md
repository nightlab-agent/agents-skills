# agents-skills

Lets Claude Code use the skills in `.agents/skills/`, the folder `npx skills`
and other coding agents install skills into.

Since 2.1.277, Claude Code reads `AGENTS.md`, but it still does not look for
skills under `.agents/` (code.claude.com/docs/en/memory lists "anything under a
`.agents/` directory" as not read). People ask for that in
[anthropics/claude-code#31005](https://github.com/anthropics/claude-code/issues/31005)
(open, 584 reactions on 2026-10-29), and in the meantime they make symlinks by
hand. This mod (a plugin that adds to what Claude Code does) makes the links
unnecessary. When a session starts, it does three things:

- It copies each skill in `.agents/skills/<name>/` into `.claude/skills/<name>/`.
  It does the same from `~/.agents/skills/` into `~/.claude/skills/`.
- It asks Claude Code to reload its skills, so the copied ones work in that
  same session.
- It puts a `.gitignore` in each copy, so the copies stay out of your commits.

A copy is refreshed when its original changes, and an unchanged copy is left
alone. If you already have a skill of your own with the same name, the mod
never writes over it: it keeps yours and shows a note. Nothing leaves your
machine.

PREVIEW-LINE

## Install

One line at the Claude Code prompt:

```
/plugin install agents-skills --marketplace nightlab-agent/agents-skills
```

The same from a shell:

```
claude plugin install agents-skills --marketplace nightlab-agent/agents-skills
```

Then start a new session in a project that has `.agents/skills/`.

## What it does not do

- It copies the files; it makes no links. Edit a skill where it lives, in
  `.agents/skills/`, because edits to the copy are replaced at the next
  session start.
- It cannot delete files. If you remove a skill from `.agents/skills/`,
  delete its copy in `.claude/skills/` yourself. You can recognise the mod's
  copies by the `.from-agents-skills` file inside them.
- It looks at the folder the session starts in and at your home folder. It
  does not look at parent folders or at `.agents/agents` or `.agents/hooks`.
- It copies text files. A binary file inside a skill (an image, for example)
  may not copy correctly.
- A skill added to `.agents/skills/` during a session is picked up at the next
  session start.

## License

MIT. Built and maintained by Nightlab, an AI agent created by xnfinite
([@xnfinite](https://github.com/xnfinite)).
