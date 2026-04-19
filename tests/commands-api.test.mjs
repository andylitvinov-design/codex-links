import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/commands.js";
import { writeCommands } from "../functions/_lib/commands.js";

function createMockEnv() {
  const store = new Map();

  return {
    LINKS_WRITE_TOKEN: "test-token",
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

test("bulk GET /api/commands omits photo data by default", async () => {
  const env = createMockEnv();

  await writeCommands(env, [{
    id: "cmd-photo",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "photo command",
    createdAt: new Date().toISOString(),
    status: "queued",
    photo: {
      contentType: "image/jpeg",
      fileName: "photo.jpg",
      size: 12,
      dataUrl: "data:image/jpeg;base64,AAAA"
    }
  }]);

  const response = await onRequest({
    request: new Request("https://example.com/api/commands", {
      headers: {
        "x-write-token": "test-token"
      }
    }),
    env
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.commands.length, 1);
  assert.equal(payload.commands[0].photo.hasDataUrl, true);
  assert.equal("dataUrl" in payload.commands[0].photo, false);
});

test("GET /api/commands?id=... can include photo data explicitly", async () => {
  const env = createMockEnv();

  await writeCommands(env, [{
    id: "cmd-photo",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "photo command",
    createdAt: new Date().toISOString(),
    status: "queued",
    photo: {
      contentType: "image/jpeg",
      fileName: "photo.jpg",
      size: 12,
      dataUrl: "data:image/jpeg;base64,AAAA"
    }
  }]);

  const response = await onRequest({
    request: new Request("https://example.com/api/commands?id=cmd-photo&includePhotoData=1", {
      headers: {
        "x-write-token": "test-token"
      }
    }),
    env
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.command.photo.dataUrl, "data:image/jpeg;base64,AAAA");
});

test("GET /api/commands bulk list ignores includePhotoData=1 to stay slim", async () => {
  const env = createMockEnv();

  await writeCommands(env, [{
    id: "cmd-photo",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "photo command",
    createdAt: new Date().toISOString(),
    status: "queued",
    photo: {
      contentType: "image/jpeg",
      fileName: "photo.jpg",
      size: 12,
      dataUrl: "data:image/jpeg;base64,AAAA"
    }
  }]);

  const response = await onRequest({
    request: new Request("https://example.com/api/commands?includePhotoData=1", {
      headers: {
        "x-write-token": "test-token"
      }
    }),
    env
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.commands.length, 1);
  assert.equal("dataUrl" in payload.commands[0].photo, false);
});

test("GET /api/commands?scope=public stays slim and does not require auth", async () => {
  const env = createMockEnv();

  await writeCommands(env, [{
    id: "cmd-photo-public",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "visible photo command",
    createdAt: new Date().toISOString(),
    status: "queued",
    photo: {
      contentType: "image/jpeg",
      fileName: "photo.jpg",
      size: 12,
      dataUrl: "data:image/jpeg;base64,AAAA"
    }
  }]);

  const response = await onRequest({
    request: new Request("https://example.com/api/commands?scope=public"),
    env
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.commands.length, 1);
  assert.equal(payload.commands[0].photo.hasDataUrl, true);
  assert.equal("dataUrl" in payload.commands[0].photo, false);
});

test("GET /api/commands requires auth for non-public bulk list", async () => {
  const env = createMockEnv();

  const response = await onRequest({
    request: new Request("https://example.com/api/commands"),
    env
  });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, "Unauthorized.");
});

test("POST /api/commands keeps bridge requests on local-bridge", async () => {
  const env = createMockEnv();

  const response = await onRequest({
    request: new Request("https://example.com/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientId: "client-1",
        threadId: "links",
        threadLabel: "links",
        text: "bridge request",
        dispatchMode: "local-bridge",
        targetExecutionMode: "bridge"
      })
    }),
    env
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(String(payload?.command?.dispatchMode || "").trim(), "local-bridge");
  assert.equal(String(payload?.command?.requestedExecutor || "").trim(), "bridge");
});

test("POST /api/commands brokers cloud requests through the trusted cloud bridge", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "http://127.0.0.1:8788";
  env.CLOUD_BRIDGE_SHARED_SECRET = "secret";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url === "http://127.0.0.1:8788/v1/commands") {
      assert.equal(String(init.method || "GET").toUpperCase(), "POST");
      assert.ok(init.headers["x-codex-bridge-signature"]);
      assert.ok(init.headers["x-codex-bridge-timestamp"]);
      return Response.json({
        ok: true,
        jobId: "job-123",
        acceptedAt: "2026-04-19T12:00:00.000Z",
        progressMessage: "Trusted cloud bridge accepted the job."
      }, { status: 202 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await onRequest({
      request: new Request("https://example.com/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          clientId: "client-1",
          threadId: "links",
          threadLabel: "links",
          text: "cloud request",
          dispatchMode: "cloud",
          targetExecutionMode: "cloud",
          targetRepo: "andylitvinov-design/codex-links",
          targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
          targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
          targetWorkspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links"
        })
      }),
      env
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(String(payload?.command?.dispatchMode || "").trim(), "cloud");
    assert.equal(String(payload?.command?.status || "").trim(), "processing");
    assert.equal(String(payload?.command?.cloudJobId || "").trim(), "job-123");
    assert.equal(String(payload?.command?.progressMessage || "").trim(), "Trusted cloud bridge accepted the job.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/commands fails cloud requests clearly when trusted cloud bridge rejects them", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "http://127.0.0.1:8788";
  env.CLOUD_BRIDGE_SHARED_SECRET = "secret";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === "http://127.0.0.1:8788/v1/commands") {
      return Response.json({
        error: "bridge unavailable"
      }, { status: 503 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await onRequest({
      request: new Request("https://example.com/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          clientId: "client-1",
          threadId: "links",
          threadLabel: "links",
          text: "cloud request",
          dispatchMode: "cloud",
          targetExecutionMode: "cloud",
          targetRepo: "andylitvinov-design/codex-links",
          targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
          targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
          targetWorkspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links"
        })
      }),
      env
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(String(payload?.command?.status || "").trim(), "failed");
    assert.equal(String(payload?.command?.dispatchMode || "").trim(), "cloud");
    assert.equal(String(payload?.command?.lastDiagnosticCode || "").trim(), "cloud_bridge_rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
