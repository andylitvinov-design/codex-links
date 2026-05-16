import {
  MAX_PROPOSALS,
  PROPOSAL_ITEM_PREFIX,
  PROPOSAL_THREAD_INDEX_PREFIX,
  PROPOSALS_RECENT_STORAGE_KEY
} from "./constants.js";

export const PROPOSAL_STATUSES = new Set([
  "proposed",
  "approved",
  "dispatched",
  "running",
  "needs_user_decision",
  "completed",
  "failed"
]);

const MAX_TEXT = 12000;
const MAX_SHORT_TEXT = 500;
const MAX_ID_TEXT = 220;
const MANDATORY_FORBIDDEN_ACTIONS = [
  "no secrets/env values",
  "no .env reads",
  "no merge without explicit approval",
  "no deploy without explicit approval",
  "no delete without explicit approval"
];

function normalizeText(rawValue, maxLength = MAX_TEXT) {
  return String(rawValue || "").trim().slice(0, maxLength);
}

function normalizeNullableText(rawValue, maxLength = MAX_TEXT) {
  const value = normalizeText(rawValue, maxLength);
  return value || null;
}

function normalizeId(rawValue) {
  return normalizeText(rawValue, MAX_ID_TEXT);
}

function normalizeArray(rawValue, maxLength = MAX_SHORT_TEXT) {
  return [...new Set(
    (Array.isArray(rawValue) ? rawValue : [])
      .map((value) => normalizeText(value, maxLength))
      .filter(Boolean)
  )];
}

function formatActionList(values) {
  const items = normalizeArray(values);
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none specified";
}

function proposalItemKey(proposalId) {
  return `${PROPOSAL_ITEM_PREFIX}${normalizeId(proposalId)}`;
}

function proposalThreadIndexKey(threadKey) {
  return `${PROPOSAL_THREAD_INDEX_PREFIX}${normalizeId(threadKey)}`;
}

function uniqIds(ids) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => normalizeId(id))
      .filter(Boolean)
  )].slice(-MAX_PROPOSALS);
}

async function readIdIndex(env, key) {
  const existing = await env.LINKS_STORE.get(key, "json");
  return uniqIds(existing);
}

async function writeIdIndex(env, key, ids) {
  await env.LINKS_STORE.put(key, JSON.stringify(uniqIds(ids)));
}

async function appendIndexId(env, key, id) {
  const current = await readIdIndex(env, key).catch(() => []);
  await writeIdIndex(env, key, [...current, id]);
}

function createProposalId() {
  if (globalThis.crypto?.randomUUID) {
    return `proposal-${globalThis.crypto.randomUUID()}`;
  }

  return `proposal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeProposal(input, now = new Date()) {
  const nowIso = now.toISOString();
  const threadKey = normalizeId(input?.threadKey);
  const projectKey = normalizeId(input?.projectKey);
  const goal = normalizeText(input?.goal, MAX_SHORT_TEXT);
  const prompt = normalizeText(input?.prompt);

  if (!threadKey) {
    return { ok: false, error: "threadKey is required." };
  }

  if (!projectKey) {
    return { ok: false, error: "projectKey is required." };
  }

  if (!goal) {
    return { ok: false, error: "goal is required." };
  }

  if (!prompt) {
    return { ok: false, error: "prompt is required." };
  }

  const forbiddenActions = normalizeArray([
    ...normalizeArray(input?.forbiddenActions),
    ...MANDATORY_FORBIDDEN_ACTIONS
  ]);
  const createdAt = normalizeNullableText(input?.createdAt, 80) || nowIso;

  return {
    ok: true,
    value: {
      threadKey,
      proposalId: normalizeId(input?.proposalId) || createProposalId(),
      projectKey,
      repo: normalizeNullableText(input?.repo, MAX_SHORT_TEXT),
      goal,
      prompt,
      allowedActions: normalizeArray(input?.allowedActions),
      forbiddenActions,
      requiresApproval: true,
      status: "proposed",
      codexRunId: null,
      deliveryId: null,
      resultSummary: null,
      changedFiles: [],
      checks: [],
      exactFailingCommand: null,
      risks: normalizeArray(input?.risks),
      nextSuggestedPrompt: normalizeNullableText(input?.nextSuggestedPrompt),
      createdAt,
      updatedAt: nowIso,
      approvedAt: null,
      approvedBy: null,
      dryRun: true,
      dispatchEnabled: false
    }
  };
}

async function persistProposal(env, proposal) {
  await env.LINKS_STORE.put(proposalItemKey(proposal.proposalId), JSON.stringify(proposal));
  await appendIndexId(env, PROPOSALS_RECENT_STORAGE_KEY, proposal.proposalId);
  await appendIndexId(env, proposalThreadIndexKey(proposal.threadKey), proposal.proposalId);
  return proposal;
}

async function readStoredProposal(env, proposalId) {
  const normalizedId = normalizeId(proposalId);

  if (!normalizedId) {
    return null;
  }

  const proposal = await env.LINKS_STORE.get(proposalItemKey(normalizedId), "json");
  return proposal && typeof proposal === "object" ? proposal : null;
}

async function readStoredProposalsByIds(env, ids) {
  const proposals = await Promise.all(uniqIds(ids).map((id) => readStoredProposal(env, id)));
  return proposals.filter(Boolean);
}

function sortNewestFirst(proposals) {
  return [...proposals].sort((left, right) => {
    const leftTime = Date.parse(left?.createdAt || "");
    const rightTime = Date.parse(right?.createdAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export async function createProposal(env, input, now = new Date()) {
  const normalized = normalizeProposal(input, now);

  if (!normalized.ok) {
    return normalized;
  }

  return persistProposal(env, normalized.value);
}

export async function listProposalsByThreadKey(env, threadKey) {
  const normalizedThreadKey = normalizeId(threadKey);

  if (!normalizedThreadKey) {
    return [];
  }

  const ids = await readIdIndex(env, proposalThreadIndexKey(normalizedThreadKey)).catch(() => []);
  const proposals = await readStoredProposalsByIds(env, ids);
  return sortNewestFirst(proposals.filter((proposal) => proposal.threadKey === normalizedThreadKey));
}

export async function getProposalById(env, proposalId) {
  return readStoredProposal(env, proposalId);
}

export async function approveProposal(env, proposalId, input = {}, now = new Date()) {
  const proposal = await getProposalById(env, proposalId);

  if (!proposal) {
    return { ok: false, status: 404, error: "Proposal not found." };
  }

  if (proposal.status !== "proposed") {
    return { ok: false, status: 400, error: "Proposal is not in proposed status." };
  }

  const approvedAt = now.toISOString();
  const approved = {
    ...proposal,
    status: "approved",
    approvedAt,
    approvedBy: normalizeNullableText(input?.approvedBy, 120),
    updatedAt: approvedAt,
    codexRunId: null,
    deliveryId: null,
    dispatchEnabled: false
  };

  await persistProposal(env, approved);
  return { ok: true, value: approved };
}

export function buildProposalCommandPrompt(proposal) {
  return [
    "Approved ChatGPT/Codex proposal.",
    "",
    `proposalId: ${normalizeId(proposal?.proposalId)}`,
    `threadKey: ${normalizeId(proposal?.threadKey)}`,
    `projectKey: ${normalizeId(proposal?.projectKey)}`,
    `repo: ${normalizeNullableText(proposal?.repo, MAX_SHORT_TEXT) || "needs verification"}`,
    `goal: ${normalizeText(proposal?.goal, MAX_SHORT_TEXT)}`,
    "",
    "Original approved prompt:",
    normalizeText(proposal?.prompt),
    "",
    "Allowed actions:",
    formatActionList(proposal?.allowedActions),
    "",
    "Forbidden actions:",
    formatActionList([
      ...normalizeArray(proposal?.forbiddenActions),
      "no secrets/env values",
      "no .env reads",
      "no merge/deploy/delete unless explicitly included in allowedActions",
      "no financial/account/access changes unless explicitly included in allowedActions"
    ]),
    "",
    "Stop condition:",
    "Complete only the approved task. Final report must include:",
    "- studied files",
    "- changed files",
    "- checks run",
    "- exact failing command if any",
    "- risks / needs verification",
    "- STATE/LOG update status",
    "- next suggested prompt"
  ].join("\n");
}

export function buildProposalCommandPayload(proposal) {
  const projectKey = normalizeId(proposal?.projectKey);
  const threadKey = normalizeId(proposal?.threadKey);
  const repo = normalizeNullableText(proposal?.repo, MAX_SHORT_TEXT);

  return {
    text: buildProposalCommandPrompt(proposal),
    clientId: `proposal:${normalizeId(proposal?.proposalId)}`,
    threadId: threadKey,
    threadLabel: `Proposal ${projectKey || threadKey}`,
    projectId: projectKey,
    projectLabel: projectKey,
    projectCategory: "approval-loop",
    targetRepo: repo || "",
    targetRepoUrl: repo ? `https://github.com/${repo}` : "",
    routeStrategy: "manual",
    progressStage: "queued"
  };
}

function getCommandDeliveryId(command) {
  return normalizeNullableText(
    command?.slackThreadTs
    || command?.slackMessageTs,
    MAX_ID_TEXT
  );
}

function getSafeDispatchError(command, fallbackStage = "dispatch-failed") {
  const stage = normalizeNullableText(
    command?.progressStage
    || command?.lastDiagnosticCode
    || fallbackStage,
    120
  ) || fallbackStage;
  const detail = normalizeNullableText(command?.lastDiagnosticDetail || command?.errorMessage, MAX_SHORT_TEXT);

  return detail ? `${stage}: ${detail}` : stage;
}

export async function markProposalDispatched(env, proposal, command, now = new Date()) {
  const dispatchedAt = now.toISOString();
  const updated = {
    ...proposal,
    status: "dispatched",
    dispatchedAt,
    commandId: normalizeId(command?.id),
    codexRunId: normalizeNullableText(command?.codexRunId, MAX_ID_TEXT),
    deliveryId: getCommandDeliveryId(command),
    dispatchEnabled: true,
    updatedAt: dispatchedAt
  };

  await persistProposal(env, updated);
  return updated;
}

export async function markProposalDispatchFailed(env, proposal, command, stage = "dispatch-failed", now = new Date()) {
  const failedAt = now.toISOString();
  const updated = {
    ...proposal,
    status: "approved",
    dispatchEnabled: false,
    dispatchErrorSummary: getSafeDispatchError(command, stage),
    updatedAt: failedAt
  };

  await persistProposal(env, updated);
  return updated;
}
