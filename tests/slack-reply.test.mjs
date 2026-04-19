import test from "node:test";
import assert from "node:assert/strict";

import { deriveSlackReplyOutcome } from "../functions/_lib/slack.js";

test("generic Slack progress does not count as execution ack", () => {
  const outcome = deriveSlackReplyOutcome({
    status: "dispatched",
    photoAttached: false,
    firstExecutorAckSeenAt: ""
  }, "Checking the repo and preparing a fix.");

  assert.equal(outcome.status, "dispatched");
  assert.equal(outcome.progressStage, "waiting-execution-ack");
  assert.equal(outcome.executionAckPresent, false);
  assert.equal(outcome.executionAckValid, false);
});

test("structured execution ack starts text commands", () => {
  const outcome = deriveSlackReplyOutcome({
    status: "dispatched",
    photoAttached: false,
    firstExecutorAckSeenAt: ""
  }, 'CODEX_LINKS_EXECUTION_ACK {"type":"CODEX_LINKS_EXECUTION_ACK","status":"started"}');

  assert.equal(outcome.status, "processing");
  assert.equal(outcome.progressStage, "execution-ack");
  assert.equal(outcome.executionAckPresent, true);
  assert.equal(outcome.executionAckValid, true);
});

test("photo commands require photo_ready=true in execution ack", () => {
  const waiting = deriveSlackReplyOutcome({
    status: "dispatched",
    photoAttached: true,
    firstExecutorAckSeenAt: ""
  }, 'CODEX_LINKS_EXECUTION_ACK {"type":"CODEX_LINKS_EXECUTION_ACK","status":"started","photo_ready":false}');

  assert.equal(waiting.status, "dispatched");
  assert.equal(waiting.progressStage, "waiting-photo-ready");
  assert.equal(waiting.executionAckPresent, true);
  assert.equal(waiting.executionAckValid, false);
  assert.equal(waiting.lastDiagnosticCode, "cloud_photo_not_ready");

  const ready = deriveSlackReplyOutcome({
    status: "dispatched",
    photoAttached: true,
    firstExecutorAckSeenAt: ""
  }, 'CODEX_LINKS_EXECUTION_ACK {"type":"CODEX_LINKS_EXECUTION_ACK","status":"started","photo_ready":true}');

  assert.equal(ready.status, "processing");
  assert.equal(ready.progressStage, "execution-ack-photo-ready");
  assert.equal(ready.executionAckValid, true);
  assert.equal(ready.executionAckPhotoReady, true);
});
