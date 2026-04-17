import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;
const root = path.resolve(process.cwd(), "..");
const REQUIRED_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const githubOwner = process.env.GITHUB_OWNER || "andylitvinov-design";

if (!token) {
  console.error("Set LINKS_WRITE_TOKEN before running repo sync.");
  process.exit(1);
}

function parseGithubRepo(remote) {
  const value = String(remote || "").trim();
  const sshMatch = value.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);

  if (sshMatch) {
    return sshMatch[1];
  }

  return "";
}

function getRepoManifestEntry(repoPath) {
  const gitDir = path.join(repoPath, ".git");

  if (!fs.existsSync(gitDir)) {
    return null;
  }

  const contextFiles = REQUIRED_FILES.filter((file) => fs.existsSync(path.join(repoPath, file)));
  let origin = "";

  try {
    origin = execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], { encoding: "utf8" })
      .trim();
  } catch {
    origin = "";
  }

  const nameWithOwner = parseGithubRepo(origin);

  if (!nameWithOwner) {
    return null;
  }

  return {
    repoId: nameWithOwner.toLowerCase(),
    nameWithOwner,
    workspacePath: repoPath,
    contextFiles,
    contextReady: REQUIRED_FILES.every((file) => contextFiles.includes(file)),
    lastSyncedAt: new Date().toISOString()
  };
}

function loadGithubMetadata() {
  try {
    const output = execFileSync(
      "gh",
      ["repo", "list", githubOwner, "--limit", "100", "--json", "nameWithOwner,url,updatedAt,isPrivate,isArchived"],
      { encoding: "utf8" }
    );
    const items = JSON.parse(output);
    return new Map(
      (Array.isArray(items) ? items : [])
        .filter((item) => item?.nameWithOwner)
        .map((item) => [String(item.nameWithOwner || "").trim().toLowerCase(), item])
    );
  } catch {
    return new Map();
  }
}

const githubMetadata = loadGithubMetadata();

const repos = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => getRepoManifestEntry(path.join(root, entry.name)))
  .map((entry) => {
    if (!entry) {
      return null;
    }

    const meta = githubMetadata.get(String(entry.nameWithOwner || "").trim().toLowerCase());

    return {
      ...entry,
      url: String(meta?.url || `https://github.com/${entry.nameWithOwner}`).trim(),
      updatedAt: String(meta?.updatedAt || entry.lastSyncedAt).trim(),
      isPrivate: Boolean(meta?.isPrivate),
      isArchived: Boolean(meta?.isArchived)
    };
  })
  .filter(Boolean);

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/repos`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-write-token": token
  },
  body: JSON.stringify({ repos })
});

const body = await response.text();
console.log(response.status, body);

if (!response.ok) {
  process.exit(1);
}
