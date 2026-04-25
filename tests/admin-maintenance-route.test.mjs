import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminMaintenancePath = new URL("../functions/api/admin/commands-maintenance.js", import.meta.url);

test("admin maintenance route returns per-route queue recovery diagnostics", async () => {
  const source = await readFile(adminMaintenancePath, "utf8");

  assert.match(source, /function buildMaintenanceSummary\(commands, maintenance, dispatchedIds = \[\]\)/);
  assert.match(source, /cloudViaSlack: buildEmptyRouteSummary\(\)/);
  assert.match(source, /fallbackApplied/);
  assert.match(source, /unchanged/);
  assert.match(source, /remaining\.slice\(0, 20\)/);
});

test("admin maintenance route exposes Slack actor live diagnostic action", async () => {
  const source = await readFile(adminMaintenancePath, "utf8");

  assert.match(source, /runSlackActorDiagnostic/);
  assert.match(source, /action === "slack-diagnostic"/);
  assert.match(source, /lastProbeResult: diagnostic/);
  assert.match(source, /slackActorDiagnostic: diagnostic/);
});
