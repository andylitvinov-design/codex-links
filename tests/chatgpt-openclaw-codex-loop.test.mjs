import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  MANDATORY_FORBIDDEN_ACTIONS,
  buildProposal,
  formatKeyValue,
  parseArgs
} from "../scripts/chatgpt-openclaw-codex-loop.mjs";

test("example proposal uses finance defaults and mandatory approval guardrails", () => {
  const args = parseArgs(["--example", "--json"]);
  const proposal = buildProposal(args, new Date("2026-05-15T12:00:00.000Z"));

  assert.equal(proposal.threadKey, "chatgpt-openclaw-codex-loop");
  assert.equal(proposal.projectKey, "finance");
  assert.equal(proposal.repo, "andylitvinov-design/finance");
  assert.equal(proposal.requiresApproval, true);
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.dryRun, true);
  assert.equal(proposal.createdAt, "2026-05-15T12:00:00.000Z");
  assert.equal(proposal.updatedAt, "2026-05-15T12:00:00.000Z");
  assert.deepEqual(proposal.needsVerification, []);

  for (const action of MANDATORY_FORBIDDEN_ACTIONS) {
    assert.ok(proposal.forbiddenActions.includes(action), `missing ${action}`);
  }
});

test("custom finance proposal accepts CLI values and prints one JSON object", () => {
  const result = spawnSync(process.execPath, [
    "scripts/chatgpt-openclaw-codex-loop.mjs",
    "--project",
    "finance",
    "--repo",
    "andylitvinov-design/finance",
    "--goal",
    "Verify production updated to expected commit",
    "--prompt",
    "Check /api/status and compare expected commit",
    "--json"
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.projectKey, "finance");
  assert.equal(parsed.repo, "andylitvinov-design/finance");
  assert.equal(parsed.goal, "Verify production updated to expected commit");
  assert.equal(parsed.prompt, "Check /api/status and compare expected commit");
  assert.equal(parsed.requiresApproval, true);
  assert.equal(parsed.dryRun, true);
});

test("missing repo and prompt are allowed but marked needs verification", () => {
  const args = parseArgs([
    "--project",
    "unknown-project",
    "--goal",
    "Check something"
  ]);
  const proposal = buildProposal(args, new Date("2026-05-15T12:00:00.000Z"));

  assert.equal(proposal.repo, null);
  assert.equal(proposal.prompt, "");
  assert.deepEqual(proposal.needsVerification, [
    "unknown projectKey: unknown-project",
    "repo missing",
    "prompt missing"
  ]);
});

test("invalid status is rejected", () => {
  assert.throws(
    () => parseArgs(["--project", "finance", "--goal", "Check", "--status", "queued"]),
    /--status must be one of/
  );
});

test("non-json output is compact key value lines", () => {
  const proposal = buildProposal(parseArgs([
    "--project",
    "reiki-yggdrasil",
    "--repo",
    "andylitvinov-design/reiki-yggdrasil",
    "--goal",
    "Verify public routes are reachable after deploy"
  ]), new Date("2026-05-15T12:00:00.000Z"));

  const output = formatKeyValue(proposal);

  assert.match(output, /^threadKey=chatgpt-openclaw-codex-loop\n/);
  assert.match(output, /\nprojectKey=reiki-yggdrasil\n/);
  assert.match(output, /\nrepo=andylitvinov-design\/reiki-yggdrasil\n/);
  assert.match(output, /\nstatus=proposed\n/);
  assert.match(output, /\nrequiresApproval=true\n/);
  assert.match(output, /\ndryRun=true\n/);
  assert.match(output, /\nnextAction=Review proposal, then approve before dispatch\.$/);
});
