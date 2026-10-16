import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as codexLinks } from "../functions/api/_middleware.js";
import { onRequest as codexSave } from "../codex-save/functions/api/_middleware.js";
import { onRequestGet as legacyAddLink } from "../functions/add.js";

function fixture(handler, path, method, env = {}, headers = {}) {
  let nextCalls = 0;
  let kvReads = 0;
  let kvWrites = 0;
  const context = {
    request: new Request(`https://example.pages.dev${path}`, { method, headers }),
    env: {
      ...env,
      LINKS_STORE: {
        get() { kvReads++; throw Error("KV should not be read while paused"); },
        put() { kvWrites++; throw Error("KV should not be written while paused"); }
      },
      SAVE_STORE: {
        get() { kvReads++; throw Error("KV should not be read while paused"); },
        put() { kvWrites++; throw Error("KV should not be written while paused"); }
      }
    },
    next() {
      nextCalls++;
      return Response.json({ ok: true });
    }
  };
  return {
    run: () => handler(context),
    effects: () => ({ nextCalls, kvReads, kvWrites })
  };
}

test("codex-links standby denies anonymous public delivery before any KV access", async () => {
  const f = fixture(codexLinks, "/api/delivery?scope=public", "GET");
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_standby");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Retry-After"), "3600");
  assert.deepEqual(f.effects(), { nextCalls: 0, kvReads: 0, kvWrites: 0 });
});

test("codex-links standby also prevents all POST command creation and OPTIONS", async () => {
  for (const method of ["POST", "OPTIONS"]) {
    const f = fixture(codexLinks, "/api/commands", method);
    const response = await f.run();
    assert.equal(response.status, 503);
    assert.equal(f.effects().nextCalls, 0);
    assert.equal(f.effects().kvWrites, 0);
  }
});

test("legacy /add shortcut is also paused before token checks or KV writes", async () => {
  const f = fixture(legacyAddLink, "/add?url=https%3A%2F%2Fexample.org", "GET");
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_standby");
  assert.deepEqual(f.effects(), { nextCalls: 0, kvReads: 0, kvWrites: 0 });
});

test("codex-save standby denies diagnostics and remediation before storage access", async () => {
  for (const [method, path] of [
    ["GET", "/api/diagnostics/run"],
    ["POST", "/api/remediation/run"]
  ]) {
    const f = fixture(codexSave, path, method);
    const response = await f.run();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "service_standby");
    assert.deepEqual(f.effects(), { nextCalls: 0, kvReads: 0, kvWrites: 0 });
  }
});

test("explicit resume delegates to original handlers without touching KV in middleware", async () => {
  for (const [handler, envName] of [
    [codexLinks, "CODEX_LINKS_STANDBY"],
    [codexSave, "CODEX_SAVE_STANDBY"]
  ]) {
    for (const setting of ["off", "false", "0"]) {
      const f = fixture(handler, "/api/status", "GET", { [envName]: setting });
      const response = await f.run();
      assert.equal(response.status, 200);
      assert.deepEqual(f.effects(), { nextCalls: 1, kvReads: 0, kvWrites: 0 });
    }
  }
});

test("invalid/unset control values fail closed, and caller headers cannot bypass standby", async () => {
  for (const [handler, envName] of [
    [codexLinks, "CODEX_LINKS_STANDBY"],
    [codexSave, "CODEX_SAVE_STANDBY"]
  ]) {
    for (const setting of [undefined, "", "unexpected", "ON"]) {
      const env = setting === undefined ? {} : { [envName]: setting };
      const f = fixture(
        handler,
        "/api/status?CODEX_LINKS_STANDBY=off&CODEX_SAVE_STANDBY=off",
        "GET",
        env,
        { "x-write-token": "synthetic-not-a-token", "x-standby": "off" }
      );
      assert.equal((await f.run()).status, 503);
      assert.equal(f.effects().nextCalls, 0);
    }
  }
});
