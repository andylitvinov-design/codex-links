import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { onRequest } from "../../functions/api/delivery.js";

export const fixtureNow = new Date().toISOString();

export function createFixture() {
  const map = new Map();
  const reads = [];
  const writes = [];
  const clients = ["phone-uuid", "desktop-uuid", "telegram:123"];
  const commands = clients.map((clientId, i) => ({
    id: `cmd-${i}`, clientId, threadId: "project", threadLabel: "Project",
    text: `Task from ${clientId}`, createdAt: fixtureNow, status: "queued",
    dispatchMode: "local-bridge", progressStage: "queued"
  }));
  const messages = commands.map((c) => ({
    id: c.id + "-reply", clientId: c.clientId, commandId: c.id,
    threadId: c.threadId, threadLabel: "Project", text: "Fixture reply",
    role: "assistant", createdAt: fixtureNow
  }));
  map.set("commands:recent:v2", commands.map(c => c.id));
  map.set("commands:active:v2", commands.map(c => c.id));
  map.set("inbox:messages:recent:v2", messages.map(m => m.id));
  for (const c of commands) {
    map.set("command:item:v2:" + c.id, c);
    map.set("commands:client:v2:" + c.clientId, [c.id]);
  }
  for (const m of messages) {
    map.set("inbox:message:item:v2:" + m.id, m);
    map.set("inbox:messages:client:v2:" + m.clientId, [m.id]);
  }
  const reports = ["report-a", "report-b"].map(report_id => ({
    report_id, report_key: report_id, report_date: fixtureNow.slice(0, 10),
    generated_at: fixtureNow, status: "ok", metric_changes: []
  }));
  map.set("reports:recent:v1", reports.map(r => r.report_id));
  for (const report of reports) map.set("report:item:v1:" + report.report_id, report);
  map.set("app:config:v1", {});
  map.set("bridge:status:v1", { localBridge: {
    online: true, managedBy: "launchd", lastRunAt: fixtureNow, state: "idle"
  } });
  const env = { LINKS_STORE: {
    async get(key, type) {
      reads.push(key);
      const value = map.get(key);
      return value === undefined ? null : type === "json" ? structuredClone(value) : JSON.stringify(value);
    },
    async put(key, value) { writes.push(key); throw new Error("Unexpected synthetic KV write: " + key); },
    async delete(key) { writes.push(key); throw new Error("Unexpected synthetic KV delete: " + key); }
  } };
  return { env, map, reads, writes, commands, messages };
}

export async function fixtureDelivery(fixture, query) {
  return onRequest({request: new Request("https://fixture.invalid/api/delivery?" + query), env: fixture.env});
}

function functionSource(source, name) {
  const pattern = new RegExp("^(?:async )?function " + name + "\\(", "m");
  const match = pattern.exec(source);
  if (!match) return "";
  const rest = source.slice(match.index);
  const end = /\n(?:async )?function /.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

export async function drain() {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}

export async function createBrowser(sourceUrl = new URL("../../public/app.js", import.meta.url)) {
  const source = await readFile(sourceUrl, "utf8");
  const fixture = createFixture();
  const requests = [];
  const events = {};
  const timers = new Map();
  let now = Date.now();
  let id = 0;
  let speed = false;
  let overrideFetch = null;
  const state = {
    commands: [], messages: [], reports: [], menuRepos: [{id: "project"}],
    commandPoller: null, commandPollerInterval: 0, deliveryRefreshPromise: null, deliveryRefreshMode: "",
    deliveryPollInFlight: false, deliveryRefreshRequested: false, refreshReposRequested: false, hardReloading: false,
    latestAvailableVersion: ""
  };
  const document = {hidden: false, visibilityState: "visible", addEventListener(name, fn) {
    (events[name] ||= []).push(fn);
  }};
  const build = /const BUILD_VERSION = "([^"]+)"/.exec(source)[1];
  const schedule = (fn, ms, interval) => {
    const key = ++id;
    timers.set(key, {fn, ms, interval, due: now + ms});
    return key;
  };
  const window = {
    location: {origin: "https://fixture.invalid", href: "https://fixture.invalid/", replace() {}},
    setTimeout: (fn, ms) => schedule(fn, ms, false),
    clearTimeout: key => timers.delete(key),
    setInterval: (fn, ms) => schedule(fn, ms, true),
    clearInterval: key => timers.delete(key)
  };
  const effects = {status: "", rendered: 0};
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input), window.location.origin);
    requests.push({url, init});
    if (overrideFetch) {
      const result = overrideFetch(url, init);
      if (result !== undefined) return result;
    }
    if (url.pathname === "/api/delivery") return fixtureDelivery(fixture, url.searchParams.toString());
    if (url.pathname === "/api/repos") return Response.json([{id: "project"}]);
    if (url.pathname === "/version.json") return Response.json({build});
    throw new Error("No fixture for " + url.pathname);
  };
  const FakeDate = class extends Date { static now() { return now; } };
  const bindings = {
    state, document, window, URL, Promise, AbortController, Date: FakeDate, fetch,
    storage: {clientId: "phone-uuid"},
    BUILD_VERSION: build,
    SPEED_POLL_INTERVAL_MS: 1000,
    FAST_POLL_INTERVAL_MS: 3500,
    IDLE_POLL_INTERVAL_MS: Number(/IDLE_POLL_INTERVAL_MS = (\d+)/.exec(source)[1]),
    DELIVERY_REQUEST_TIMEOUT_MS: Number(/DELIVERY_REQUEST_TIMEOUT_MS = (\d+)/.exec(source)?.[1] || 10000),
    isDeliverySpeedModeActive: () => speed,
    applyDeliverySnapshot(snapshot) {
      state.commands = snapshot.commands || [];
      state.messages = snapshot.messages || [];
      state.reports = snapshot.reports || [];
    },
    renderDispatchModeUi() {},
    renderCommands() { effects.rendered++; },
    syncCommandStatusFromState() {},
    setCommandStatusMessage(message) { effects.status = message; }
  };
  const names = ["compareBuildVersions", "ensureLatestClient", "fetchJsonWithTimeout", "fetchJsonWithRetry",
    "fetchMenuRepos", "fetchDeliverySnapshot", "runDeliveryRefresh", "refreshAll", "refreshSpeedMode",
    "pollDelivery", "startPolling"];
  vm.createContext(bindings);
  vm.runInContext(names.map(name => functionSource(source, name)).filter(Boolean).join("\n"), bindings);
  // Register only the real visibility handler, without boot or action/dispatch handlers.
  const visibilityStart = source.indexOf('  document.addEventListener("visibilitychange", () => {');
  const visibilityEnd = source.indexOf("\n  });", visibilityStart) + "\n  });".length;
  vm.runInContext(source.slice(visibilityStart, visibilityEnd), bindings);
  const advance = async ms => {
    const target = now + ms;
    for (let safety = 0; safety < 1000; safety++) {
      const due = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a,b) => a[1].due-b[1].due)[0];
      if (!due) break;
      const [key, timer] = due;
      now = timer.due;
      if (timer.interval) timer.due += timer.ms;
      else timers.delete(key);
      const result = timer.fn();
      if (result && typeof result.catch === "function") result.catch(() => {});
      await drain();
    }
    now = target;
    await drain();
  };
  return {
    source, state, document, window, timers, requests, fixture, effects, context: bindings, advance,
    setSpeed(value) { speed = value; },
    setFetch(fn) { overrideFetch = fn; },
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      for (const fn of events.visibilitychange || []) fn();
    },
    intervalCount() { return [...timers.values()].filter(t => t.interval).length; },
    deliveryRequests() { return requests.filter(r => r.url.pathname === "/api/delivery"); },
    repoRequests() { return requests.filter(r => r.url.pathname === "/api/repos"); }
  };
}

