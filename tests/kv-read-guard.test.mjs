import test from "node:test";
import assert from "node:assert/strict";
import { withRequestKvMemo, createKvReadGuard } from "../functions/_lib/kv-read-guard.js";

function storeFixture() {
  const map = new Map([["key", { count: 1 }]]);
  let reads = 0;
  const store = {
    async get(key, type) {
      assert.equal(this, store);
      reads++;
      const value = map.get(key) ?? null;
      return type === "json" ? structuredClone(value) : JSON.stringify(value);
    },
    async put(key, value) { assert.equal(this, store); map.set(key, JSON.parse(value)); },
    async delete(key) { assert.equal(this, store); map.delete(key); },
    async list() { assert.equal(this, store); return [...map.keys()]; }
  };
  return { env: { LINKS_STORE: store }, reads: () => reads };
}
const requestContext = (path = "/api/delivery?scope=public", method = "GET") => ({
  request: new Request("https://fixture.invalid" + path, { method }),
  env: { LINKS_STORE: {} }
});
const limited = () => Response.json({ error: "rate_limited", rateLimited: true }, { status: 429 });

function edgeFixture() {
  const entries = new Map();
  return {
    entries,
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, value) { entries.set(key.url, value.clone()); }
  };
}

test("concurrent and sequential JSON gets coalesce, with independent returned objects", async () => {
  const f = storeFixture();
  const env = withRequestKvMemo(f.env);
  const [a, b] = await Promise.all([env.LINKS_STORE.get("key", "json"), env.LINKS_STORE.get("key", "json")]);
  assert.equal(f.reads(), 1);
  a.count = 9;
  assert.equal(b.count, 1);
  assert.equal((await env.LINKS_STORE.get("key", "json")).count, 1);
  assert.equal(f.reads(), 1);
  assert.notEqual(env, f.env);
  assert.notEqual(env.LINKS_STORE, f.env.LINKS_STORE);
});

test("request and namespace boundaries never share successful data", async () => {
  const f = storeFixture();
  await withRequestKvMemo(f.env).LINKS_STORE.get("key", "json");
  await withRequestKvMemo(f.env).LINKS_STORE.get("key", "json");
  assert.equal(f.reads(), 2);
  const g = storeFixture();
  await withRequestKvMemo(g.env).LINKS_STORE.get("key", "json");
  assert.equal(g.reads(), 1);
});

test("put/delete invalidate memo and preserve native receiver and values", async () => {
  const f = storeFixture();
  const { LINKS_STORE: store } = withRequestKvMemo(f.env);
  await store.get("key", "json");
  await store.put("key", '{"count":2}');
  assert.equal((await store.get("key", "json")).count, 2);
  await store.delete("key");
  assert.equal(await store.get("key", "json"), null);
  assert.equal(f.reads(), 3);
  assert.deepEqual(await store.list(), []);
});

test("read errors are not empty data and can recover within a request", async () => {
  let calls = 0;
  const env = withRequestKvMemo({ LINKS_STORE: { async get() {
    if (++calls === 1) throw new Error("fixture failed read");
    return { count: 2 };
  } } });
  await assert.rejects(env.LINKS_STORE.get("key", "json"), /fixture failed/);
  assert.deepEqual(await env.LINKS_STORE.get("key", "json"), { count: 2 });
  assert.equal(calls, 2);
});

test("unsupported read options are passed through without memoization", async () => {
  const f = storeFixture();
  const store = withRequestKvMemo(f.env).LINKS_STORE;
  await store.get("key", { type: "json", cacheTtl: 30 });
  await store.get("key", { type: "json", cacheTtl: 30 });
  assert.equal(f.reads(), 2);
  assert.equal(withRequestKvMemo({}).LINKS_STORE, undefined);
});

test("GET quota failure opens a five-minute gate; repeated polls cannot reach KV", async () => {
  let time = 1000, calls = 0;
  const guard = createKvReadGuard({ now: () => time, cache: () => undefined, run: async () => {
    calls++; return limited();
  } });
  assert.equal((await guard(requestContext())).headers.get("retry-after"), "300");
  for (let i = 0; i < 100; i++) assert.equal((await guard(requestContext())).status, 429);
  assert.equal(calls, 1);
  time += 299_000;
  assert.equal((await guard(requestContext())).headers.get("retry-after"), "1");
  assert.equal(calls, 1);
  time += 1001;
  await guard(requestContext());
  assert.equal(calls, 2);
});

test("quota cooldown preserves POST callbacks and OPTIONS, isolates origins", async () => {
  let calls = 0;
  const guard = createKvReadGuard({ cache: () => undefined, run: async context => {
    calls++; return context.request.method === "GET" ? limited() : new Response(null, { status: 204 });
  } });
  await guard(requestContext());
  assert.equal((await guard(requestContext("/api/slack", "POST"))).status, 204);
  assert.equal((await guard(requestContext("/api/delivery", "OPTIONS"))).status, 204);
  const other = requestContext();
  other.request = new Request("https://preview.invalid/api/delivery");
  await guard(other);
  assert.equal(calls, 4);
});

test("edge cache shares only cooldown timestamp with a fresh isolate, ignoring cache-busters", async () => {
  let time = 1000, calls = 0;
  const edge = edgeFixture();
  const settings = { now: () => time, cache: () => edge, run: async () => { calls++; return limited(); } };
  const first = createKvReadGuard(settings);
  await first(requestContext());
  const second = createKvReadGuard(settings);
  const response = await second(requestContext("/api/status?_=different"));
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  assert.equal(edge.entries.size, 1);
  const marker = await [...edge.entries.values()][0].clone().json();
  assert.deepEqual(Object.keys(marker).sort(), ["until", "version"]);
  time += 300_001;
  await second(requestContext());
  assert.equal(calls, 2);
});

test("healthy responses are never stored, shared, delayed or rewritten", async () => {
  const edge = edgeFixture();
  let calls = 0;
  const guard = createKvReadGuard({ cache: () => edge, run: async () => Response.json({ n: ++calls }) });
  assert.equal((await (await guard(requestContext())).json()).n, 1);
  assert.equal((await (await guard(requestContext())).json()).n, 2);
  assert.equal(edge.entries.size, 0);
});

test("unrelated 429, auth failures and generic exceptions do not trip the KV gate", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const guard = createKvReadGuard({ cache: () => undefined, run: async () => {
      calls++; return Response.json({ error: "other_service" }, { status });
    } });
    await guard(requestContext()); await guard(requestContext());
    assert.equal(calls, 2);
  }
  const guard = createKvReadGuard({ run: async () => { throw new Error("other failure"); } });
  await assert.rejects(guard(requestContext()), /other failure/);
});

test("raw Cloudflare KV 429 variants trip without exposing provider text", async () => {
  for (const message of ["KV get failed: 429 Too Many Requests", "Workers KV 429 daily limit exceeded"]) {
    let calls = 0;
    const guard = createKvReadGuard({ cache: () => undefined, run: async () => { calls++; throw new Error(message); } });
    const response = await guard(requestContext());
    assert.equal(response.status, 429);
    assert.doesNotMatch(await response.text(), /Too Many|daily limit/);
    await guard(requestContext());
    assert.equal(calls, 1);
  }
});

test("optional edge cache failures and malformed markers cannot break healthy reads", async () => {
  for (const edge of [
    { async match() { throw new Error("cache unavailable"); } },
    { async match() { return Response.json({ version: 1, until: Number.MAX_SAFE_INTEGER }); } }
  ]) {
    const guard = createKvReadGuard({ now: () => 0, cache: () => edge, run: async () => Response.json({ ok: true }) });
    assert.equal((await guard(requestContext())).status, 200);
  }
});
