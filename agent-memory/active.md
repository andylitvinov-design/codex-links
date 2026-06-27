# Active Agent Memory

Keep this file compact. Load it before `/delivery`, `/audit`, `/save`, `/memory`, and `/memory-review`.

## Memory system rule

Type: rule  
Memory type: procedural  
Scope: agent-memory  
Priority: high  
Status: active  

Lesson:
Save only reusable, scoped, checkable lessons. `/save` must use upsert, not append.

Apply when:
- Running `/save`
- Running `/delivery`
- Running `/audit`

Check:
- Memory items include `Apply when`, `Check`, and `Failure if ignored`.
- Similar rules are merged instead of duplicated.

Failure if ignored:
- Memory becomes noisy and stops helping future agents.

Last applied:
- never
