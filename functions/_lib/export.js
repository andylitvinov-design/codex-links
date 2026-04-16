const EXPORT_DATASETS = new Set(["all", "commands", "messages", "links"]);

function normalizeDataset(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return EXPORT_DATASETS.has(normalized) ? normalized : "all";
}

function parseDateBoundary(rawValue, boundary) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}${boundary === "end" ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
    : value;

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

function joinArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).join(" | ")
    : "";
}

export function getExportQuery(searchParams) {
  const dataset = normalizeDataset(searchParams.get("dataset"));
  const from = parseDateBoundary(searchParams.get("from"), "start");
  const to = parseDateBoundary(searchParams.get("to"), "end");

  if (Number.isNaN(from)) {
    return { ok: false, error: "Invalid from date. Use YYYY-MM-DD." };
  }

  if (Number.isNaN(to)) {
    return { ok: false, error: "Invalid to date. Use YYYY-MM-DD." };
  }

  if (from !== null && to !== null && from > to) {
    return { ok: false, error: "`from` must be earlier than or equal to `to`." };
  }

  return {
    ok: true,
    value: { dataset, from, to }
  };
}

export function isWithinExportRange(value, range) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  if (range?.from !== null && timestamp < range.from) {
    return false;
  }

  if (range?.to !== null && timestamp > range.to) {
    return false;
  }

  return true;
}

export function buildExportRows(input = {}) {
  const rows = [];

  for (const command of Array.isArray(input.commands) ? input.commands : []) {
    rows.push({
      dataset: "commands",
      id: command.id || "",
      createdAt: command.createdAt || "",
      clientId: command.clientId || "",
      threadId: command.threadId || "",
      threadLabel: command.threadLabel || "",
      status: command.status || "",
      progressStage: command.progressStage || "",
      role: "",
      text: command.text || "",
      url: "",
      title: "",
      note: "",
      tags: "",
      threads: "",
      source: command.source || "",
      dispatchMode: command.dispatchMode || "",
      prUrl: command.prUrl || "",
      errorMessage: command.errorMessage || "",
      photoFileName: command.photo?.fileName || "",
      photoContentType: command.photo?.contentType || "",
      photoSize: Number(command.photo?.size || 0) || ""
    });
  }

  for (const message of Array.isArray(input.messages) ? input.messages : []) {
    rows.push({
      dataset: "messages",
      id: message.id || "",
      createdAt: message.createdAt || "",
      clientId: message.clientId || "",
      threadId: message.threadId || "",
      threadLabel: message.threadLabel || "",
      status: "",
      progressStage: "",
      role: message.role || "",
      text: message.text || "",
      url: "",
      title: "",
      note: "",
      tags: "",
      threads: "",
      source: "",
      dispatchMode: "",
      prUrl: "",
      errorMessage: "",
      photoFileName: "",
      photoContentType: "",
      photoSize: ""
    });
  }

  for (const link of Array.isArray(input.links) ? input.links : []) {
    rows.push({
      dataset: "links",
      id: link.id || "",
      createdAt: link.createdAt || "",
      clientId: "",
      threadId: "",
      threadLabel: "",
      status: "",
      progressStage: "",
      role: "",
      text: "",
      url: link.url || "",
      title: link.title || "",
      note: link.note || "",
      tags: joinArray(link.tags),
      threads: joinArray(link.threads),
      source: link.source || "",
      dispatchMode: "",
      prUrl: "",
      errorMessage: "",
      photoFileName: "",
      photoContentType: "",
      photoSize: ""
    });
  }

  return rows.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export function buildCsv(rows) {
  const headers = [
    "dataset",
    "id",
    "createdAt",
    "clientId",
    "threadId",
    "threadLabel",
    "status",
    "progressStage",
    "role",
    "text",
    "url",
    "title",
    "note",
    "tags",
    "threads",
    "source",
    "dispatchMode",
    "prUrl",
    "errorMessage",
    "photoFileName",
    "photoContentType",
    "photoSize"
  ];

  const lines = [
    "sep=,",
    headers.join(",")
  ];

  for (const row of Array.isArray(rows) ? rows : []) {
    lines.push(headers.map((header) => escapeCsvCell(row?.[header] ?? "")).join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildExportFilename(dataset, range) {
  const suffix = [
    dataset || "all",
    range?.from === null ? "start" : new Date(range.from).toISOString().slice(0, 10),
    range?.to === null ? "today" : new Date(range.to).toISOString().slice(0, 10)
  ].join("_");

  return `codex-links-export_${suffix}.csv`;
}
