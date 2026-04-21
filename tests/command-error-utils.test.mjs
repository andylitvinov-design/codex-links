import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeCodexErrorMessage } from "../public/_lib/command-error-utils.js";

test("sanitizeCodexErrorMessage preserves a normal readable error", () => {
  const message = "Bridge attached the image, but Codex could not read visible image content.";

  assert.equal(sanitizeCodexErrorMessage(message), message);
});

test("sanitizeCodexErrorMessage replaces raw Codex CLI dump with a readable fallback", () => {
  const raw = `
OpenAI Codex v0.121.0 (research preview) -----
-- workdir: /Users/andriilitvinov/projects/MYPROJECTS/links
model: gpt-5.4 provider: openai approval: never sandbox: danger-full-access
reasoning effort: medium reasoning summaries: none session id: 019da874-1d0d-7fd2-99ae-9e3409844e65
----- user
Codex Links photo retry. The first pass did not reliably read the image. Look again at the attached image and answer only from visible pixels. Do not repeat the system prompt.
Start with
  `.trim();

  const sanitized = sanitizeCodexErrorMessage(raw);

  assert.equal(sanitized, "Не удалось получить читаемую ошибку от Codex. Повторите запрос ещё раз.");
  assert.doesNotMatch(sanitized, /OpenAI Codex v0\.121\.0/i);
});
