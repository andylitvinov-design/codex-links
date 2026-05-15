import test from "node:test";
import assert from "node:assert/strict";

import {
  approveProposal,
  createProposal,
  getProposalById,
  listProposalsByThreadKey
} from "../functions/_lib/proposals.js";
import { onRequest as proposalsRequest } from "../functions/api/proposals.js";
import { onRequest as proposalRequest } from "../functions/api/proposals/[proposalId].js";
import { onRequest as approveRequest } from "../functions/api/proposals/[proposalId]/approve.js";

function createMockEnv() {
  const store = new Map();

  return {
    ADMIN_TOKEN: "admin-token",
    LINKS_WRITE_TOKEN: "write-token",
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

test("createProposal stores a proposed dry-run record under threadKey", async () => {
  const env = createMockEnv();
  const created = await createProposal(env, {
    threadKey: "thread-a",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status",
    allowedActions: ["GET /api/status"],
    forbiddenActions: ["no secrets/env values"]
  }, new Date("2026-05-16T10:00:00.000Z"));

  const proposals = await listProposalsByThreadKey(env, "thread-a");
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].proposalId, created.proposalId);
  assert.equal(proposals[0].status, "proposed");
  assert.equal(proposals[0].requiresApproval, true);
  assert.equal(proposals[0].codexRunId, null);
  assert.equal(proposals[0].deliveryId, null);
  assert.equal(proposals[0].dryRun, true);
  assert.equal(proposals[0].dispatchEnabled, false);
});

test("approveProposal only changes proposed records to approved without dispatch metadata", async () => {
  const env = createMockEnv();
  const created = await createProposal(env, {
    threadKey: "thread-a",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status"
  }, new Date("2026-05-16T10:00:00.000Z"));

  const approved = await approveProposal(env, created.proposalId, {
    approvedBy: "operator"
  }, new Date("2026-05-16T10:01:00.000Z"));

  assert.equal(approved.ok, true);
  assert.equal(approved.value.status, "approved");
  assert.equal(approved.value.approvedBy, "operator");
  assert.equal(approved.value.approvedAt, "2026-05-16T10:01:00.000Z");
  assert.equal(approved.value.codexRunId, null);
  assert.equal(approved.value.deliveryId, null);
  assert.equal(approved.value.dispatchEnabled, false);
});

test("approveProposal rejects non-proposed records", async () => {
  const env = createMockEnv();
  const created = await createProposal(env, {
    threadKey: "thread-a",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status"
  }, new Date("2026-05-16T10:00:00.000Z"));

  await approveProposal(env, created.proposalId, {}, new Date("2026-05-16T10:01:00.000Z"));
  const second = await approveProposal(env, created.proposalId, {}, new Date("2026-05-16T10:02:00.000Z"));

  assert.equal(second.ok, false);
  assert.equal(second.error, "Proposal is not in proposed status.");
});

test("proposal API creates, lists, reads, and approves proposals", async () => {
  const env = createMockEnv();
  const createResponse = await proposalsRequest({
    env,
    request: new Request("https://example.test/api/proposals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-write-token": "write-token"
      },
      body: JSON.stringify({
        threadKey: "thread-api",
        projectKey: "finance",
        repo: "andylitvinov-design/finance",
        goal: "Verify production",
        prompt: "Check /api/status"
      })
    })
  });
  const createdBody = await readJson(createResponse);
  assert.equal(createResponse.status, 201);
  assert.equal(createdBody.proposal.status, "proposed");

  const listResponse = await proposalsRequest({
    env,
    request: new Request("https://example.test/api/proposals?threadKey=thread-api", {
      headers: { "x-write-token": "write-token" }
    })
  });
  const listBody = await readJson(listResponse);
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.proposals.length, 1);

  const readResponse = await proposalRequest({
    env,
    params: { proposalId: createdBody.proposal.proposalId },
    request: new Request(`https://example.test/api/proposals/${createdBody.proposal.proposalId}`, {
      headers: { "x-write-token": "write-token" }
    })
  });
  const readBody = await readJson(readResponse);
  assert.equal(readResponse.status, 200);
  assert.equal(readBody.proposal.proposalId, createdBody.proposal.proposalId);

  const approveResponse = await approveRequest({
    env,
    params: { proposalId: createdBody.proposal.proposalId },
    request: new Request(`https://example.test/api/proposals/${createdBody.proposal.proposalId}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-write-token": "write-token"
      },
      body: JSON.stringify({ approvedBy: "operator" })
    })
  });
  const approveBody = await readJson(approveResponse);
  assert.equal(approveResponse.status, 200);
  assert.equal(approveBody.proposal.status, "approved");
  assert.equal(approveBody.proposal.codexRunId, null);
  assert.equal(approveBody.proposal.deliveryId, null);
});

test("proposal API keeps proposal reads authorized", async () => {
  const env = createMockEnv();
  await createProposal(env, {
    threadKey: "thread-api",
    projectKey: "finance",
    repo: "andylitvinov-design/finance",
    goal: "Verify production",
    prompt: "Check /api/status"
  });

  const response = await proposalsRequest({
    env,
    request: new Request("https://example.test/api/proposals?threadKey=thread-api")
  });

  assert.equal(response.status, 401);
});
