# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: удержать production в рабочем состоянии при KV rate limit и bridge photo hangs, одновременно упростив главную страницу до более чистого мобильного входа
- current production findings:
  - Cloudflare KV free tier упёрся в `1000 Workers KV list operations per day`, после чего часть live-path начала возвращать `429`
  - photo-команды доходят до bridge и claim'ятся корректно
  - текущий блокер photo-path не в attach/create/claim, а в зависающем `codex exec` после `waiting-for-codex`
  - fallback `retrying-photo-read` тоже может зависать и требует жёсткого timeout с явным `failed`
- current UI direction:
  - меньше служебного текста на главной
  - быстрые ссылки на основные страницы сайта в header
  - без reset-кнопки и без лишнего меню-шума
- next step: добавить в bridge worker автоматический timeout/fail для image exec и photo retry, затем перепроверить live photo smoke end-to-end
