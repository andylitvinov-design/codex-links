#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DEFAULT_THREAD_KEY = "chatgpt-openclaw-codex-loop";

export const ALLOWED_STATUSES = new Set([
  "proposed",
  "approved",
  "dispatched",
  "running",
  "needs_user_decision",
  "completed",
  "failed"
]);

export const MANDATORY_FORBIDDEN_ACTIONS = [
  "no secrets/env values",
  "no .env reads",
  "no merge without explicit approval",
  "no deploy without explicit approval",
  "no delete without explicit approval"
];

const PROJECT_DEFAULTS = {
  finance: {
    repo: "andylitvinov-design/finance",
    goal: "Verify production updated to expected commit",
    prompt: "Check /api/status and compare expected commit",
    allowedActions: [
      "read repo",
      "run tests",
      "run build",
      "GET /api/status",
      "GET /api/audit-snapshot"
    ],
    forbiddenActions: [
      "financial/account changes without approval"
    ]
  },
  "reiki-yggdrasil": {
    repo: "andylitvinov-design/reiki-yggdrasil",
    goal: "Verify public routes are reachable after deploy",
    prompt: "Check /, /profile, /masters, /profile/admin",
    allowedActions: [
      "read repo",
      "run build",
      "GET /",
      "GET /profile",
      "GET /masters",
      "GET /profile/admin"
    ],
    forbiddenActions: [
      "Supabase secret values"
    ]
  }
};

function normalizeBlank(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE";
  return error;
}

function requireValue(argv, index, flag) {
  const value = normalizeBlank(argv[index + 1]);
  if (!value || String(value).startsWith("--")) {
    throw usageError(`${flag} requires a value`);
  }
  return value;
}

function uniq(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    threadKey: DEFAULT_THREAD_KEY,
    projectKey: null,
    repo: null,
    goal: null,
    prompt: null,
    allowedActions: [],
    forbiddenActions: [],
    status: "proposed",
    json: false,
    example: false,
    dryRun: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--example") {
      args.example = true;
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--thread-key") {
      args.threadKey = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--project") {
      args.projectKey = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      args.repo = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--goal") {
      args.goal = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--prompt") {
      args.prompt = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--allowed-action") {
      args.allowedActions.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--forbidden-action") {
      args.forbiddenActions.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--status") {
      args.status = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw usageError(`Unknown argument: ${arg}`);
  }

  if (!ALLOWED_STATUSES.has(args.status)) {
    throw usageError(`--status must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }

  if (!args.example && !args.projectKey) {
    throw usageError("--project is required unless --example is used");
  }

  if (!args.example && !args.goal) {
    throw usageError("--goal is required unless --example is used");
  }

  return args;
}

export function buildProposal(args, now = new Date()) {
  const createdAt = now.toISOString();
  const projectKey = args.example && !args.projectKey ? "finance" : args.projectKey;
  const defaults = PROJECT_DEFAULTS[projectKey] || {};
  const needsVerification = [];
  const repo = args.repo || defaults.repo || null;
  const prompt = args.prompt ?? defaults.prompt ?? "";
  const goal = args.goal || defaults.goal;

  if (!PROJECT_DEFAULTS[projectKey]) {
    needsVerification.push(`unknown projectKey: ${projectKey}`);
  }

  if (!repo) {
    needsVerification.push("repo missing");
  }

  if (!prompt) {
    needsVerification.push("prompt missing");
  }

  const allowedActions = args.allowedActions.length
    ? args.allowedActions
    : (defaults.allowedActions || []);

  const forbiddenActions = uniq([
    ...args.forbiddenActions,
    ...(defaults.forbiddenActions || []),
    ...MANDATORY_FORBIDDEN_ACTIONS
  ]);

  return {
    threadKey: args.threadKey || DEFAULT_THREAD_KEY,
    proposalId: `proposal-${randomUUID()}`,
    projectKey,
    repo,
    goal,
    prompt,
    allowedActions: uniq(allowedActions),
    forbiddenActions,
    requiresApproval: true,
    status: args.status || "proposed",
    codexRunId: null,
    deliveryId: null,
    resultSummary: null,
    changedFiles: [],
    checks: [],
    exactFailingCommand: null,
    risks: [],
    nextSuggestedPrompt: null,
    createdAt,
    updatedAt: createdAt,
    dryRun: true,
    needsVerification
  };
}

export function formatKeyValue(proposal) {
  return [
    `threadKey=${proposal.threadKey}`,
    `proposalId=${proposal.proposalId}`,
    `projectKey=${proposal.projectKey}`,
    `repo=${proposal.repo === null ? "null" : proposal.repo}`,
    `status=${proposal.status}`,
    `requiresApproval=${proposal.requiresApproval}`,
    `dryRun=${proposal.dryRun}`,
    "nextAction=Review proposal, then approve before dispatch."
  ].join("\n");
}

function main() {
  try {
    const args = parseArgs();
    const proposal = buildProposal(args);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatKeyValue(proposal)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    process.stderr.write(`error=${message}\n`);
    process.exitCode = error?.code === "USAGE" ? 1 : 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
