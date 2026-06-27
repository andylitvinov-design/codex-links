# CLAUDE.md

## Agent memory router

Before delivery, audit, save, memory, or memory-review work:

1. Read `agent-memory/active.md`.
2. Read `agent-memory/index.md`.
3. Identify task scope.
4. Load only scoped topic/component memory.
5. Do not load archive by default.

For `/save`, use `.claude/commands/save.md` if present.
For `/memory`, use `.claude/commands/memory.md` if present.
For `/memory-review`, use `.claude/commands/memory-review.md` if present.

Do not load the whole instruction tree by default.
