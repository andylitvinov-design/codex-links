# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: перевести `cloud` на private trusted cloud bridge через уже авторизованный Codex login на trusted machine, не используя Slack и API-key cloud path
- saved rollback point: production build `20260418-1518`, live notification sent `2026-04-18T17:08:30Z`
- last root cause recorded: предыдущий cloud path смешивал несколько executor routes (`direct-openai`, `Slack`, `bridge`), из-за чего cloud mode был трудно диагностировать и небезопасно завязан на внешние auth paths; новое решение: Pages broker -> private cloud bridge -> local Codex login с явными progress callbacks и без передачи auth state наружу
- next step: поднять private bridge на trusted machine, прогнать `npm run cloud:check`, `npm run cloud:smoke`, `npm run cloud:photo-smoke`, затем проверить preview deploy и branch -> PR release flow
