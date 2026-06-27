# /save — Durable Agent Memory

Use this skill when the user wants to save an important lesson, correction, rule, product decision, workflow lesson, or durable preference from the current task into project memory.

Canonical brain specs:

```txt
ai-projects-brain/agent-skills/save.md
ai-projects-brain/agent-skills/save-runtime.md
```

## Trigger

```txt
/save
память:
ошибка:
правило:
решение:
```

## Required behavior

1. Locate `agent-memory/`.
2. Read `agent-memory/active.md` and `agent-memory/index.md`.
3. Extract the durable lesson.
4. Classify it and assign memory type.
5. Upsert, do not append blindly.
6. Merge duplicates and replace contradictions.
7. Ensure active memory has `Apply when`, `Check`, and `Failure if ignored`.
8. Report what changed.
