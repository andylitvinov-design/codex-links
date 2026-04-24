import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = path.resolve("scripts/publish-management-report.mjs");

async function createDataRoot(day) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-links-report-"));
  const generatedAt = `${day}T11:30:00.000Z`;

  await fs.writeFile(path.join(root, "current-thinking-audit.json"), JSON.stringify({
    meta: {
      day,
      lastAuditTime: generatedAt,
      overallScore: 70,
      loopHealth: 40,
      summary: "fresh focus"
    },
    priorityRecommendations: []
  }));
  await fs.writeFile(path.join(root, "current-daily-upgrade.json"), JSON.stringify({
    meta: {
      day,
      generatedAt
    },
    systemUpgrades: [{ title: "upgrade" }],
    topActions: [{ action: "ship the report" }]
  }));
  await fs.writeFile(path.join(root, "current-daily-changes.json"), JSON.stringify({
    meta: {
      day,
      generatedAt
    },
    topUpgrades: [{ title: "publish management report" }]
  }));
  await fs.writeFile(path.join(root, "thinking-history.json"), JSON.stringify([{ meta: { overallScore: 68, loopHealth: 39 } }, { meta: { overallScore: 69, loopHealth: 40 } }]));
  await fs.writeFile(path.join(root, "daily-upgrade-history.json"), JSON.stringify([{ systemUpgrades: [] }, { systemUpgrades: [{ title: "previous" }] }]));
  await fs.writeFile(path.join(root, "daily-changes-history.json"), JSON.stringify([{ topUpgrades: [] }, { topUpgrades: [{ title: "previous" }] }]));

  return root;
}

function runPublish(args, dataRoot) {
  return spawnSync(process.execPath, [scriptPath, "--dry-run", "--data-root", dataRoot, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      BRAIN_MANAGEMENT_NOW: "2026-04-24T13:00:00.000Z",
      BRAIN_MANAGEMENT_TIMEZONE: "America/Toronto"
    }
  });
}

test("publish-management-report rejects stale source dates by default", async () => {
  const dataRoot = await createDataRoot("2026-04-23");
  const result = runPublish([], dataRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to publish report_date 2026-04-23/);
});

test("publish-management-report accepts matching Toronto report date", async () => {
  const dataRoot = await createDataRoot("2026-04-24");
  const result = runPublish([], dataRoot);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.report_id, "management-morning-report-2026-04-24");
  assert.equal(report.status, "ok");
});

test("publish-management-report requires explicit flag for date backfill", async () => {
  const dataRoot = await createDataRoot("2026-04-23");
  const blocked = runPublish(["--date", "2026-04-23"], dataRoot);
  const allowed = runPublish(["--date", "2026-04-23", "--allow-date-override"], dataRoot);

  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Use --allow-date-override/);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).report_id, "management-morning-report-2026-04-23");
});
