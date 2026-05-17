import test from "node:test";
import assert from "node:assert/strict";
import { parseVerifyRequest, verifyOpenClawLive } from "../functions/_lib/openclaw-verify.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" }
  });
}

test("parseVerifyRequest accepts finance expected commit", () => {
  const parsed = parseVerifyRequest({ project: "finance", expectedCommit: "2b4d665" });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.project.projectKey, "finance");
  assert.equal(parsed.expectedCommit, "2b4d665");
});

test("parseVerifyRequest rejects missing expected commit", () => {
  const parsed = parseVerifyRequest({ project: "finance" });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
  assert.match(parsed.error, /expectedCommit is required/);
});

test("verifyOpenClawLive passes when live status commit matches expected commit", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "2b4d665366325451def14cf888ab13de2fd7903f",
        commitRef: "main",
        gitRepoSlug: "andylitvinov-design/finance",
        googleSheetReadOk: true
      });
    }
    return jsonResponse({ ok: true, warnings: ["sample warning"] });
  };

  const result = await verifyOpenClawLive({ project: "finance", expectedCommit: "2b4d665" }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.result, "pass");
  assert.equal(result.versionVerification, "pass");
  assert.equal(result.versionMatches, true);
  assert.equal(result.observedCommit, "2b4d665366325451def14cf888ab13de2fd7903f");
  assert.equal(result.exactFailingCommand, null);
  assert.equal(result.checks.length, 2);
  assert.equal(result.audit.warningCount, 1);
  assert.ok(calls.some((url) => url.endsWith("/api/status")));
  assert.ok(calls.some((url) => url.endsWith("/api/audit-snapshot")));
});

test("verifyOpenClawLive fails on live commit mismatch", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "live456",
        commitRef: "main",
        googleSheetReadOk: true
      });
    }
    return jsonResponse({ ok: true, warnings: [] });
  };

  const result = await verifyOpenClawLive({ project: "finance", expectedCommit: "expected123" }, { fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.result, "fail");
  assert.equal(result.versionVerification, "fail");
  assert.equal(result.versionMatches, false);
  assert.equal(result.exactFailingCommand, "compare expected commit with live /api/status commitSha");
});

test("verifyOpenClawLive includes bounded non-json response metadata", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/status")) {
      return textResponse("platform auth page", 403);
    }
    return jsonResponse({ ok: true, warnings: [] });
  };

  const result = await verifyOpenClawLive({ project: "finance", expectedCommit: "2b4d665" }, { fetchImpl });
  const status = result.checks.find((check) => check.name === "api-status");

  assert.equal(result.ok, false);
  assert.equal(result.result, "fail");
  assert.equal(status.status, 403);
  assert.equal(status.jsonParsed, false);
  assert.match(status.bodyFirst300, /platform auth page/);
  assert.match(result.exactFailingCommand, /api\/status/);
});
