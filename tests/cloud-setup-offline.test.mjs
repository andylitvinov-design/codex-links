import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("offline cloud setup preserves configuration checks without reading local/provider credentials or contacting providers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "codex-links-offline-check-"));
  const sentinel = "SYNTHETIC_CREDENTIAL_MUST_NOT_BE_READ";
  try {
    await writeFile(join(cwd, ".dev.vars"), "SLACK_BOT_TOKEN=" + sentinel + "\nSLACK_CODEX_CHANNEL_ID=C_FAKE\n");
    const script = fileURLToPath(new URL("../scripts/check-cloud-setup.mjs", import.meta.url));
    const guard = fileURLToPath(new URL("./helpers/no-external-effects.mjs", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", guard, script, "--offline"], {
      cwd,
      env: {
        PATH: process.env.PATH || "",
        CI: "true",
        SLACK_BOT_TOKEN: sentinel,
        SLACK_CODEX_CHANNEL_ID: "C_FAKE",
        LINKS_WRITE_TOKEN: sentinel,
        OPENAI_API_KEY: sentinel,
        CODEX_LINKS_URL: "https://fixture.invalid"
      },
      encoding: "utf8",
      timeout: 5000
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Offline cloud setup checks passed/);
    assert.match(result.stdout, /Live provider health is not checked/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
  } finally {
    await rm(cwd, {recursive: true, force: true});
  }
});

