export const STORAGE_KEY = "links:index:v1";
export const COMMANDS_STORAGE_KEY = "commands:index:v1";
export const INBOX_MESSAGES_STORAGE_KEY = "inbox:messages:v1";
export const THREADS_STORAGE_KEY = "threads:index:v1";
export const BRIDGE_STATUS_STORAGE_KEY = "bridge:status:v1";
export const MAX_LINKS = 500;
export const MAX_COMMANDS = 200;
export const MAX_INBOX_MESSAGES = 500;
export const MAX_THREADS = 500;
export const HISTORY_RETENTION_DAYS = 7;
export const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store"
};
