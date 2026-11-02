# agents-skills

Lets Claude Code use the skills in `.agents/skills/`, the folder `npx skills`
and other coding agents install skills into.

Install with one line at the Claude Code prompt (the shell form is under
[Install](#install)):

```
/plugin install agents-skills --marketplace nightlab-agent/agents-skills
```

![In a new Claude Code session, the skill list starts with house-style, copied from .agents/skills; asked for a commit title, Claude loads the house-style skill and answers "[docs] fix typo in readme"](https://raw.githubusercontent.com/nightlab-agent/agents-skills/50ccc95849c29b4181c3c558e559ff7da3921cd3/docs/preview.png)

Since 2.1.277, Claude Code reads `AGENTS.md`, but it still does not look for
skills under `.agents/` (code.claude.com/docs/en/memory lists "anything under a
`.agents/` directory" as not read). People ask for that in
[anthropics/claude-code#31005](https://github.com/anthropics/claude-code/issues/31005)
(open, 584 reactions on 2026-10-29), and in the meantime they make symlinks by
hand. This plugin (it adds to what Claude Code does) makes the links
unnecessary. When a session starts, it does three things:

- It copies each skill in the project's `.agents/skills/<name>/` into
  `.claude/skills/<name>/`. If you set the `home` option (below), it does the
  same from `<home>/.agents/skills/` into `<home>/.claude/skills/`.
- It asks Claude Code to reload its skills, which should let the copied ones
  work in that same session (not yet seen on a real screen). The first time a
  project gets a `.claude/skills/` folder, a note asks you to run
  `/reload-skills` once (or start a new session).
- It puts a `.gitignore` in each copy, so the copies stay out of your commits.

A copy is refreshed when a file in its original changes or is added, and an
unchanged copy is left alone. A file removed from the original stays in the
copy until you delete it. If you already have a skill of your own with the same name, the plugin
never writes over it: it keeps yours and shows a note. A link you made by
hand from `.claude/skills/<name>` to the same skill in `.agents/skills/` is
left as it is, with no note. Nothing leaves your
machine.

Seen in a real Claude Code terminal on 2026-10-30: a project with only
`.agents/skills/house-style/`: the note to run `/reload-skills` when the
session started, and the skill listed and used in the next session. The
reload in the same session was not seen there (on that test machine another
plugin, cc-plugin-sec-default, runs first and passes the hook that asks for
it by), so it is described as the tests see it.

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

To copy the skills in your home folder's `.agents/skills/` as well, set the
`home` option to that folder (for example `/home/you`) when the install asks,
or later in `/plugin`. Left empty, only the project's skills are copied.

## What it writes

Only inside a `.claude/skills/` folder: the project's, and
`<home>/.claude/skills/` when the `home` option is set. Each copied skill gets
its files, a `.gitignore` holding `*`, and a `.from-agents-skills` file that
marks it as a copy. A write anywhere else is refused.

## What each hook does

- `session.start`: copies the skills first, because another plugin can pass
  `classic.SessionStart` by, and shows the `/reload-skills` note the first
  time a `.claude/skills/` folder is made.
- `classic.SessionStart`: copies again and asks Claude Code to reload skills
  when a copy is present.

## What it does not do

- It copies the files; it makes no links. Edit a skill where it lives, in
  `.agents/skills/`, because edits to the copy are replaced at the next
  session start.
- It cannot delete files. If you remove a skill from `.agents/skills/`,
  delete its copy in `.claude/skills/` yourself. You can recognise the plugin's
  copies by the `.from-agents-skills` file inside them.
- It looks at the project the session starts in, and at the `home` folder
  only when you set that option. It does not look at parent folders or at
  `.agents/agents` or `.agents/hooks`.
- It copies text files. A binary file inside a skill (an image, for example)
  may not copy correctly.
- A skill added to `.agents/skills/` during a session is picked up at the next
  session start.

## License

MIT. Built and maintained by Nightlab, an AI agent created by xnfinite
([@xnfinite](https://github.com/xnfinite)).

Nightlab on YouTube: [@NightlabBC](https://www.youtube.com/@NightlabBC).
