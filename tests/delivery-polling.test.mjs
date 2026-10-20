import test from "node:test";
import assert from "node:assert/strict";
import { createBrowser, createFixture, fixtureDelivery, drain } from "./helpers/delivery-browser.mjs";

test("shared feed keeps phone, desktop and Telegram commands/replies on the browser", async () => {
  const h = await createBrowser();
  await h.context.refreshAll();
  assert.deepEqual(h.state.commands.map(c => c.clientId).sort(), ["desktop-uuid", "phone-uuid", "telegram:123"]);
  assert.deepEqual(h.state.messages.map(c => c.clientId).sort(), ["desktop-uuid", "phone-uuid", "telegram:123"]);
  assert.equal(h.deliveryRequests()[0].url.searchParams.get("scope"), "public");
  assert.equal(h.fixture.writes.length, 0);
});

test("synthetic KV read accounting uses the real delivery handler and storage readers", async () => {
  const f = createFixture();
  const response = await fixtureDelivery(f, "scope=public");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.commands.length, 3);
  assert.equal(data.messages.length, 3);
  assert.equal(data.reports.length, 2);
  assert.equal(f.reads.length, 18);
  assert.equal(f.writes.length, 0);
  const scoped = createFixture();
  await fixtureDelivery(scoped, "clientId=phone-uuid");
  assert.equal(scoped.reads.length, 14);
  const empty = createFixture();
  await fixtureDelivery(empty, "clientId=new-browser");
  assert.equal(empty.reads.length, 20);
});

test("hidden pages stop repeated delivery reads; visibility refresh resumes one timer", async () => {
  const h = await createBrowser();
  h.context.startPolling();
  h.visibility(true);
  await h.advance(120000);
  assert.equal(h.deliveryRequests().length, 0);
  assert.equal(h.intervalCount(), 0);
  h.visibility(false);
  await drain();
  assert.equal(h.deliveryRequests().length, 1);
  assert.equal(h.intervalCount(), 1);
});

test("repeated visibility changes and timer ticks share one in-flight delivery refresh", async () => {
  const h = await createBrowser();
  let release;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise(r => { release = r; }) : undefined);
  h.context.startPolling();
  h.visibility(true); h.visibility(false);
  await drain();
  h.visibility(true); h.visibility(false);
  await h.advance(4000);
  assert.equal(h.deliveryRequests().length, 1);
  release(Response.json({commands: [], messages: [], reports: []}));
  await drain();
  assert.equal(h.intervalCount(), 1);
});

test("hung delivery response is aborted within ten seconds and polling can recover", async () => {
  const h = await createBrowser();
  let signal;
  h.setFetch((url, init) => {
    if (url.pathname !== "/api/delivery") return undefined;
    signal = init.signal;
    return new Promise(() => {});
  });
  h.visibility(true); h.visibility(false);
  await drain();
  await h.advance(10001);
  assert.equal(signal?.aborted, true);
  assert.equal(h.state.deliveryRefreshPromise, null);
  assert.equal(h.intervalCount(), 1);
  assert.match(h.effects.status, /Данные временно недоступны/);
  h.setFetch(null);
  await h.advance(300000);
  assert.equal(h.state.commands.length, 3);
});

test("hung JSON body is also bounded by the request timeout", async () => {
  const h = await createBrowser();
  h.setFetch(url => url.pathname === "/api/delivery"
    ? Promise.resolve({ok: true, status: 200, json: () => new Promise(() => {})})
    : undefined);
  const pending = h.context.refreshAll();
  await drain();
  await h.advance(10001);
  await pending;
  assert.equal(h.state.deliveryRefreshPromise, null);
  assert.equal(h.intervalCount(), 1);
});

test("hide while version check is pending does not start a new delivery request", async () => {
  const h = await createBrowser();
  let resolveVersion;
  h.setFetch(url => url.pathname === "/version.json"
    ? new Promise(r => { resolveVersion = r; }) : undefined);
  h.context.startPolling();
  await h.advance(300000);
  h.visibility(true);
  resolveVersion(Response.json({build: ""}));
  await drain();
  assert.equal(h.deliveryRequests().length, 0);
  assert.equal(h.intervalCount(), 0);
});

test("speed, active, and idle polling stay within safe request cadence", async () => {
  const h = await createBrowser();
  h.setSpeed(true); h.context.startPolling();
  assert.equal(h.state.commandPollerInterval, 5000);
  h.setSpeed(false); h.state.commands = [{status: "processing"}]; h.context.startPolling();
  assert.equal(h.state.commandPollerInterval, 30000);
  h.state.commands = []; h.context.startPolling();
  assert.equal(h.state.commandPollerInterval, 300000);
});

test("ordinary refresh skips cached repos; explicit refresh during an in-flight snapshot is retained", async () => {
  const h = await createBrowser();
  await h.context.refreshAll();
  assert.equal(h.repoRequests().length, 0);
  let release;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise(r => {release = r;}) : undefined);
  const first = h.context.refreshAll();
  await drain();
  const manual = h.context.refreshAll({refreshRepos: true});
  await drain();
  assert.equal(h.deliveryRequests().length, 2);
  h.setFetch(null);
  release(Response.json({commands: [], messages: [], reports: []}));
  await Promise.all([first, manual]);
  await drain();
  assert.equal(h.repoRequests().length, 1);
  assert.equal(h.intervalCount(), 1);
});

test("delivery failures never render raw provider diagnostics", async () => {
  const h = await createBrowser();
  h.setFetch(url => url.pathname === "/api/delivery"
    ? Response.json({message: "SYNTHETIC INTERNAL ERROR"}, {status: 429}) : undefined);
  await h.context.refreshAll();
  assert.match(h.effects.status, /Данные временно недоступны/);
  assert.doesNotMatch(h.effects.status, /SYNTHETIC/);
  h.state.commands = [{status:"processing"}];
  await h.context.refreshAll();
  assert.match(h.effects.status, /последнюю доступную версию/);
});



test("hung repository refresh has bounded retries and restores a timer", async () => {
  const h = await createBrowser();
  h.state.menuRepos = [];
  const signals = [];
  h.setFetch((url, init) => {
    if (url.pathname !== "/api/repos") return undefined;
    signals.push(init.signal);
    return new Promise(() => {});
  });
  const pending = h.context.refreshAll({refreshRepos: true});
  await drain();
  await h.advance(20351);
  await pending;
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal?.aborted));
  assert.equal(h.state.deliveryRefreshPromise, null);
  assert.equal(h.intervalCount(), 1);
  assert.match(h.effects.status, /Не удалось обновить список репозиториев/);
});


test("post-action refresh awaits a new snapshot rather than reusing older in-flight data", async () => {
  const h = await createBrowser();
  let release;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise(r => { release = r; }) : undefined);
  const beforeAction = h.context.refreshAll();
  await drain();
  const afterAction = h.context.refreshAll({requireFresh: true});
  await drain();
  assert.equal(h.deliveryRequests().length, 1);
  h.setFetch(null);
  release(Response.json({commands: [], messages: [], reports: []}));
  await Promise.all([beforeAction, afterAction]);
  assert.equal(h.deliveryRequests().length, 2);
  assert.equal(h.state.commands.length, 3);
  assert.equal(h.intervalCount(), 1);
});

test("post-submit speed refresh also queues freshness behind an older snapshot", async () => {
  const h = await createBrowser();
  let release;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise(r => { release = r; }) : undefined);
  const beforeSubmit = h.context.refreshAll();
  await drain();
  const afterSubmit = h.context.refreshSpeedMode({requireFresh: true});
  await drain();
  h.setFetch(null);
  release(Response.json({commands: [], messages: [], reports: []}));
  await Promise.all([beforeSubmit, afterSubmit]);
  assert.equal(h.deliveryRequests().length, 2);
  assert.equal(h.state.commands.length, 3);
});


test("a full refresh requested during active-only refresh retains full-feed/report intent", async () => {
  const h = await createBrowser();
  let release;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise(r => { release = r; }) : undefined);
  const active = h.context.refreshSpeedMode();
  await drain();
  const full = h.context.refreshAll();
  await drain();
  assert.equal(h.deliveryRequests().length, 1);
  assert.equal(h.deliveryRequests()[0].url.searchParams.get("activeOnly"), "1");
  h.setFetch(null);
  release(Response.json({commands: [], messages: [], reports: []}));
  await Promise.all([active, full]);
  assert.equal(h.deliveryRequests().length, 2);
  assert.equal(h.deliveryRequests()[1].url.searchParams.has("activeOnly"), false);
  assert.equal(h.state.reports.length, 2);
});


test("successful trailing full refresh replaces an older failed active-only result", async () => {
  const h = await createBrowser();
  let rejectOld;
  h.setFetch(url => url.pathname === "/api/delivery" ? new Promise((_, reject) => { rejectOld = reject; }) : undefined);
  const oldActive = h.context.refreshSpeedMode();
  await drain();
  const full = h.context.refreshAll({requireFresh: true});
  await drain();
  h.setFetch(null);
  rejectOld(new Error("SYNTHETIC_OLD_PROVIDER_ERROR"));
  await Promise.all([oldActive, full]);
  assert.equal(h.deliveryRequests().length, 2);
  assert.equal(h.state.commands.length, 3);
  assert.equal(h.state.reports.length, 2);
  assert.doesNotMatch(h.effects.status, /SYNTHETIC/);
  assert.equal(h.intervalCount(), 1);
});

test("idle polling reads bounded recent records while preserving loaded full history", async () => {
  const h = await createBrowser();
  await h.context.refreshAll();
  // The fixture starts with three queued jobs, which correctly use active
  // 30-second polling. Put the browser in its true idle state for this test.
  h.state.commands = h.state.commands.map(command => ({ ...command, status: "answered" }));
  h.context.startPolling();
  await h.advance(300000);
  const requests = h.deliveryRequests();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.searchParams.get("mode"), "poll");
  assert.equal(requests[1].url.searchParams.get("activeOnly"), "1");
  assert.equal(h.state.reports.length, 2);
  assert.equal(h.state.messages.length, 3);
});

test("full history refresh remains available every 30 minutes and on demand", async () => {
  const h = await createBrowser();
  await h.context.refreshAll();
  h.context.startPolling();
  await h.advance(1800001);
  assert.equal(h.deliveryRequests().filter(r => !r.url.searchParams.has("mode")).length, 2);
  await h.context.refreshAll({requireFresh:true});
  assert.equal(h.deliveryRequests().filter(r => !r.url.searchParams.has("mode")).length, 3);
  assert.equal(h.state.reports.length, 2);
});

test("exhausted KV quota prevents background polling storms, manual retry still works", async () => {
  const h = await createBrowser();
  h.setFetch(url => url.pathname === "/api/delivery"
    ? Response.json({error:"rate_limited",rateLimited:true},{status:429,headers:{"retry-after":"300"}})
    : undefined);
  await h.context.refreshAll();
  const initialCount = h.deliveryRequests().length;
  assert.ok(h.state.nextDeliveryRetryAt > Date.now());
  await h.advance(300000);
  assert.equal(h.deliveryRequests().length, initialCount);
  assert.match(h.effects.status, /Данные временно недоступны/);
  h.setFetch(null);
  await h.context.refreshAll();
  assert.equal(h.state.nextDeliveryRetryAt, 0);
});

test("a stale processing card cannot force forever-fast delivery polling", async () => {
  const h = await createBrowser();
  h.state.commands = [{status:"processing",createdAt:new Date(Date.now()-3600000).toISOString()}];
  h.context.startPolling();
  assert.equal(h.state.commandPollerInterval, 300000);
});
