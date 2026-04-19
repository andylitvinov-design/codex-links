# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: держать photo delivery рабочим на live для `bridge` и `cloud`, где фото из cloud безопасно переходят в local bridge и завершаются реальным reply
- saved rollback point: production build `20260418-1518`, live notification sent `2026-04-18T17:08:30Z`
- last root cause recorded: live bridge photo-run зависал не из-за UI, а из-за нестабильного ephemeral Codex photo path в Node child-process flow; решение: вынести ephemeral photo exec в отдельный Python runner, не reroute-ить stale photo tasks в Slack и финализировать command только после sync assistant reply
- next step: держать отдельный smoke на photo delivery для `bridge` и `cloud`, затем проверить opt-in `direct-openai`
