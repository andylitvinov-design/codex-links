import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

function fixture(path, method = "GET") {
  const touched = [];
  const makeError = operation => () => {
    touched.push(operation);
    throw new Error("Unexpected KV access or route continuation: " + operation);
  };
  const context = {
    request: new Request("https://codex-links.pages.dev" + path, { method }),
    env: {
      LINKS_STORE: {
        get: makeError("get"), put: makeError("put"),
        delete: makeError("delete"), list: makeError("list")
      }
    },
    next: makeError("next")
  };
  return { context, touched };
}

test("maintenance intercepts every public page and static asset without KV", async () => {
  for (const path of ["/", "/?v=old-build", "/index.html", "/projects.html",
    "/advice.html", "/analysis.html", "/app.js?v=old", "/styles.css", "/favicon.ico",
    "/site.webmanifest", "/unknown"]) {
    const { context, touched } = fixture(path);
    const response = await onRequest(context);
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.match(await response.text(), /Сервис временно приостановлен/);
    assert.equal(response.headers.get("cache-control")?.includes("no-store"), true);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.deepEqual(touched, [], path);
  }
});

test("every API, webhook, legacy add and unsafe method fails closed before KV", async () => {
  for (const [method, path] of [
    ["GET", "/api/delivery?scope=public"], ["GET", "/api/status"],
    ["GET", "/api/commands?scope=recent"], ["GET", "/api/reports"],
    ["GET", "/api/messages"], ["POST", "/api/commands"],
    ["POST", "/api/slack"], ["POST", "/api/commands?mode=answer"],
    ["POST", "/api/admin/commands-maintenance"],
    ["POST", "/api/openclaw/verify"],
    ["GET", "/add?url=https://example.org"], ["POST", "/add"],
    ["OPTIONS", "/api/delivery"], ["DELETE", "/api/links"],
    ["POST", "/"], ["PUT", "/projects.html"]
  ]) {
    const { context, touched } = fixture(path, method);
    const response = await onRequest(context);
    assert.equal(response.status, 503, method + " " + path);
    assert.equal(response.headers.get("retry-after"), "3600");
    assert.equal(response.headers.get("cache-control")?.includes("no-store"), true);
    const payload = await response.json();
    assert.deepEqual(payload, {
      error: "service_paused",
      message: "Codex Links is temporarily paused by its owner.",
      temporary: true
    });
    assert.deepEqual(touched, [], method + " " + path);
  }
});

test("HEAD responds without body or touching KV", async () => {
  const { context, touched } = fixture("/", "HEAD");
  const response = await onRequest(context);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
  assert.deepEqual(touched, []);
});

test("only safe static version marker continues without KV", async () => {
  let count = 0;
  for (const method of ["GET", "HEAD"]) {
    const { context, touched } = fixture("/version.json?release_check=1", method);
    context.next = () => {
      count++;
      return new Response(method === "HEAD" ? null : '{"build":"20261020-0840"}', {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const response = await onRequest(context);
    assert.equal(response.status, 200);
    if (method === "GET") assert.equal((await response.json()).build, "20261020-0840");
    assert.deepEqual(touched, []);
  }
  assert.equal(count, 2);
});

test("query and headers cannot secretly resume a paused service", () => {
  for (const path of ["/?resume=1", "/api/delivery?standby=false", "/api/commands?bypass=true"]) {
    const { context, touched } = fixture(path);
    context.request.headers.set("X-Admin-Token", "synthetic-token");
    const response = onRequest(context);
    assert.equal(response.status, 503);
    assert.deepEqual(touched, []);
  }
});
