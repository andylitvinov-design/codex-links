import test from "node:test";
import assert from "node:assert/strict";

import { getMessagesForClient, readMessages, upsertMessages } from "../functions/_lib/messages.js";

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

test("upsertMessages persists messages through item and client indexes", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();
  const message = {
    id: "message-1",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    commandId: "command-1",
    role: "assistant",
    text: "OK",
    createdAt
  };

  const persisted = await upsertMessages(env, [message]);

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, message.id);

  const recent = await readMessages(env);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, message.id);

  const clientMessages = await getMessagesForClient(env, message.clientId);
  assert.equal(clientMessages.length, 1);
  assert.equal(clientMessages[0].id, message.id);
});
