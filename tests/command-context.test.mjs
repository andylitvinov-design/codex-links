import test from "node:test";
import assert from "node:assert/strict";

import { createCommandRecord } from "../functions/_lib/commands.js";

test("createCommandRecord keeps user text and builds effective prompt from previous assistant reply", () => {
  const created = createCommandRecord({
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Сделай следующий шаг по этой задаче",
    previousAssistantReply: "Я нашел проблему в delivery pipeline и подготовил фикс."
  });

  assert.equal(created.ok, true);
  assert.equal(created.value.text, "Сделай следующий шаг по этой задаче");
  assert.equal(created.value.previousAssistantReply, "Я нашел проблему в delivery pipeline и подготовил фикс.");
  assert.match(created.value.effectivePrompt, /Previous Codex answer in this same thread:/);
  assert.match(created.value.effectivePrompt, /Я нашел проблему в delivery pipeline и подготовил фикс\./);
  assert.match(created.value.effectivePrompt, /New user follow-up:/);
  assert.match(created.value.effectivePrompt, /Сделай следующий шаг по этой задаче/);
});

test("createCommandRecord falls back to plain user text when previous assistant reply is absent", () => {
  const created = createCommandRecord({
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Проверь еще раз"
  });

  assert.equal(created.ok, true);
  assert.equal(created.value.text, "Проверь еще раз");
  assert.equal(created.value.previousAssistantReply, "");
  assert.equal(created.value.effectivePrompt, "Проверь еще раз");
});

test("createCommandRecord marks photo-heavy diagnostic requests as Claude-fallback eligible", () => {
  const created = createCommandRecord({
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: [
      "Исследуй production routing, подготовь remediation report и rollout plan.",
      "Сравни несколько delivery paths, проверь fallback behavior и диагностику.",
      "Опиши, что сломано, какие несколько файлов нужно менять, и как делать merge и deploy.",
      "Повтори этот анализ подробно для bridge, cloud и photo delivery.".repeat(12)
    ].join("\n"),
    previousAssistantReply: "Есть деградация cloud path и зависания bridge. Нужен подробный отчёт."
  });

  assert.equal(created.ok, true);
  assert.equal(created.value.allowClaudeFallback, true);
  assert.equal(created.value.complexityLevel, "high");
  assert.ok(created.value.complexityScore >= 4);
});
