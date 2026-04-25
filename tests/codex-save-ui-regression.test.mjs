import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../codex-save/public/app.js", import.meta.url), "utf8");
const styleSource = fs.readFileSync(new URL("../codex-save/public/styles.css", import.meta.url), "utf8");

test("codex-save shows diagnosis timestamps and an hourglass badge for active analysis", () => {
  assert.match(appSource, /created \$\{formatStamp\(run\.createdAt\)\}/);
  assert.match(appSource, /completed \$\{formatStamp\(run\.completedAt\)\}/);
  assert.match(appSource, /class="badge badge-hourglass"/);
  assert.match(appSource, /⏳/);
  assert.match(styleSource, /\.badge-hourglass/);
});

test("codex-save renders recommendations as one copyable field", () => {
  assert.match(appSource, /function buildRecommendationsCopyText/);
  assert.match(appSource, /<textarea class="copy-field" readonly/);
  assert.match(appSource, /recommendations-copy/);
  assert.match(styleSource, /\.copy-field/);
});
