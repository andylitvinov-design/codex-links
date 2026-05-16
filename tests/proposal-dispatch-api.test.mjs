import test from "node:test";
import assert from "node:assert/strict";

import {
  approveProposal,
  buildProposalCommandPayload,
  createProposal,
  getProposalById,
  markProposalDispatched
} from "../functions/_lib/proposals.js";
import { readCommands } from "../functions/_lib/commands.js";
import { onRequest as dispatchRequest } from "../functions/api/proposals/[proposalId]/dispatch.js";

function createMockEnv() {
  const store = new Map();

  return {
    ADMIN_TOKEN: "admin-token",
    LINKS_WRITE_TOKEN: "write-token",
    COMMAND_DISPATCH_MODE: "local-bridge",
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

async function readJson(response) {
  return response.json();
}

async function createApprovedProposal(env, overrides = {}) {
  const created = await createProposal(env, {
    threadKey: "thread-dispatch",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status and report exact commit.",
    allowedActions: ["read repo", "GET /api/status"],
    forbiddenActions: ["no secrets/env values", "no deploy"],
    ...overrides
  }, new Date("2026-05-16T10:00:00.000Z"));

  const approved = await approveProposal(env, created.proposalId, {
    approvedBy: "operator"
  }, new Date("2026-05-16T10:01:00.000Z"));

  assert.equal(approved.ok, true);
  return approved.value;
}

function createDispatchRequest(env, proposalId, headers = { "x-write-token": "write-token" }) {
  return dispatchRequest({
    env,
    params: { proposalId },
    request: new Request(`https://example.test/api/proposals/${proposalId}/dispatch`, {
      method: "POST",
      headers
    })
  });
}

test("proposal dispatch rejects unauthorized requests", async () => {
  const env = createMockEnv();
  const proposal = await createApprovedProposal(env);
  const response = await createDispatchRequest(env, proposal.proposalId, {});

  assert.equal(response.status, 401);
});

test("proposal dispatch returns 404 for missing proposal", async () => {
  const env = createMockEnv();
  const response = await createDispatchRequest(env, "proposal-missing");
  const body = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(body.error, "Proposal not found.");
});

test("proposal dispatch rejects unapproved proposals", async () => {
  const env = createMockEnv();
  const created = await createProposal(env, {
    threadKey: "thread-dispatch",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status."
  });

  const response = await createDispatchRequest(env, created.proposalId);
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, "Proposal is not approved.");
});

test("approved proposal dispatches into the existing command path", async () => {
  const env = createMockEnv();
  const proposal = await createApprovedProposal(env);

  const response = await createDispatchRequest(env, proposal.proposalId);
  const body = await readJson(response);
  const storedProposal = await getProposalById(env, proposal.proposalId);
  const commands = await readCommands(env);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(storedProposal.status, "dispatched");
  assert.equal(storedProposal.dispatchEnabled, true);
  assert.equal(typeof storedProposal.dispatchedAt, "string");
  assert.equal(storedProposal.commandId, body.command.id);
  assert.equal(storedProposal.codexRunId, null);
  assert.equal(storedProposal.deliveryId, null);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].id, storedProposal.commandId);
  assert.equal(commands[0].threadId, "thread-dispatch");
  assert.equal(commands[0].projectId, "finance");
  assert.equal(commands[0].targetRepo, "andylitvinov-design/finance");
  assert.equal(commands[0].dispatchMode, "local-bridge");
});

test("proposal dispatch is duplicate-safe and returns linked command", async () => {
  const env = createMockEnv();
  const proposal = await createApprovedProposal(env);

  const first = await readJson(await createDispatchRequest(env, proposal.proposalId));
  const secondResponse = await createDispatchRequest(env, proposal.proposalId);
  const second = await readJson(secondResponse);
  const commands = await readCommands(env);

  assert.equal(secondResponse.status, 200);
  assert.equal(second.duplicate, true);
  assert.equal(second.command.id, first.command.id);
  assert.equal(commands.length, 1);
});

test("dispatched proposal stores command, run, and delivery identifiers when available", async () => {
  const env = createMockEnv();
  const proposal = await createApprovedProposal(env);
  const updated = await markProposalDispatched(env, proposal, {
    id: "command-123",
    codexRunId: "run-123",
    slackThreadTs: "1711111111.000100",
    slackMessageTs: "1711111111.000000"
  }, new Date("2026-05-16T10:02:00.000Z"));
  const stored = await getProposalById(env, proposal.proposalId);

  assert.equal(updated.status, "dispatched");
  assert.equal(updated.dispatchedAt, "2026-05-16T10:02:00.000Z");
  assert.equal(updated.commandId, "command-123");
  assert.equal(updated.codexRunId, "run-123");
  assert.equal(updated.deliveryId, "1711111111.000100");
  assert.equal(updated.dispatchEnabled, true);
  assert.equal(stored.commandId, "command-123");
  assert.equal(stored.codexRunId, "run-123");
  assert.equal(stored.deliveryId, "1711111111.000100");
});

test("proposal command prompt includes approval wrapper and stop condition", async () => {
  const payload = buildProposalCommandPayload({
    proposalId: "proposal-123",
    threadKey: "thread-a",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status.",
    allowedActions: ["GET /api/status"],
    forbiddenActions: ["no deploy"]
  });

  assert.match(payload.text, /Approved ChatGPT\/Codex proposal\./);
  assert.match(payload.text, /proposalId: proposal-123/);
  assert.match(payload.text, /threadKey: thread-a/);
  assert.match(payload.text, /projectKey: finance/);
  assert.match(payload.text, /repo: andylitvinov-design\/finance/);
  assert.match(payload.text, /goal: Verify production/);
  assert.match(payload.text, /Original approved prompt:\nCheck \/api\/status\./);
  assert.match(payload.text, /Allowed actions:\n- GET \/api\/status/);
  assert.match(payload.text, /Forbidden actions:\n- no deploy/);
  assert.match(payload.text, /Stop condition:/);
  assert.match(payload.text, /STATE\/LOG update status/);
});

test("proposal dispatch does not request OpenClaw directly", async () => {
  const env = createMockEnv();
  const proposal = await createApprovedProposal(env);
  const body = await readJson(await createDispatchRequest(env, proposal.proposalId));

  assert.notEqual(body.command.targetExecutionMode, "openclaw");
  assert.notEqual(body.command.requestedExecutor, "openclaw");
  assert.equal(body.command.dispatchMode, "local-bridge");
});
