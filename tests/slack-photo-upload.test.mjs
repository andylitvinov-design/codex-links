import test from "node:test";
import assert from "node:assert/strict";

import { postSlackCommand } from "../functions/_lib/slack.js";

test("postSlackCommand uploads attached photos into the original Slack thread", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_DISPATCH_TOKEN: "xoxp-human",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_ACTOR_PROBE_TIMEOUT_MS: "100",
    SLACK_ACTOR_PROBE_POLL_MS: "1"
  };
  const command = {
    id: "cmd-photo-thread",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    projectLabel: "links",
    projectCategory: "myprojects",
    targetRepo: "andylitvinov-design/codex-links",
    targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
    targetWorkspacePath: "/workspace/links",
    targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
    text: "Что на фото?",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 4,
      dataUrl: "data:image/png;base64,AAAAAA=="
    }
  };

  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: String(options.method || "GET"),
      body: options.body,
      authorization: String(options?.headers?.authorization || options?.headers?.Authorization || "")
    });

    if (String(url).includes("/api/auth.test")) {
      return {
        ok: true,
        async json() {
          return { ok: true, user_id: "UBOT" };
        }
      };
    }

    if (String(url).includes("/api/conversations.members")) {
      return {
        ok: true,
        async json() {
          return { ok: true, members: ["U999", "UBOT"] };
        }
      };
    }

    if (String(url).includes("/api/conversations.history")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            messages: [
              { ts: "1712345678.000050", user: "U999", text: "Ready for cloud photo work." }
            ]
          };
        }
      };
    }

    if (String(url).includes("/api/conversations.replies")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            messages: [
              { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
              { ts: "1712345678.000200", thread_ts: "1712345678.000100", user: "U999", text: "Проверяю и читаю файлы." }
            ]
          };
        }
      };
    }

    if (String(url).includes("/api/chat.postMessage")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            channel: "C123",
            ts: "1712345678.000100",
            message: {
              ts: "1712345678.000100",
              thread_ts: "1712345678.000100"
            }
          };
        }
      };
    }

    if (String(url).includes("/api/files.getUploadURLExternal")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            upload_url: "https://files.slack.test/upload",
            file_id: "F123"
          };
        }
      };
    }

    if (String(url) === "https://files.slack.test/upload") {
      return {
        ok: true,
        async text() {
          return "ok";
        }
      };
    }

    if (String(url).includes("/api/files.completeUploadExternal")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            files: [{
              id: "F123",
              permalink: "https://slack.com/files/F123/photo.png"
            }]
          };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    await postSlackCommand(env, command, "<@U999>");
  } finally {
    global.fetch = originalFetch;
  }

  const completeUploadRequest = requests.find((request) => request.url.includes("/api/files.completeUploadExternal"));
  assert.ok(completeUploadRequest, "expected files.completeUploadExternal request");
  const dispatchRequest = requests.find((request) => request.url.includes("/api/chat.postMessage"));
  const uploadUrlRequest = requests.find((request) => request.url.includes("/api/files.getUploadURLExternal"));
  const binaryUploadRequest = requests.find((request) => request.url === "https://files.slack.test/upload");
  assert.equal(dispatchRequest?.authorization, "Bearer xoxp-human");
  assert.equal(uploadUrlRequest?.authorization, "Bearer xoxp-human");
  assert.equal(binaryUploadRequest?.authorization, "Bearer xoxp-human");

  const body = new URLSearchParams(String(completeUploadRequest.body || ""));
  assert.equal(body.get("channel_id"), "C123");
  assert.equal(body.get("thread_ts"), "1712345678.000100");
});

test("postSlackCommand retries photo upload before succeeding", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_DISPATCH_TOKEN: "xoxp-human",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_API_TIMEOUT_MS: "15000",
    SLACK_ACTOR_PROBE_TIMEOUT_MS: "100",
    SLACK_ACTOR_PROBE_POLL_MS: "1"
  };
  const command = {
    id: "cmd-photo-retry",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    projectLabel: "links",
    projectCategory: "myprojects",
    targetRepo: "andylitvinov-design/codex-links",
    text: "Что на фото?",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 4,
      dataUrl: "data:image/png;base64,AAAAAA=="
    }
  };

  let uploadAttempts = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/auth.test")) {
      return { ok: true, async json() { return { ok: true, user_id: "UBOT" }; } };
    }

    if (String(url).includes("/api/conversations.members")) {
      return { ok: true, async json() { return { ok: true, members: ["U999", "UBOT"] }; } };
    }

    if (String(url).includes("/api/conversations.history")) {
      return { ok: true, async json() { return { ok: true, messages: [{ ts: "1712345678.000050", user: "U999", text: "Ready for cloud photo work." }] }; } };
    }

    if (String(url).includes("/api/conversations.replies")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            messages: [
              { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
              { ts: "1712345678.000200", thread_ts: "1712345678.000100", user: "U999", text: "Проверяю и читаю файлы." }
            ]
          };
        }
      };
    }

    if (String(url).includes("/api/chat.postMessage")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            channel: "C123",
            ts: "1712345678.000100",
            message: { ts: "1712345678.000100", thread_ts: "1712345678.000100" }
          };
        }
      };
    }

    if (String(url).includes("/api/files.getUploadURLExternal")) {
      uploadAttempts += 1;

      if (uploadAttempts === 1) {
        return {
          ok: true,
          async json() {
            return { ok: false, error: "temporarily_unavailable" };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return { ok: true, upload_url: "https://files.slack.test/upload", file_id: "F123" };
        }
      };
    }

    if (String(url) === "https://files.slack.test/upload") {
      return { ok: true, async text() { return "ok"; } };
    }

    if (String(url).includes("/api/files.completeUploadExternal")) {
      return {
        ok: true,
        async json() {
          return { ok: true, files: [{ id: "F123", permalink: "https://slack.com/files/F123/photo.png" }] };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${String(url)} ${String(options.method || "GET")}`);
  };

  try {
    const result = await postSlackCommand(env, command, "<@U999>");
    assert.equal(result.photoUpload?.fileId, "F123");
    assert.equal(uploadAttempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("postSlackCommand keeps the Slack thread alive when photo upload fails", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_DISPATCH_TOKEN: "xoxp-human",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_API_TIMEOUT_MS: "15000",
    SLACK_ACTOR_PROBE_TIMEOUT_MS: "100",
    SLACK_ACTOR_PROBE_POLL_MS: "1"
  };
  const command = {
    id: "cmd-photo-nonfatal",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    projectLabel: "links",
    projectCategory: "myprojects",
    targetRepo: "andylitvinov-design/codex-links",
    text: "Что на фото?",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 4,
      dataUrl: "data:image/png;base64,AAAAAA=="
    }
  };

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/api/auth.test")) {
      return { ok: true, async json() { return { ok: true, user_id: "UBOT" }; } };
    }

    if (String(url).includes("/api/conversations.members")) {
      return { ok: true, async json() { return { ok: true, members: ["U999", "UBOT"] }; } };
    }

    if (String(url).includes("/api/conversations.history")) {
      return { ok: true, async json() { return { ok: true, messages: [{ ts: "1712345678.000050", user: "U999", text: "Ready for cloud photo work." }] }; } };
    }

    if (String(url).includes("/api/conversations.replies")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            messages: [
              { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
              { ts: "1712345678.000200", thread_ts: "1712345678.000100", user: "U999", text: "Проверяю и читаю файлы." }
            ]
          };
        }
      };
    }

    if (String(url).includes("/api/chat.postMessage")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            channel: "C123",
            ts: "1712345678.000100",
            message: { ts: "1712345678.000100", thread_ts: "1712345678.000100" }
          };
        }
      };
    }

    if (String(url).includes("/api/files.getUploadURLExternal")) {
      return {
        ok: true,
        async json() {
          return { ok: false, error: "temporarily_unavailable" };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await postSlackCommand(env, command, "<@U999>");
    assert.equal(result.channel, "C123");
    assert.equal(result.threadTs, "1712345678.000100");
    assert.equal(result.photoUpload, null);
    assert.match(String(result.photoUploadError || ""), /temporarily_unavailable/i);
  } finally {
    global.fetch = originalFetch;
  }
});
