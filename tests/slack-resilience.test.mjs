import test from "node:test";
import assert from "node:assert/strict";

import { fetchSlackThreadReplies } from "../functions/_lib/slack.js";
import { runSlackSyncWithinBudget } from "../functions/api/commands.js";

test("fetchSlackThreadReplies aborts hanging Slack requests after the configured timeout", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_API_TIMEOUT_MS: "20"
  };

  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        reject(new Error("aborted by test signal"));
      }, { once: true });
    }
  });

  try {
    await assert.rejects(
      fetchSlackThreadReplies(env, "C123", "1712345678.000100"),
      /timed out|aborted/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSlackSyncWithinBudget returns after the read budget is exhausted", async () => {
  const startedAt = Date.now();
  const result = await runSlackSyncWithinBudget(
    () => new Promise(() => {}),
    25
  );

  assert.equal(result, false);
  assert.ok(Date.now() - startedAt < 250, "budgeted sync should stop quickly");
});
