import test from "node:test";
import assert from "node:assert/strict";

import { resolveClaudeBin, validateClaudeCli } from "../scripts/_lib/claude-cli.mjs";

test("resolveClaudeBin prefers CLAUDE_BIN when provided", () => {
  assert.equal(resolveClaudeBin({ CLAUDE_BIN: "/tmp/custom-claude" }), "/tmp/custom-claude");
});

test("validateClaudeCli fails when the Claude binary is missing", async () => {
  await assert.rejects(
    validateClaudeCli({
      env: {
        CLAUDE_BIN: "/tmp/claude-does-not-exist"
      },
      timeoutMs: 1000
    }),
    /claude|enoent|failed/i
  );
});
