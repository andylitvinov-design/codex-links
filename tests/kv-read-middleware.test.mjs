import test from "node:test";
import assert from "node:assert/strict";
import { createFixture, fixtureDelivery } from "./helpers/delivery-browser.mjs";
import { onRequest } from "../functions/api/_middleware.js";
import { onRequest as saveMiddleware } from "../codex-save/functions/api/_middleware.js";

const guardedDelivery = (f, query) => onRequest({
  request: new Request("https://read-budget.fixture.invalid/api/delivery?" + query),
  env: f.env,
  next() { throw new Error("Delivery should use the original handler with a request memo"); }
});

test("real Pages middleware reduces 18 shared-feed KV reads to 14 without losing data", async () => {
  const baseline = createFixture();
  const before = await (await fixtureDelivery(baseline, "scope=public")).json();
  assert.equal(baseline.reads.length, 18);
  const f = createFixture();
  const response = await guardedDelivery(f, "scope=public");
  assert.equal(response.status, 200);
  const after = await response.json();
  delete before.serverTime; delete after.serverTime;
  assert.deepEqual(after, before);
  assert.equal(f.reads.length, 14);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(after.commands.map(c => c.clientId).sort(), ["desktop-uuid", "phone-uuid", "telegram:123"]);
});

test("scoped, empty-index and active-only payloads retain their existing contracts", async () => {
  for (const [query, expectedReads] of [["clientId=phone-uuid", 12], ["clientId=new-browser", 16], ["scope=public&activeOnly=1", 11]]) {
    const baseline = createFixture();
    const before = await (await fixtureDelivery(baseline, query)).json();
    const f = createFixture();
    const after = await (await guardedDelivery(f, query)).json();
    delete before.serverTime; delete after.serverTime;
    assert.deepEqual(after, before);
    assert.equal(f.reads.length, expectedReads, query);
    assert.equal(f.writes.length, 0);
  }
});

test("real delivery quota response makes subsequent polls stop before KV access", async () => {
  let reads = 0, writes = 0;
  const context = {
    request: new Request("https://quota.fixture.invalid/api/delivery?scope=public"),
    env: { LINKS_STORE: {
      async get() { reads++; throw new Error("KV read limit exceeded"); },
      async put() { writes++; throw new Error("No writes during failed snapshot"); }
    } },
    next() { throw new Error("Unexpected route fallback"); }
  };
  assert.equal((await onRequest(context)).status, 429);
  const firstReads = reads;
  assert.ok(firstReads > 0);
  for (let i = 0; i < 100; i++) assert.equal((await onRequest(context)).status, 429);
  assert.equal(reads, firstReads);
  assert.equal(writes, 0);
});

test("delivery cooldown does not replace protected GET authorization", async () => {
  let deliveryCalls = 0;
  const env = { LINKS_STORE: {
    async get() {
      deliveryCalls++;
      throw new Error("Workers KV 429 daily read limit exceeded");
    }
  } };
  const limitedContext = {
    request: new Request("https://protected-cooldown.fixture.invalid/api/delivery?scope=public"),
    env,
    next() { throw new Error("Unexpected route fallback"); }
  };
  assert.equal((await onRequest(limitedContext)).status, 429);

  let authCalls = 0;
  const protectedContext = {
    request: new Request("https://protected-cooldown.fixture.invalid/api/commands?scope=recent"),
    env,
    next() {
      authCalls++;
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  };
  assert.equal((await onRequest(protectedContext)).status, 401);
  assert.ok(deliveryCalls > 0);
  assert.equal(authCalls, 1);
});

test("non-GET and unrelated routes retain normal routing and the original environment", async () => {
  for (const [method, path] of [["POST", "/api/commands"], ["OPTIONS", "/api/delivery"], ["GET", "/api/openclaw/verify"]]) {
    const env = { LINKS_STORE: {} };
    let calls = 0;
    const context = { request: new Request("https://quota.fixture.invalid" + path, { method }), env,
      next() { calls++; assert.equal(context.env, env); return new Response(null, { status: 204 }); }
    };
    assert.equal((await onRequest(context)).status, 204);
    assert.equal(calls, 1);
  }
});

test("Codex Save cooldown stops GET retries but never suppresses remediation callbacks", async () => {
  let calls = 0;
  const context = {
    request: new Request("https://save.fixture.invalid/api/health-summary"),
    env: { SAVE_STORE: {} },
    next() { calls++; throw new Error("Workers KV 429 daily read limit exceeded"); }
  };
  assert.equal((await saveMiddleware(context)).status, 429);
  assert.equal((await saveMiddleware(context)).status, 429);
  assert.equal(calls, 1);
  const response = await saveMiddleware({ ...context,
    request: new Request("https://save.fixture.invalid/api/remediation/run", { method: "POST" }),
    next: () => new Response(null, { status: 401 })
  });
  assert.equal(response.status, 401);
});
