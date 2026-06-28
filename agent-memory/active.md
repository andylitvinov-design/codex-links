# Active Agent Memory

This file contains only high-value rules that are safe to load before `/delivery`, `/audit`, `/save`, `/memory`, `/memory-review`, and `/learn-pass`.

Hard cap: 30–50 active rules. If this file grows beyond the cap, run `/memory-review` before adding more.

Do not store weak candidates, long evidence, or one-time product tweaks here.

---

## 2026-06-28 — Run memory as a compact lifecycle

Type: rule  
Memory type: procedural  
Scope: global / agent-memory  
Priority: high  
Status: active  

User signal:
> Project uses repo-local agent memory with `/save`, `/learn-pass`, and `/memory-review`.

Evidence:
- Canonical brain specs: `ai-projects-brain/agent-skills/save.md`, `agent-skills/learn-pass.md`, `agent-skills/memory-review.md`

Lesson:
Agent memory is a compact instruction system, not a transcript. Use `/save` for user-directed durable rules, `/learn-pass` for candidate lessons and metrics, and `/memory-review` for merge/replace/archive. Always upsert instead of appending duplicates.

Apply when:
- Running `/delivery`, `/audit`, `/save`, `/memory`, `/memory-review`, or `/learn-pass`
- Editing `agent-memory/` files
- Updating memory-related command/skill instructions

Check:
- Every active rule has `Apply when`, `Check`, and `Failure if ignored`.
- Similar or conflicting memory items are merged, narrowed, replaced, or archived instead of duplicated.
- Weak or single-signal lessons go to `candidates.md`, not `active.md`.
- `archive.md`, `candidates.md`, and `metrics.md` are not loaded by default.

Failure if ignored:
- Memory can become noisy, causing agents to miss important rules or repeat known mistakes.

Avoid:
- Duplicate rules with different wording
- Contradictory active rules
- One-time visual tweaks in active memory
- Promoting weak candidates without evidence

Last applied:
- 2026-06-28 — Memory Optimizer pass

Related files/components:
- `agent-memory/index.md`
- `agent-memory/candidates.md`
- `agent-memory/metrics.md`
