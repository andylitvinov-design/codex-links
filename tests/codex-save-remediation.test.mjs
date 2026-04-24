import test from "node:test";
import assert from "node:assert/strict";

import { buildRemediationPlan, createRemediationRun } from "../codex-save/functions/_lib/remediation.js";
import { saveDiagnosisRun } from "../codex-save/functions/_lib/runs.js";

function createMockEnv() {
  const store = new Map();

  return {
    SAVE_STORE: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key, value) {
        store.set(key, String(value));
      }
    }
  };
}

function createDiagnosisFixture() {
  return {
    runId: "diagnosis-1",
    target: {
      baseUrl: "https://codex-links.pages.dev",
      threadId: "links",
      threadLabel: "links",
      projectId: "links",
      targetRepo: "andylitvinov-design/codex-links",
      targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
      targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"]
    },
    overallStatus: "fail",
    checks: [
      {
        id: "status-api",
        label: "API status",
        status: "degraded",
        summary: "Slack actor validation is unverified.",
        canAutoFix: false,
        manualRequired: true,
        fixCategory: "external-auth"
      },
      {
        id: "text-cloud",
        label: "Text via cloud",
        status: "fail",
        summary: "Cloud path fell back to bridge.",
        canAutoFix: true,
        manualRequired: false,
        fixCategory: "delivery-routing",
        details: {
          actualExecutor: "bridge",
          expectedExecutor: "direct-openai"
        }
      },
      {
        id: "text-cloud-bridge",
        label: "Text via Cloud bridge",
        status: "pass",
        summary: "Claude bridge worked.",
        canAutoFix: false,
        manualRequired: false,
        fixCategory: ""
      },
      {
        id: "text-codex-bridge",
        label: "Text via Codex bridge",
        status: "fail",
        summary: "Fallback routed the reply through a different executor.",
        canAutoFix: true,
        manualRequired: false,
        fixCategory: "delivery-routing"
      },
      {
        id: "photo-cloud",
        label: "Photo via cloud",
        status: "blocked",
        summary: "Photo direct cloud did not stay on the direct executor.",
        canAutoFix: false,
        manualRequired: true,
        fixCategory: "platform-limitation"
      }
    ]
  };
}

test("remediation plan separates auto-fix and manual-only issues", () => {
  const plan = buildRemediationPlan(createDiagnosisFixture());

  assert.equal(plan.issueCount, 4);
  assert.equal(plan.autoFixCount, 2);
  assert.equal(plan.manualCount, 2);
  assert.equal(plan.actions[0].checkId, "text-cloud");
});

test("remediation run becomes manual_required when no auto-fixable issue exists", async () => {
  const env = createMockEnv();
  const diagnosis = createDiagnosisFixture();
  diagnosis.checks = diagnosis.checks.filter((check) => !check.canAutoFix);
  await saveDiagnosisRun(env, diagnosis);

  const run = await createRemediationRun(env, diagnosis.runId, async () => {
    throw new Error("fetch should not be called for manual-only remediation");
  });

  assert.equal(run.status, "manual_required");
  assert.equal(run.plan.autoFixCount, 0);
  assert.equal(Array.isArray(run.actions), true);
});

test("remediation run creates an agent command when auto-fixable issues exist", async () => {
  const env = createMockEnv();
  const diagnosis = createDiagnosisFixture();
  await saveDiagnosisRun(env, diagnosis);

  const run = await createRemediationRun(env, diagnosis.runId, async (url, init = {}) => {
    assert.match(String(url), /\/api\/commands$/);
    assert.equal(init.method, "POST");

    return new Response(JSON.stringify({
      command: {
        id: "fix-command-1",
        status: "queued",
        dispatchMode: "cloud"
      }
    }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  });

  assert.equal(run.status, "queued");
  assert.equal(run.actions[0].commandId, "fix-command-1");
  assert.equal(run.plan.autoFixCount, 2);
  assert.equal(run.actions[0].selectedDispatchMode, "claude-bridge");
  assert.equal(run.actions[0].selectedTargetExecutionMode, "claude");
  assert.equal(run.recheckScope, "selective");
  assert.deepEqual(run.recheckedCheckIds.sort(), ["text-cloud", "text-codex-bridge"]);
});
