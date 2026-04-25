import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("reply card keeps the green Codex reply button", () => {
  assert.match(appSource, /class="button button-primary command-answer-reply"/);
});

test("reply button can recover reply text from grouped entry data", () => {
  assert.match(appSource, /const replyEntriesById = new Map\(/);
  assert.match(appSource, /const replyText = String\(replyEntry\?\.text \|\| message\?\.text \|\| ""\)\.trim\(\);/);
});

test("mobile reply context stacks text and clear action vertically", () => {
  assert.match(styleSource, /\.reply-context-bar \{\s*flex-direction: column;/);
  assert.match(styleSource, /\.reply-context-clear \{\s*width: 100%;/);
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

test("reply cards expose executor-specific accent hooks", () => {
  assert.match(appSource, /function getCommandAnswerExecutor\(command\)/);
  assert.match(appSource, /data-executor="\$\{escapeHtml\(executor\)\}"/);
  assert.match(appSource, /element\.dataset\.executor = getCommandAnswerExecutor\(entry\.linkedCommand\);/);
});

test("cloud is blue and Claude is orange across controls and reply accents", () => {
  assert.match(appSource, /value === "cloud-via-slack" \|\| value === "slack-codex-cloud"/);
  assert.match(appSource, /value === "claude" \|\| value === "claude-bridge"/);
  assert.match(styleSource, /\.dispatch-toggle-button\[data-mode="cloud"\] \.dispatch-toggle-lamp \{[^}]*rgba\(59, 130, 246/);
  assert.match(styleSource, /\.dispatch-toggle-button\.is-active\[data-mode="cloud"\] \{[^}]*#1d4ed8/);
  assert.match(styleSource, /\.dispatch-toggle-button\[data-mode="claude"\] \.dispatch-toggle-lamp \{[^}]*rgba\(245, 158, 11/);
  assert.match(styleSource, /\.dispatch-toggle-button\.is-active\[data-mode="claude"\] \{[^}]*#9a4d04/);
  assert.match(styleSource, /\.command-item-assistant\[data-executor="cloud"\] \{[^}]*inset 4px 0 0 rgba\(59, 130, 246/);
  assert.match(styleSource, /\.command-item-assistant\[data-executor="claude"\] \{[^}]*inset 4px 0 0 rgba\(245, 158, 11/);
  assert.match(styleSource, /\.command-answer\[data-executor="cloud"\] \{[^}]*inset 4px 0 0 rgba\(59, 130, 246/);
  assert.match(styleSource, /\.command-answer\[data-executor="claude"\] \{[^}]*inset 4px 0 0 rgba\(245, 158, 11/);
});

test("timeline can keep production delivery note alongside grouped replies", () => {
  assert.match(appSource, /const hasReplies = Array\.isArray\(entry\.replies\) && entry\.replies\.length > 0;/);
  assert.match(appSource, /const deliveryStatus = getCommandDeliveryStatus\(command\);/);
  assert.match(appSource, /: \(getCommandDeliveryStatus\(linkedCommand\) \|\| \(hasReplies \? null : getFallbackMessageDeliveryStatus\(message\?\.commandId\)\)\);/);
  assert.match(appSource, /deliveryStatus === "production-verified"/);
});

test("timeline tabs expose unread signals for inactive tabs", () => {
  assert.match(appSource, /codex-links-timeline-seen-ids/);
  assert.match(appSource, /function updateTimelineSignals\(itemsByTab\)/);
  assert.match(appSource, /button\.classList\.toggle\("has-unread", unreadCount > 0\);/);
  assert.match(styleSource, /\.timeline-tab-button\.has-unread:not\(\.is-active\)::after/);
});

test("new delivery items queue one reply sound per item", () => {
  assert.match(appSource, /function queueReplySounds\(count\)/);
  assert.match(appSource, /index \* 420/);
  assert.match(appSource, /queueReplySounds\(newMessageSoundCount \+ newReportSoundCount\);/);
});
