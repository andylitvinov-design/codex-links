import test from "node:test";
import assert from "node:assert/strict";

import { buildRemediationPlan, createRemediationRun } from "../codex-save/functions/_lib/remediation.js";
import { saveDiagnosisRun, saveRemediationRun } from "../codex-save/functions/_lib/runs.js";

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
    status: "completed",
    target: {
      baseUrl: "https://codex-links.pages.dev",
      threadId: "links",
      threadLabel: "links",
      projectId: "links",
      targetRepo: "andylitvinov-design/codex-links",
      targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
      targetWorkspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links",
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
        label: "Text via Claude Code",
        status: "fail",
        summary: "Claude Code path fell back to bridge.",
        canAutoFix: true,
        manualRequired: false,
        fixCategory: "delivery-routing",
        details: {
          actualExecutor: "bridge",
          expectedExecutor: "claude"
        }
      },
      {
        id: "text-direct-openai",
        label: "Text via Direct OpenAI",
        status: "pass",
        summary: "Direct OpenAI worked.",
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
        label: "Photo via Claude Code",
        status: "pass",
        summary: "Claude Code photo worked.",
        canAutoFix: false,
        manualRequired: false,
        fixCategory: ""
      },
      {
        id: "photo-direct-openai",
        label: "Photo via Direct OpenAI",
        status: "blocked",
        summary: "Photo Direct OpenAI did not stay on the direct executor.",
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
  let commandPayload = null;

  const run = await createRemediationRun(env, diagnosis.runId, async (url, init = {}) => {
    assert.match(String(url), /\/api\/commands$/);
    assert.equal(init.method, "POST");
    commandPayload = JSON.parse(String(init.body || "{}"));

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
  assert.equal(commandPayload.targetWorkspacePath, "/Users/andriilitvinov/projects/MYPROJECTS/links");
  assert.deepEqual(commandPayload.targetContextFiles, ["AGENTS.md", "README.md", "STATE.md"]);
  assert.match(commandPayload.text, /branch, push it, open a PR, merge it, and deploy Cloudflare Pages/i);
  assert.match(commandPayload.text, /Start by reading AGENTS\.md, README\.md, and STATE\.md/i);
});

test("remediation run rejects a running diagnosis before creating an agent command", async () => {
  const env = createMockEnv();
  const diagnosis = createDiagnosisFixture();
  diagnosis.status = "running";
  diagnosis.checks = [{
    id: "text-cloud",
    label: "Text via Claude Code",
    kind: "delivery",
    route: "claude-bridge",
    channel: "Claude Code",
    group: "text",
    mode: "text",
    expectedExecutor: "claude",
    state: "running",
    status: "unknown",
    summary: "Still running.",
    startedAt: new Date().toISOString(),
    details: {
      commandId: "cmd-running"
    }
  }];
  await saveDiagnosisRun(env, diagnosis);

  await assert.rejects(
    () => createRemediationRun(env, diagnosis.runId, async (url) => {
      assert.match(String(url), /\/api\/commands\?id=cmd-running/);
      return new Response(JSON.stringify({
        command: {
          id: "cmd-running",
          status: "processing",
          progressStage: "waiting-for-codex",
          actualExecutor: "claude"
        }
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }),
    /Diagnosis is still running/
  );
});

test("remediation run reuses an active run for the same diagnosis", async () => {
  const env = createMockEnv();
  const diagnosis = createDiagnosisFixture();
  await saveDiagnosisRun(env, diagnosis);
  await saveRemediationRun(env, {
    runId: "remediation-active",
    kind: "remediation",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: "",
    sourceDiagnosisId: diagnosis.runId,
    target: diagnosis.target,
    plan: {
      issueCount: 1,
      autoFixCount: 1,
      manualCount: 0,
      issues: [],
      actions: [],
      manualActions: []
    },
    actions: [{
      kind: "agent-command",
      commandId: "active-command",
      status: "processing"
    }],
    status: "in_progress",
    recheckId: "",
    recheckScope: "selective",
    recheckedCheckIds: ["text-cloud"],
    report: null
  });

  const run = await createRemediationRun(env, diagnosis.runId, async () => {
    throw new Error("fetch should not create a duplicate command");
  });

  assert.equal(run.runId, "remediation-active");
  assert.equal(run.actions[0].commandId, "active-command");
});
