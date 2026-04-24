export const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store"
};

export const DIAGNOSIS_RUN_PREFIX = "codex-save:diagnosis:v1:";
export const REMEDIATION_RUN_PREFIX = "codex-save:remediation:v1:";
export const LATEST_DIAGNOSIS_KEY = "codex-save:diagnosis:latest:v1";
export const LATEST_REMEDIATION_KEY = "codex-save:remediation:latest:v1";

export const DEFAULT_TARGET = {
  baseUrl: "https://codex-links.pages.dev",
  threadId: "links",
  threadLabel: "links",
  projectId: "links",
  targetRepo: "andylitvinov-design/codex-links",
  targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
  targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"]
};

export const CHECK_STATE_PENDING = "pending";
export const CHECK_STATE_RUNNING = "running";
export const CHECK_STATE_COMPLETED = "completed";

export const RESULT_PASS = "pass";
export const RESULT_DEGRADED = "degraded";
export const RESULT_FAIL = "fail";
export const RESULT_BLOCKED = "blocked";
export const RESULT_UNKNOWN = "unknown";

export const DELIVERY_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

export const PHOTO_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotz6QAAAAASUVORK5CYII=";
