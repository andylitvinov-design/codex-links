import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  verifyFeedback
} from "../scripts/openclaw-feedback-loop.mjs";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/html"
    }
  });
}

test("parseArgs accepts the required feedback verifier options", () => {
  const args = parseArgs([
    "--project", "finance",
    "--expected-commit", "abc123",
    "--expected-version", "2026.05.15",
    "--live-url", "https://example.test",
    "--timeout-ms", "5000",
    "--json"
  ]);

  assert.equal(args.projectKey, "finance");
  assert.equal(args.expectedCommit, "abc123");
  assert.equal(args.expectedVersion, "2026.05.15");
  assert.equal(args.liveUrl, "https://example.test");
  assert.equal(args.timeoutMs, 5000);
  assert.equal(args.json, true);
});

test("finance verification passes when live status commit matches expected commit", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "abc123",
        commitRef: "main",
        googleSheetReadOk: true
      });
    }

    return jsonResponse({
      ok: true,
      warnings: ["rate cache stale"]
    });
  };

  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--expected-commit", "abc123",
    "--json"
  ]), { fetchImpl });

  assert.equal(result.result, "pass");
  assert.equal(result.versionVerification, "pass");
  assert.equal(result.versionMatches, true);
  assert.equal(result.observedCommit, "abc123");
  assert.equal(result.exactFailingCommand, null);
  assert.equal(result.checks.length, 2);
  assert.ok(calls.some((url) => url.endsWith("/api/status")));
  assert.ok(calls.some((url) => url.endsWith("/api/audit-snapshot")));
});

test("finance verification fails on expected commit mismatch", async () => {
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

  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--expected-commit", "expected123",
    "--json"
  ]), { fetchImpl });

  assert.equal(result.result, "fail");
  assert.equal(result.versionVerification, "fail");
  assert.equal(result.versionMatches, false);
  assert.equal(result.exactFailingCommand, "compare expected commit/version with live status");
});

test("finance without expected commit stays needs_verification after reachable checks", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "abc123",
        commitRef: "main",
        googleSheetReadOk: true
      });
    }

    return jsonResponse({ ok: true, warningCount: 0 });
  };

  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--json"
  ]), { fetchImpl });

  assert.equal(result.result, "needs_verification");
  assert.equal(result.liveReachable, true);
  assert.equal(result.versionVerification, "needs_verification");
  assert.match(result.needsVerification.join(" "), /No expected commit/);
});

test("audit snapshot output is summarized and does not expose full payload", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "abc123",
        commitRef: "main",
        googleSheetReadOk: true
      });
    }

    return jsonResponse({
      ok: true,
      warnings: ["first", "second"],
      rows: [
        { privateNote: "do not print this full audit row" }
      ]
    });
  };

  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--expected-commit", "abc123",
    "--json"
  ]), { fetchImpl });
  const audit = result.checks.find((check) => check.name === "audit-snapshot");

  assert.equal(audit.ok, true);
  assert.match(audit.summary, /warningCount=2/);
  assert.doesNotMatch(JSON.stringify(result), /privateNote/);
  assert.doesNotMatch(JSON.stringify(result), /do not print this full audit row/);
});

test("finance audit snapshot can be reachable even when JSON parsing is unavailable", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/api/status")) {
      return jsonResponse({
        status: "ok",
        commitSha: "abc123",
        commitRef: "main",
        googleSheetReadOk: true
      });
    }

    return textResponse("temporary audit snapshot text");
  };

  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--expected-commit", "abc123",
    "--json"
  ]), { fetchImpl });
  const audit = result.checks.find((check) => check.name === "audit-snapshot");

  assert.equal(result.result, "pass");
  assert.equal(audit.ok, true);
  assert.match(audit.summary, /jsonParsed=false/);
  assert.doesNotMatch(JSON.stringify(result), /temporary audit snapshot text/);
});

test("reiki route checks are reachable but version proof remains needs_verification", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/profile/admin")) {
      return textResponse("login required", 403);
    }

    return textResponse("<html><body>ok</body></html>");
  };

  const result = await verifyFeedback(parseArgs([
    "--project", "reiki-yggdrasil",
    "--json"
  ]), { fetchImpl });

  assert.equal(result.result, "needs_verification");
  assert.equal(result.liveReachable, true);
  assert.equal(result.observedCommit, null);
  assert.equal(result.observedVersion, null);
  assert.equal(result.versionVerification, "needs_verification");
  assert.equal(result.checks.length, 4);
  assert.equal(result.checks.find((check) => check.name === "route:/profile/admin").ok, true);
  assert.doesNotMatch(JSON.stringify(result), /<html>/);
});

test("reiki route checks treat HTTP responses as reachable even for 404 routes", async () => {
  const fetchImpl = async () => textResponse("not found", 404);

  const result = await verifyFeedback(parseArgs([
    "--project", "reiki-yggdrasil",
    "--json"
  ]), { fetchImpl });

  assert.equal(result.result, "needs_verification");
  assert.equal(result.liveReachable, true);
  assert.equal(result.checks.every((check) => check.ok), true);
  assert.equal(result.checks.every((check) => check.statusCode === 404), true);
});

test("missing fetch returns honest needs_verification", async () => {
  const result = await verifyFeedback(parseArgs([
    "--project", "finance",
    "--json"
  ]), { fetchImpl: null });

  assert.equal(result.result, "needs_verification");
  assert.match(result.needsVerification.join(" "), /Global fetch is unavailable/);
});
