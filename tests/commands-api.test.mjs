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

test("GET /api/commands can include photo data explicitly", async () => {
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
  assert.equal(payload.commands[0].photo.dataUrl, "data:image/jpeg;base64,AAAA");
});
