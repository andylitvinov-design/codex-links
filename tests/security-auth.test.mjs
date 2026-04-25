import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "../functions/_lib/security.js";

function makeRequest(token) {
  return new Request("https://example.test/api/admin/commands-maintenance", {
    headers: token ? { "x-write-token": token } : {}
  });
}

test("isAuthorized accepts ADMIN_TOKEN for admin endpoints", () => {
  assert.equal(isAuthorized(makeRequest("admin-secret"), {
    ADMIN_TOKEN: "admin-secret",
    LINKS_WRITE_TOKEN: "write-secret"
  }), true);
});

test("isAuthorized keeps LINKS_WRITE_TOKEN compatibility", () => {
  assert.equal(isAuthorized(makeRequest("write-secret"), {
    ADMIN_TOKEN: "admin-secret",
    LINKS_WRITE_TOKEN: "write-secret"
  }), true);
});

test("isAuthorized rejects missing or unknown tokens", () => {
  assert.equal(isAuthorized(makeRequest("wrong"), {
    ADMIN_TOKEN: "admin-secret",
    LINKS_WRITE_TOKEN: "write-secret"
  }), false);
  assert.equal(isAuthorized(makeRequest(""), {
    ADMIN_TOKEN: "admin-secret",
    LINKS_WRITE_TOKEN: "write-secret"
  }), false);
});
