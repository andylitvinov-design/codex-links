# Codex Links

Мини-сервис для сбора ссылок, которые Codex может отправлять после генерации HTML-страниц.

## Cloud-Ready Summary

- status: `active/cloud-ready`
- purpose: держать общий inbox ссылок и команд, доступный с телефона и с компьютера
- current status: есть рабочий Cloudflare Pages сервис с API для ссылок и команд
- next steps:
  - подключить репозиторий к GitHub, если ещё не подключён
  - держать `STATE.md` актуальным перед каждой новой сессией
  - использовать публичный deploy как основную точку входа с телефона

## Что есть в v1

- публичная страница со списком ссылок по тегам
- `GET /api/links`
- `POST /api/links` с токеном записи
- `POST /api/commands` для сообщений в Codex
- `GET /api/commands?status=pending` для heartbeat-поллинга
- fallback-маршрут `GET /add?...`
- ручная форма на главной странице

## Локальный запуск

1. Скопировать `.dev.vars.example` в `.dev.vars`
2. Задать `LINKS_WRITE_TOKEN`
3. Установить зависимости:

```bash
npm install
```

4. Запустить dev-сервер:

```bash
npm run dev
```

## Деплой в Cloudflare Pages

1. Убедиться, что Pages project `codex-links` существует
2. Задать секрет:

```bash
npx wrangler pages secret put LINKS_WRITE_TOKEN --project-name codex-links
```

3. Задеплоить:

```bash
npm run deploy
```

## Канонический формат для Codex

Основной способ:

```bash
curl -X POST "https://<your-domain>/api/links" \
  -H "Content-Type: application/json" \
  -H "X-Write-Token: <LINKS_WRITE_TOKEN>" \
  -d '{
    "url": "https://example.com/page.html",
    "title": "Example page",
    "note": "Собрано после генерации HTML",
    "tags": ["html", "client"],
    "source": "codex"
  }'
```

Fallback-способ:

```text
https://<your-domain>/add?token=<LINKS_WRITE_TOKEN>&url=https%3A%2F%2Fexample.com%2Fpage.html&title=Example%20page&tags=html,client&note=ready&source=codex
```

## Обратная связь в Codex

Сайт также поддерживает сообщения в беседу `Links`:

- UI-форма `Команда для Codex` отправляет `POST /api/commands`
- heartbeat automation `Links inbox` забирает `pending` команды и публикует их в эту беседу
- после публикации команда помечается как `acked`
- история команд, ответов и каталога чатов хранится 7 дней
- UI на сайте показывает общую историю за последние 7 дней на всех устройствах, а не только сообщения текущего браузера

Прямой API-формат:

```bash
curl -X POST "https://<your-domain>/api/commands" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "обнови последнюю ссылку и добавь тег client",
    "threadId": "links",
    "threadLabel": "Links",
    "photo": {
      "fileName": "screen.png",
      "contentType": "image/png",
      "size": 12345,
      "dataUrl": "data:image/png;base64,..."
    }
  }'
```

## KV storage

Все записи хранятся в одном KV-ключе: `links:index:v1`.
Это нормально для однопользовательского v1 без конкурентной высокой нагрузки.
