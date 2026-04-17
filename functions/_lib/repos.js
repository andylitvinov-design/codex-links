import { MAX_REPO_CONTEXTS, REPO_CONTEXTS_STORAGE_KEY } from "./constants.js";

const REQUIRED_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const DEFAULT_GITHUB_OWNER = "andylitvinov-design";

function normalizeText(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeIsoDate(value) {
  const normalized = normalizeText(value, 80);

  if (!normalized) {
    return "";
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function normalizeContextFiles(value) {
  const files = Array.isArray(value) ? value : [];

  return [...new Set(
    files
      .map((entry) => normalizeText(entry, 80))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeWorkspacePath(value) {
  return normalizeText(value, 500);
}

function normalizeUrl(value) {
  return normalizeText(value, 400);
}

function normalizeRepoId(value) {
  return normalizeText(value, 240).toLowerCase();
}

function normalizeNameWithOwner(value, repoId) {
  return normalizeText(value, 240) || repoId;
}

function normalizeRepoManifestEntry(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const repoId = normalizeRepoId(input.repoId || input.nameWithOwner);
  const nameWithOwner = normalizeNameWithOwner(input.nameWithOwner, repoId);

  if (!repoId || !nameWithOwner) {
    return null;
  }

  const contextFiles = normalizeContextFiles(input.contextFiles);

  return {
    repoId,
    nameWithOwner,
    workspacePath: normalizeWorkspacePath(input.workspacePath),
    url: normalizeUrl(input.url),
    updatedAt: normalizeIsoDate(input.updatedAt),
    isPrivate: normalizeBoolean(input.isPrivate),
    isArchived: normalizeBoolean(input.isArchived),
    contextFiles,
    contextReady: normalizeBoolean(input.contextReady) && REQUIRED_CONTEXT_FILES.every((file) => contextFiles.includes(file)),
    lastSyncedAt: normalizeIsoDate(input.lastSyncedAt) || new Date().toISOString()
  };
}

function normalizeGithubRepo(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const name = normalizeText(input.name, 160);
  const nameWithOwner = normalizeText(input.nameWithOwner, 240);
  const repoId = normalizeRepoId(nameWithOwner);

  if (!repoId || !name) {
    return null;
  }

  return {
    id: repoId,
    name,
    nameWithOwner,
    url: normalizeText(input.url, 400),
    updatedAt: normalizeIsoDate(input.updatedAt),
    isPrivate: normalizeBoolean(input.isPrivate),
    isArchived: normalizeBoolean(input.isArchived)
  };
}

async function callGithubApi(url, token) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${body.trim() || "request failed"}`);
  }

  return response.json();
}

async function fetchGithubRepoPage(owner, token, page, kind = "orgs") {
  const url = new URL(`https://api.github.com/${kind}/${encodeURIComponent(owner)}/repos`);
  url.searchParams.set("type", "all");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));

  return callGithubApi(url.toString(), token);
}

export function getGithubOwner(env) {
  return normalizeText(env?.GITHUB_OWNER, 120) || DEFAULT_GITHUB_OWNER;
}

export function getRequiredContextFiles() {
  return [...REQUIRED_CONTEXT_FILES];
}

export async function readRepoContexts(env) {
  const existing = await env.LINKS_STORE.get(REPO_CONTEXTS_STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .map((entry) => normalizeRepoManifestEntry(entry))
    .filter(Boolean)
    .sort((left, right) =>
      String(right.lastSyncedAt || "").localeCompare(String(left.lastSyncedAt || ""))
      || left.nameWithOwner.localeCompare(right.nameWithOwner, "en")
    );
}

export async function writeRepoContexts(env, entries) {
  const normalized = [...new Map(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => normalizeRepoManifestEntry(entry))
      .filter(Boolean)
      .map((entry) => [entry.repoId, entry])
  ).values()]
    .slice(0, MAX_REPO_CONTEXTS)
    .sort((left, right) =>
      String(right.lastSyncedAt || "").localeCompare(String(left.lastSyncedAt || ""))
      || left.nameWithOwner.localeCompare(right.nameWithOwner, "en")
    );

  await env.LINKS_STORE.put(REPO_CONTEXTS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function fetchGithubRepos(env) {
  const owner = getGithubOwner(env);
  const token = normalizeText(env?.GITHUB_TOKEN, 300);
  const repos = [];
  let page = 1;
  let ownerKind = "orgs";

  while (page <= 5) {
    let data;

    try {
      data = await fetchGithubRepoPage(owner, token, page, ownerKind);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (ownerKind === "orgs" && /GitHub API 404/i.test(message)) {
        ownerKind = "users";
        data = await fetchGithubRepoPage(owner, token, page, ownerKind);
      } else {
        throw error;
      }
    }

    const items = Array.isArray(data) ? data : [];

    repos.push(...items
      .map((item) => normalizeGithubRepo(item))
      .filter(Boolean)
    );

    if (items.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
}

export async function listEligibleCloudRepos(env) {
  const manifest = await readRepoContexts(env);
  let githubRepos = [];
  let source = `github:${getGithubOwner(env)}+kv-context-manifest`;

  try {
    githubRepos = await fetchGithubRepos(env);
  } catch {
    githubRepos = [];
  }

  const manifestById = new Map(
    manifest.map((entry) => [entry.repoId, entry])
  );

  const mergedGithubRepos = githubRepos.length
    ? githubRepos
    : manifest
        .map((entry) => ({
          id: entry.repoId,
          name: String(entry.nameWithOwner || "").split("/").pop() || entry.repoId,
          nameWithOwner: entry.nameWithOwner,
          url: entry.url,
          updatedAt: entry.updatedAt || entry.lastSyncedAt,
          isPrivate: entry.isPrivate,
          isArchived: entry.isArchived
        }))
        .filter((entry) => entry.nameWithOwner);

  if (!githubRepos.length) {
    source = "kv-context-manifest-fallback";
  }

  const repos = mergedGithubRepos
    .filter((repo) => !repo.isArchived)
    .map((repo) => {
      const manifestEntry = manifestById.get(repo.id);

      if (!manifestEntry || !manifestEntry.contextReady) {
        return null;
      }

      return {
        id: repo.id,
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        url: repo.url,
        updatedAt: repo.updatedAt,
        isPrivate: repo.isPrivate,
        contextReady: manifestEntry.contextReady,
        contextFiles: manifestEntry.contextFiles,
        workspacePath: manifestEntry.workspacePath,
        sortLabel: `${repo.nameWithOwner} · ${repo.updatedAt || ""}`
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
      || left.nameWithOwner.localeCompare(right.nameWithOwner, "en")
    );

  return {
    repos,
    generatedAt: new Date().toISOString(),
    source
  };
}
