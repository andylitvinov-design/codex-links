import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("reply card keeps the green Codex reply button", () => {
  assert.match(appSource, /class="button button-primary command-answer-reply"/);
});

test("reply UI styles are not broken by malformed report badge CSS", () => {
  assert.doesNotMatch(styleSource, /\.report-item-source-badges span \{\s*\.report-item-source-badges a \{/);
  assert.match(styleSource, /\.report-item-source-badges span,\s*\.report-item-source-badges a \{/);
});

test("timeline still renders grouped replies under the source command entry", () => {
  assert.match(appSource, /const repliesMarkup = \(entry\.replies \|\| \[\]\)\.map\(\(replyEntry\) => renderAssistantReplyMarkup\(replyEntry\)\)\.join\(""\);/);
  assert.match(appSource, /\$\{repliesMarkup\}/);
  assert.match(appSource, /message\.role === "assistant" && \(commandId \|\| threadedAssistantMessageIds\.has\(String\(message\.id \|\| ""\)\.trim\(\)\)\)/);
});

test("reply cards use executor-specific titles", () => {
  assert.match(appSource, /return "Ответ Codex - Bridge";/);
  assert.match(appSource, /return "Ответ Codex - Cloud";/);
  assert.match(appSource, /return "Ответ Claude";/);
});

test("timeline hides delivery note once grouped replies are present", () => {
  assert.match(appSource, /const hasReplies = Array\.isArray\(entry\.replies\) && entry\.replies\.length > 0;/);
  assert.match(appSource, /const deliveryStatus = hasReplies \? null : getCommandDeliveryStatus\(command\);/);
  assert.match(appSource, /: \(hasReplies \? null : \(getCommandDeliveryStatus\(linkedCommand\) \|\| getFallbackMessageDeliveryStatus\(message\?\.commandId\)\)\);/);
});
