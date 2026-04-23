import test from "node:test";
import assert from "node:assert/strict";

import { readReports, upsertReports } from "../functions/_lib/reports.js";

function createMockEnv() {
  const store = new Map();

  return {
    LINKS_STORE: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key, value) {
        store.set(key, String(value));
      },
      async delete(key) {
        store.delete(key);
      }
    }
  };
}

test("upsertReports dedupes same report id and keeps latest", async () => {
  const env = createMockEnv();
  const created = new Date("2026-04-20T10:00:00.000Z").toISOString();
  const replaced = new Date("2026-04-21T10:00:00.000Z").toISOString();

  const first = await upsertReports(env, [{
    report_id: "daily-report-2026-04-21",
    report_key: "daily-dashboard-report",
    report_date: "2026-04-21",
    status: "ok",
    generated_at: created,
    metric_changes: []
  }]);

  const second = await upsertReports(env, [{
    report_id: "daily-report-2026-04-21",
    report_key: "daily-dashboard-report",
    report_date: "2026-04-21",
    status: "stable",
    generated_at: replaced,
    metric_changes: []
  }]);

  const reports = await readReports(env);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, "stable");
  assert.equal(reports[0].generated_at, replaced);
});

test("upsertReports accepts baseline status when previous snapshot missing", async () => {
  const env = createMockEnv();
  const report = await upsertReports(env, [{
    report_id: "daily-report-2026-04-22",
    report_key: "daily-dashboard-report",
    report_date: "2026-04-22",
    status: "baseline",
    generated_at: "2026-04-22T00:00:00.000Z",
    metric_changes: []
  }]);

  const read = await readReports(env);
  assert.equal(report.length, 1);
  assert.equal(read.length, 1);
  assert.equal(read[0].status, "baseline");
});

test("upsertReports preserves report title and summary", async () => {
  const env = createMockEnv();
  await upsertReports(env, [{
    report_id: "management-morning-report-2026-04-23",
    report_key: "management-morning-report",
    report_date: "2026-04-23",
    status: "ok",
    generated_at: "2026-04-23T11:46:54.152Z",
    title: "Management Morning Report (2026-04-23)",
    summary: "Agent 1: focus; Agent 2: action; Daily Changes: item.",
    metric_changes: []
  }]);

  const reports = await readReports(env);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].title, "Management Morning Report (2026-04-23)");
  assert.equal(reports[0].summary, "Agent 1: focus; Agent 2: action; Daily Changes: item.");
});
