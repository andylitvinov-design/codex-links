import test from "node:test";
import assert from "node:assert/strict";

import { createDiagnosisRun, advanceDiagnosisRun } from "../codex-save/functions/_lib/diagnostics.js";

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

function createResponse(body, init = {}) {
  return new Response(body ? JSON.stringify(body) : "", {
    status: init.status || 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("diagnosis run marks status API as degraded when Slack actor is unverified", async () => {
  const env = createMockEnv();
  let posted = 0;
  const postedPayloads = [];

  const fetchMock = async (url, init = {}) => {
    if (String(url).includes("/api/status")) {
      return createResponse({
        status: {
          dispatchMode: "slack-codex-cloud",
          executorLabel: "Codex Cloud via Slack",
          slackActor: {
            validationStatus: "unverified"
          },
          localBridge: {
            online: true
          },
          claudeBridge: {
            online: true
          }
        }
      });
    }

    if (String(url).includes("/api/commands") && init.method === "POST") {
      posted += 1;
      postedPayloads.push(JSON.parse(String(init.body || "{}")));
      return createResponse({
        command: {
          id: `cmd-${posted}`,
          status: "queued",
          dispatchMode: "local-bridge"
        }
      });
    }

    return new Response("<html></html>", {
      status: 200,
      headers: {
        "content-type": "text/html"
      }
    });
  };

  const run = await createDiagnosisRun(env);
  const next = await advanceDiagnosisRun(env, run, fetchMock);

  assert.equal(next.status, "running");
  assert.equal(posted, 6);

  const siteCheck = next.checks.find((check) => check.id === "site-availability");
  const statusCheck = next.checks.find((check) => check.id === "status-api");
  const firstDeliveryCheck = next.checks.find((check) => check.id === "text-codex-bridge");
  const recommendation = next.recommendations.find((item) => item.checkId === "status-api");

  assert.equal(siteCheck.status, "pass");
  assert.equal(statusCheck.status, "degraded");
  assert.equal(statusCheck.canAutoFix, false);
  assert.equal(statusCheck.fixCategory, "external-auth");
  assert.equal(firstDeliveryCheck.state, "running");
  assert.equal(next.runningCount, 6);
  assert.equal(next.completedCount, 2);
  assert.equal(next.pendingCount, 0);
  assert.equal(postedPayloads.find((payload) => payload.clientId.includes("text-cloud"))?.dispatchMode, "claude-bridge");
  assert.equal(postedPayloads.find((payload) => payload.clientId.includes("text-cloud"))?.targetExecutionMode, "claude");
  assert.equal(postedPayloads.find((payload) => payload.clientId.includes("photo-cloud"))?.dispatchMode, "claude-bridge");
  assert.equal(postedPayloads.find((payload) => payload.clientId.includes("text-direct-openai"))?.dispatchMode, "cloud");
  assert.equal(postedPayloads.find((payload) => payload.clientId.includes("text-direct-openai"))?.targetExecutionMode, "direct-openai");
  assert.ok(recommendation);
  assert.match(recommendation.recommendation, /SLACK_CODEX_USER_ID|Slack actor/i);
});
