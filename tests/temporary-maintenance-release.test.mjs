import test from "node:test";
import assert from "node:assert/strict";
import { isMaintenanceBuild, readRelease, verifyPausedProduction } from "../scripts/verify-production-release.mjs";

function fakeProduction(local, calls, mutate = {}) {
  return async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);

    if (path === "/version.json") {
      return new Response(mutate.versionBody ?? local.files["version.json"], {
        status: mutate.versionStatus ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (path === "/" || path === "/app.js") {
      return new Response(mutate.pageBody ?? "<h1>Сервис временно приостановлен</h1>", {
        status: mutate[path + "Status"] ?? 503,
        headers: {
          "content-type": mutate.contentType ?? "text/html; charset=utf-8",
          "cache-control": mutate.cacheControl ?? "no-store, max-age=0"
        }
      });
    }
    throw new Error("Unexpected URL in paused release verification: " + path);
  };
}

test("local maintenance mode is unambiguously enabled by root middleware", async () => {
  assert.equal(await isMaintenanceBuild(), true);
});

test("maintenance deployment requires static version + 503 page and JS asset", async () => {
  const local = await readRelease();
  const calls = [];
  assert.equal(
    await verifyPausedProduction(local, { fetchImpl: fakeProduction(local, calls), nonce: 47 }),
    local.build
  );
  assert.deepEqual(calls.map(call => call.path), ["/version.json", "/", "/app.js"]);
});

test("paused release rejects stale marker and unpaused pages", async () => {
  const local = await readRelease();
  for (const mutation of [
    { versionBody: '{"build":"old-version"}' },
    { "/Status": 200 }, { "/Status": 429 },
    { "/app.jsStatus": 200 },
    { pageBody: "<h1>Different page</h1>" },
    { contentType: "text/plain" },
    { cacheControl: "public, max-age=86400" }
  ]) {
    await assert.rejects(
      verifyPausedProduction(local, { fetchImpl: fakeProduction(local, [], mutation), nonce: 48 }),
      /Paused release/
    );
  }
});

test("paused release fails closed on offline or provider HTTP errors", async () => {
  const local = await readRelease();
  await assert.rejects(
    verifyPausedProduction(local, { fetchImpl: async () => { throw new Error("synthetic network outage"); } }),
    /synthetic network outage/
  );
  await assert.rejects(
    verifyPausedProduction(local, { fetchImpl: fakeProduction(local, [], { versionStatus: 503 }) }),
    /Paused release: static version HTTP 503/
  );
});
