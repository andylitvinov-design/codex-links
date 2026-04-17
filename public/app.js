const state = {
  commands: [],
  messages: [],
  threads: [],
  threadMessageCounts: {},
  activeThreadCategories: [],
  bridgeWatchdog: null,
  commandPoller: null,
  commandPollerInterval: 0,
  lastRenderedTimelineSize: 0,
  lastRenderedTimelineSignature: "",
  answerOpenUntil: {},
  answerCloseTimer: null,
  hardReloading: false,
  hasLoadedMessagesOnce: false,
  commandInputAutofill: {
    text: "",
    threadId: "",
    replyId: ""
  }
};

const BUILD_VERSION = "20260416-2148";
const FAST_POLL_INTERVAL_MS = 6000;
const IDLE_POLL_INTERVAL_MS = 20000;
const MAX_PHOTO_FILE_SIZE = 4_500_000;
const MAX_PHOTO_UPLOAD_BYTES = 1_600_000;
const MAX_PHOTO_DIMENSION = 1600;

const CLOUD_CODEX_CATEGORIES = new Set([
  "artefacts",
  "ezohata",
  "links",
  "sales",
  "system-optimization"
]);

const sharedCookieDomain = (
  window.location.hostname === "codex-links.pages.dev" ||
  window.location.hostname.endsWith(".codex-links.pages.dev")
)
  ? ".codex-links.pages.dev"
  : null;

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readCookie(name) {
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  const prefix = `${name}=`;
  const match = cookies.find((entry) => entry.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function writeCookie(name, value) {
  const encoded = encodeURIComponent(value);
  const cookie = [
    `${name}=${encoded}`,
    "Path=/",
    "Max-Age=31536000",
    "SameSite=Lax"
  ];

  if (window.location.protocol === "https:") {
    cookie.push("Secure");
  }

  if (sharedCookieDomain) {
    cookie.push(`Domain=${sharedCookieDomain}`);
  }

  document.cookie = cookie.join("; ");
}

function removeCookie(name) {
  const cookie = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax"
  ];

  if (window.location.protocol === "https:") {
    cookie.push("Secure");
  }

  if (sharedCookieDomain) {
    cookie.push(`Domain=${sharedCookieDomain}`);
  }

  document.cookie = cookie.join("; ");
}

const storage = {
  get clientId() {
    let value = safeLocalStorageGet("codex-links-client-id");

    if (!value) {
      value = readCookie("codex-links-client-id");
    }

    if (!value) {
      value = crypto.randomUUID();
    }

    safeLocalStorageSet("codex-links-client-id", value);
    writeCookie("codex-links-client-id", value);
    return value;
  },

  get selectedThreadIds() {
    let raw = safeLocalStorageGet("codex-links-selected-thread-ids");

    if (raw === null) {
      raw = readCookie("codex-links-selected-thread-ids") || null;
    }

    if (raw === null) {
      return [];
    }

    try {
      const value = JSON.parse(raw || "[]");
      safeLocalStorageSet("codex-links-selected-thread-ids", JSON.stringify(value));
      writeCookie("codex-links-selected-thread-ids", JSON.stringify(value));
      return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  set selectedThreadIds(value) {
    if (value === null) {
      safeLocalStorageRemove("codex-links-selected-thread-ids");
      removeCookie("codex-links-selected-thread-ids");
      return;
    }

    const normalized = Array.isArray(value)
      ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];

    const serialized = JSON.stringify(normalized);
    safeLocalStorageSet("codex-links-selected-thread-ids", serialized);
    writeCookie("codex-links-selected-thread-ids", serialized);
  },

  get showAllMessages() {
    const raw = safeLocalStorageGet("codex-links-show-all-messages") ?? readCookie("codex-links-show-all-messages");
    return raw === "1";
  },

  set showAllMessages(value) {
    const normalized = value ? "1" : "0";
    safeLocalStorageSet("codex-links-show-all-messages", normalized);
    writeCookie("codex-links-show-all-messages", normalized);
  }
};

const refreshButton = document.querySelector("#refresh-button");
const commandForm = document.querySelector("#command-form");
const commandThreadSelect = document.querySelector("#command-thread-select");
const commandPhotoInput = document.querySelector("#command-photo-input");
const commandPhotoStatus = document.querySelector("#command-photo-status");
const commandInput = document.querySelector("#command-input");
const commandStatus = document.querySelector("#command-status");
const commandTimeline = document.querySelector("#command-timeline");
const submitProgress = document.querySelector("#submit-progress");
const threadSettingsToggle = document.querySelector("#thread-settings-toggle");
const threadSettingsSummary = document.querySelector("#thread-settings-summary");
const threadSettingsPanel = document.querySelector("#thread-settings-panel");
const threadSettingsShowAll = document.querySelector("#thread-settings-show-all");
const threadSettingsSearch = document.querySelector("#thread-settings-search");
const threadCategoriesSummary = document.querySelector("#thread-categories-summary");
const threadCategoriesList = document.querySelector("#thread-categories-list");
const threadSettingsList = document.querySelector("#thread-settings-list");
const threadSettingsSave = document.querySelector("#thread-settings-save");
const threadSettingsSelectAll = document.querySelector("#thread-settings-select-all");
const threadSettingsClear = document.querySelector("#thread-settings-clear");

function estimateDataUrlBytes(dataUrl) {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(String(dataUrl || "").trim());

  if (!match) {
    return 0;
  }

  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото."));
    image.src = url;
  });
}

async function buildResizedPhotoData(file) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(objectUrl);
    const longestSide = Math.max(image.naturalWidth || 0, image.naturalHeight || 0) || 1;
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / longestSide);
    const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Браузер не смог подготовить фото.");
    }

    context.drawImage(image, 0, 0, width, height);

    let quality = 0.86;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);

    while (estimateDataUrlBytes(dataUrl) > MAX_PHOTO_UPLOAD_BYTES && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    if (estimateDataUrlBytes(dataUrl) > MAX_PHOTO_UPLOAD_BYTES) {
      throw new Error("Фото слишком большое даже после сжатия. Выберите другое изображение.");
    }

    return {
      dataUrl,
      contentType: "image/jpeg",
      size: estimateDataUrlBytes(dataUrl)
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function preparePhotoPayload(file) {
  if (!file) {
    return null;
  }

  if (!String(file.type || "").toLowerCase().startsWith("image/")) {
    throw new Error("Можно отправить только изображение.");
  }

  if (file.size > MAX_PHOTO_FILE_SIZE) {
    throw new Error("Фото больше 4.5 MB. Уменьшите файл и попробуйте снова.");
  }

  if (file.size <= MAX_PHOTO_UPLOAD_BYTES) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      fileName: file.name,
      contentType: String(file.type || "image/jpeg").toLowerCase(),
      size: file.size,
      dataUrl
    };
  }

  const resized = await buildResizedPhotoData(file);
  return {
    fileName: file.name,
    contentType: resized.contentType,
    size: resized.size,
    dataUrl: resized.dataUrl
  };
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value || "";
  }
}

function escapeThreadLabel(thread) {
  return thread || "";
}

function isCloudCodexCategory(category) {
  return CLOUD_CODEX_CATEGORIES.has(String(category || "").trim().toLowerCase());
}

function compareBuildVersions(left, right) {
  return String(left || "").localeCompare(String(right || ""), "en", { numeric: true });
}

async function ensureLatestClient() {
  if (state.hardReloading) {
    return true;
  }

  const url = new URL("/version.json", window.location.origin);
  url.searchParams.set("_", String(Date.now()));

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const latestVersion = String(data?.build || "").trim();
    const currentUrlVersion = String(new URL(window.location.href).searchParams.get("v") || "").trim();

    if (
      !latestVersion
      || latestVersion === BUILD_VERSION
      || compareBuildVersions(latestVersion, BUILD_VERSION) < 0
      || latestVersion === currentUrlVersion
    ) {
      return false;
    }

    state.hardReloading = true;
    setCommandStatusMessage("Обновляю страницу до новой версии…");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("v", latestVersion);
    window.location.replace(nextUrl.toString());
    return true;
  } catch {
    return false;
  }
}

function formatRelativeTime(value) {
  const timestamp = Number(new Date(value));

  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return "только что";
  }

  if (diffMinutes === 1) {
    return "1 мин назад";
  }

  return `${diffMinutes} мин назад`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatThreadOptionLabel(thread) {
  const label = String(thread?.label || "").trim();
  const category = String(thread?.category || "").trim();
  const count = Math.max(0, Number(thread?.messageCount || 0));
  const suffix = count ? ` · ${count}` : "";
  return category ? `${category} / ${label}${suffix}` : `${label}${suffix}`;
}

function getAllThreadOptions() {
  return [...new Map(
    state.threads
      .map((thread) => {
        const id = String(thread?.id || "").trim();
        const label = escapeThreadLabel(thread?.label || "").trim();
        const displayLabel = formatThreadOptionLabel(thread);
        const category = String(thread?.category || "").trim();
        const messageCount = Math.max(0, Number(thread?.messageCount || 0));

        if (!id || !label || !displayLabel) {
          return null;
        }

        return [id, {
          id,
          label,
          displayLabel,
          category,
          messageCount
        }];
      })
      .filter(Boolean)
  ).values()].sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, "ru"));
}

function getActiveThreadId() {
  return String(commandThreadSelect?.value || "").trim();
}

function getSelectedThreadIds() {
  const stored = storage.selectedThreadIds;

  if (stored.length) {
    return stored;
  }

  return getAllThreadOptions().map((option) => option.id);
}

function clearCommandInputAutofill() {
  state.commandInputAutofill = {
    text: "",
    threadId: "",
    replyId: ""
  };
}

function getLatestAssistantReplyForThread(threadId) {
  const normalizedThreadId = String(threadId || "").trim();

  if (!normalizedThreadId) {
    return null;
  }

  return [...state.messages]
    .filter((message) =>
      message?.role === "assistant"
      && String(message.threadId || "").trim() === normalizedThreadId
      && String(message.text || "").trim()
    )
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
}

function applyReplyToCommandInput(reply, options = {}) {
  if (!commandInput || !reply) {
    return false;
  }

  const {
    force = false,
    threadId = getActiveThreadId()
  } = options;

  const nextText = String(reply.text || "");

  if (!nextText.trim()) {
    return false;
  }

  const currentText = String(commandInput.value || "");
  const previousAutofill = String(state.commandInputAutofill.text || "");

  if (!force && currentText && currentText !== previousAutofill) {
    return false;
  }

  commandInput.value = nextText;
  state.commandInputAutofill = {
    text: nextText,
    threadId: String(threadId || "").trim(),
    replyId: String(reply.id || "").trim()
  };
  return true;
}

function syncCommandInputWithSelectedThread(options = {}) {
  const { force = false } = options;
  const activeThreadId = getActiveThreadId();
  const latestReply = getLatestAssistantReplyForThread(activeThreadId);

  if (!latestReply) {
    return false;
  }

  return applyReplyToCommandInput(latestReply, {
    force,
    threadId: activeThreadId
  });
}

function getThreadDisplayLabel(threadId, fallbackLabel = "") {
  const normalizedId = String(threadId || "").trim();

  if (!normalizedId) {
    return fallbackLabel;
  }

  const match = state.threads.find((thread) => String(thread?.id || "").trim() === normalizedId);
  return match ? formatThreadOptionLabel(match) : fallbackLabel;
}

function getAllCategories() {
  return [...new Set(
    state.threads
      .map((thread) => String(thread?.category || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "ru"));
}

function renderThreadCategories() {
  if (!threadCategoriesList || !threadCategoriesSummary) {
    return;
  }

  threadCategoriesList.innerHTML = "";
  const categories = getAllCategories();

  threadCategoriesSummary.textContent = categories.length
    ? `Показано категорий: ${categories.length}`
    : "Категории не найдены.";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thread-category-chip";
    button.textContent = category;
    button.dataset.active = state.activeThreadCategories.includes(category) ? "1" : "0";
    button.addEventListener("click", () => {
      const next = new Set(state.activeThreadCategories);

      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }

      state.activeThreadCategories = [...next];
      renderThreadCategories();
      renderThreadSettingsList();
    });
    threadCategoriesList.appendChild(button);
  });
}

function renderThreadSettingsSummary() {
  if (!threadSettingsSummary) {
    return;
  }

  if (storage.showAllMessages) {
    threadSettingsSummary.textContent = "Показываются все чаты.";
    return;
  }

  const activeThreadId = getActiveThreadId();
  const activeThread = state.threads.find((thread) => String(thread?.id || "").trim() === activeThreadId);
  threadSettingsSummary.textContent = activeThread
    ? `Показывается чат: ${formatThreadOptionLabel(activeThread)}.`
    : "Показываются все чаты.";
}

function renderThreadSettingsList() {
  if (!threadSettingsList) {
    return;
  }

  const search = String(threadSettingsSearch?.value || "").trim().toLowerCase();
  const activeCategories = new Set(state.activeThreadCategories);
  const selectedThreadIds = new Set(getSelectedThreadIds());
  const options = getAllThreadOptions().filter((option) => {
    const haystack = `${option.displayLabel} ${option.category}`.toLowerCase();

    if (search && !haystack.includes(search)) {
      return false;
    }

    if (!activeCategories.size) {
      return true;
    }

    return activeCategories.has(option.category);
  });

  threadSettingsList.innerHTML = "";

  options.forEach((option) => {
    const row = document.createElement("label");
    row.className = "thread-settings-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedThreadIds.has(option.id);
    checkbox.addEventListener("change", () => {
      const next = new Set(getSelectedThreadIds());

      if (checkbox.checked) {
        next.add(option.id);
      } else {
        next.delete(option.id);
      }

      storage.selectedThreadIds = [...next];
      renderCommandThreads();
      renderThreadSettingsList();
      renderCommands();
      setCommandStatusMessage(
        checkbox.checked
          ? `Чат добавлен в поле Беседа Codex: ${option.displayLabel}.`
          : `Чат убран из поля Беседа Codex: ${option.displayLabel}.`
      );
    });

    const text = document.createElement("span");
    text.textContent = option.displayLabel;

    row.append(checkbox, text);
    threadSettingsList.appendChild(row);
  });
}

function ensureThreadVisible(threadId) {
  const normalizedId = String(threadId || "").trim();

  if (!normalizedId) {
    return false;
  }

  const allOptionIds = getAllThreadOptions().map((option) => option.id);

  if (!allOptionIds.includes(normalizedId)) {
    return false;
  }

  const selectedThreadIds = storage.selectedThreadIds;

  if (Array.isArray(selectedThreadIds) && !selectedThreadIds.includes(normalizedId)) {
    storage.selectedThreadIds = [...selectedThreadIds, normalizedId];
  }

  return true;
}

function activateReplyThread(threadId) {
  const normalizedId = String(threadId || "").trim();

  if (!ensureThreadVisible(normalizedId)) {
    return false;
  }

  renderCommandThreads();

  if ([...commandThreadSelect.options].some((option) => option.value === normalizedId)) {
    commandThreadSelect.value = normalizedId;
    commandThreadSelect.dispatchEvent(new Event("change"));
    return true;
  }

  return false;
}

function formatProgressStage(progressStage, status) {
  const stage = String(progressStage || "").trim();

  if (stage) {
    return stage.charAt(0).toUpperCase() + stage.slice(1);
  }

  if (status === "processing") {
    return "Обрабатывается";
  }

  if (status === "failed") {
    return "Ошибка";
  }

  if (status === "answered") {
    return "Ответ получен";
  }

  return "В очереди";
}

function formatCommandStage(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const label = formatProgressStage(command?.progressStage, status);
  const relative = formatRelativeTime(command?.progressUpdatedAt || command?.createdAt);
  return relative ? `${label} · ${relative}` : label;
}

function getLocalBridgeFallbackMessage(command) {
  if (String(command?.dispatchMode || "").trim() !== "local-bridge") {
    return "";
  }

  if (String(command?.status || "").trim() === "failed") {
    return String(command?.errorMessage || "").trim() || "Локальная доставка не удалась.";
  }

  return "Используется локальный bridge.";
}

function buildTimelineSignature(items, context = {}) {
  return JSON.stringify({
    activeThreadId: context.activeThreadId || "",
    showAllMessages: Boolean(context.showAllMessages),
    items: items.map((entry) => ({
      id: entry.id,
      role: entry.role,
      text: entry.text,
      createdAt: entry.createdAt,
      threadId: entry.threadId,
      threadLabel: entry.threadLabel,
      status: entry.status || "",
      progressStage: entry.progressStage || "",
      commandError: entry.command?.errorMessage || "",
      commandPrUrl: entry.command?.prUrl || "",
      commandBranch: entry.command?.branchName || "",
      linkedCommandId: entry.linkedCommand?.id || entry.message?.commandId || "",
      replies: (entry.replies || []).map((reply) => ({
        id: reply.id,
        createdAt: reply.createdAt,
        threadId: reply.threadId,
        textLength: String(reply.text || "").length,
        linkedCommandId: reply.linkedCommand?.id || reply.message?.commandId || ""
      }))
    })),
    openAnswers: Object.keys(state.answerOpenUntil)
      .filter((id) => state.answerOpenUntil[id] > Date.now())
      .sort()
  });
}

function scheduleAnswerAutoClose() {
  if (state.answerCloseTimer) {
    window.clearTimeout(state.answerCloseTimer);
    state.answerCloseTimer = null;
  }

  const timestamps = Object.values(state.answerOpenUntil).filter((value) => Number(value) > Date.now());

  if (!timestamps.length) {
    return;
  }

  const nextCloseAt = Math.min(...timestamps);
  state.answerCloseTimer = window.setTimeout(() => {
    pruneExpiredAnswerState();
    renderCommands();
  }, Math.max(100, nextCloseAt - Date.now()));
}

function pruneExpiredAnswerState() {
  const now = Date.now();

  Object.keys(state.answerOpenUntil).forEach((key) => {
    if (state.answerOpenUntil[key] <= now) {
      delete state.answerOpenUntil[key];
    }
  });
}

async function parseJsonResponse(response) {
  const rawText = await response.text();

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      error: rawText.trim() || `HTTP ${response.status}`
    };
  }
}

function hasAssistantReply(commandId) {
  const normalizedId = String(commandId || "").trim();

  if (!normalizedId) {
    return false;
  }

  return state.messages.some((message) => String(message?.commandId || "").trim() === normalizedId);
}

function isSystemConversationEntry(entry) {
  const threadId = String(entry?.threadId || "").trim().toLowerCase();
  const text = String(entry?.text || "").trim().toLowerCase();

  if (threadId === "dedupe-thread") {
    return true;
  }

  return (
    text.includes("dedupe test ignore")
    || text.includes("test command from site api")
    || text.includes("direct deploy command test")
    || text.includes("ready check command")
  );
}

function renderAssistantReplyMarkup(replyEntry) {
  const message = replyEntry?.message || null;
  const linkedCommand = replyEntry?.linkedCommand || null;
  const detailsId = String(message?.id || "").trim();
  const commandMeta = linkedCommand?.branchName
    ? `<p>Ветка: <code>${escapeHtml(linkedCommand.branchName)}</code></p>`
    : "";
  const prMeta = linkedCommand?.prUrl
    ? `<p><a href="${escapeHtml(linkedCommand.prUrl)}" target="_blank" rel="noreferrer">Открыть PR</a></p>`
    : "";

  return `
    <details class="command-answer" data-entry-id="${escapeHtml(detailsId)}">
      <summary>Ответ Codex</summary>
      <p>${escapeHtml(replyEntry?.text || "")}</p>
      ${prMeta}
      ${commandMeta}
      <div class="command-answer-actions">
        <button class="command-reply-link" type="button" data-thread-id="${escapeHtml(replyEntry?.threadId || "")}">
          Ответить
        </button>
      </div>
    </details>
  `;
}

function bindAssistantReplyInteractions(container, replies) {
  const normalizedReplies = Array.isArray(replies) ? replies : [];

  container.querySelectorAll(".command-answer").forEach((details) => {
    const detailsId = String(details.dataset.entryId || "").trim();

    if (detailsId && state.answerOpenUntil[detailsId] && state.answerOpenUntil[detailsId] > Date.now()) {
      details.open = true;
    }

    details.addEventListener("toggle", () => {
      if (!detailsId) {
        return;
      }

      if (details.open) {
        state.answerOpenUntil[detailsId] = Date.now() + 2 * 60 * 1000;
      } else {
        delete state.answerOpenUntil[detailsId];
      }

      scheduleAnswerAutoClose();
    });
  });

  container.querySelectorAll(".command-reply-link").forEach((replyLink) => {
    replyLink.addEventListener("click", () => {
      const threadId = String(replyLink.dataset.threadId || "").trim();
      const reply = normalizedReplies.find((entry) => String(entry?.threadId || "").trim() === threadId) || normalizedReplies[0];
      const message = reply?.message || null;
      const didActivate = activateReplyThread(threadId);

      if (!didActivate || !message) {
        setCommandStatusMessage("Не удалось выбрать тему беседы для ответа.", { tone: "error" });
        return;
      }

      applyReplyToCommandInput(message, {
        force: true,
        threadId
      });

      commandInput.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        commandInput.focus();
      }, 180);

      setCommandStatusMessage(`Выбрана беседа: ${getThreadDisplayLabel(threadId, reply?.threadLabel || "")}`);
    });
  });
}

function renderCommands() {
  pruneExpiredAnswerState();
  const showAllMessages = storage.showAllMessages;
  const activeThreadId = showAllMessages ? "" : getActiveThreadId();
  const visibleCommands = state.commands
    .filter((command) => !activeThreadId || command.threadId === activeThreadId)
    .filter((command) => !isSystemConversationEntry(command))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const visibleMessages = state.messages
    .filter((message) => !activeThreadId || message.threadId === activeThreadId)
    .filter((message) => !isSystemConversationEntry(message));

  const commandsById = new Map(
    visibleCommands.map((command) => [String(command.id || "").trim(), command])
  );
  const commandIdsWithUserMessages = new Set(
    visibleMessages
      .filter((message) => message?.role === "user")
      .map((message) => String(message.commandId || "").trim())
      .filter(Boolean)
  );
  const assistantRepliesByCommandId = new Map();

  visibleMessages
    .filter((message) => message?.role === "assistant")
    .forEach((message) => {
      const commandId = String(message.commandId || "").trim();

      if (!commandId) {
        return;
      }

      const entry = {
        id: `message:${message.id}`,
        kind: "message",
        role: "assistant",
        text: message.text || "",
        createdAt: message.createdAt,
        threadId: message.threadId || "",
        threadLabel: message.threadLabel || "",
        message,
        linkedCommand: commandsById.get(commandId) || null
      };
      const items = assistantRepliesByCommandId.get(commandId) || [];
      items.push(entry);
      assistantRepliesByCommandId.set(commandId, items);
    });

  const timelineItems = [
    ...visibleCommands
      .filter((command) => !commandIdsWithUserMessages.has(String(command.id || "").trim()))
      .map((command) => ({
        id: `command:${command.id}`,
        kind: "command",
        role: "user",
        text: command.text || "",
        createdAt: command.createdAt,
        threadId: command.threadId || "",
        threadLabel: command.threadLabel || "",
        command,
        replies: assistantRepliesByCommandId.get(String(command.id || "").trim()) || []
      })),
    ...visibleMessages
      .filter((message) => {
        const commandId = String(message.commandId || "").trim();
        if (message.role === "assistant" && commandId) {
          return false;
        }

        return !(message.role === "user" && commandId && commandsById.has(commandId));
      })
      .map((message) => ({
        id: `message:${message.id}`,
        kind: "message",
        role: message.role === "assistant" ? "assistant" : "user",
        text: message.text || "",
        createdAt: message.createdAt,
        threadId: message.threadId || "",
        threadLabel: message.threadLabel || "",
        message,
        linkedCommand: commandsById.get(String(message.commandId || "").trim()) || null,
        replies: message.role === "user"
          ? (assistantRepliesByCommandId.get(String(message.commandId || "").trim()) || [])
          : []
      }))
  ].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));

  const signature = buildTimelineSignature(timelineItems, {
    activeThreadId,
    showAllMessages
  });

  if (signature === state.lastRenderedTimelineSignature) {
    scheduleAnswerAutoClose();
    return;
  }

  state.lastRenderedTimelineSignature = signature;
  commandTimeline.innerHTML = "";

  if (!timelineItems.length) {
    commandTimeline.innerHTML = '<div class="command-empty">Здесь будут только ваши сообщения и их доставка.</div>';
    state.lastRenderedTimelineSize = 0;
    return;
  }

  const fragment = document.createDocumentFragment();

  timelineItems.forEach((entry) => {
    const element = document.createElement("article");
    element.className = `command-item ${entry.role === "assistant" ? "command-item-assistant" : "command-item-user"}`;

    const shouldShowThreadMeta = showAllMessages || !activeThreadId;
    const threadMeta = shouldShowThreadMeta
      ? `<span>${escapeHtml(getThreadDisplayLabel(entry.threadId, entry.threadLabel || ""))}</span>`
      : "";

    if (entry.kind === "command") {
      const command = entry.command;
      const fallbackNote = getLocalBridgeFallbackMessage(command);
      const text = String(command?.text || "").trim() || (command?.photo ? "Фото" : "Сообщение без текста");
      const hasPhoto = Boolean(command?.photo);
      const repliesMarkup = (entry.replies || []).map((replyEntry) => renderAssistantReplyMarkup(replyEntry)).join("");

      element.innerHTML = `
        <div class="command-item-top">
          <strong>Вы</strong>
          <time>${formatDate(entry.createdAt)}</time>
        </div>
        <p>${escapeHtml(text)}</p>
        ${hasPhoto ? '<div class="command-fallback-note">К сообщению приложено фото.</div>' : ""}
        ${fallbackNote ? `<div class="command-fallback-note">${escapeHtml(fallbackNote)}</div>` : ""}
        ${repliesMarkup}
        <div class="command-item-top">
          <span>${formatCommandStage(command)}</span>
          ${threadMeta}
        </div>
      `;

      bindAssistantReplyInteractions(element, entry.replies);
      fragment.appendChild(element);
      return;
    }

    const message = entry.message;
    const linkedCommand = entry.linkedCommand;
    const isAssistant = entry.role === "assistant";
    const statusLabel = isAssistant
      ? (linkedCommand?.prUrl ? "PR готов" : "Ответ получен")
      : "Сообщение в истории";
    const body = isAssistant
      ? renderAssistantReplyMarkup(entry)
      : `<p>${escapeHtml(entry.text || "")}</p>${(entry.replies || []).map((replyEntry) => renderAssistantReplyMarkup(replyEntry)).join("")}`;

    element.innerHTML = `
      <div class="command-item-top">
        <strong>${isAssistant ? "Codex" : "Вы"}</strong>
        <time>${formatDate(entry.createdAt)}</time>
      </div>
      ${body}
      <div class="command-item-top">
        <span>${statusLabel}</span>
        ${threadMeta}
      </div>
    `;

    bindAssistantReplyInteractions(element, isAssistant ? [entry] : entry.replies);
    fragment.appendChild(element);
  });

  commandTimeline.appendChild(fragment);
  state.lastRenderedTimelineSize = timelineItems.length;
  scheduleAnswerAutoClose();
}

function setCommandStatusMessage(message, options = {}) {
  if (!commandStatus) {
    return;
  }

  const tone = typeof options === "string" ? options : options.tone || "";
  commandStatus.textContent = message || "";
  commandStatus.dataset.tone = tone;
}

function setPhotoStatusMessage(message, tone = "") {
  if (!commandPhotoStatus) {
    return;
  }

  commandPhotoStatus.textContent = message || "";
  commandPhotoStatus.dataset.tone = tone;
}

function setSubmitProgress(stage = "", tone = "") {
  if (!submitProgress) {
    return;
  }

  submitProgress.dataset.stage = stage;
  submitProgress.dataset.tone = tone;
  const dots = [...submitProgress.querySelectorAll(".submit-progress-dot")];
  const activeCount = stage === "queued"
    ? 2
    : stage === "processing"
      ? 4
      : stage === "answered"
        ? 5
        : stage === "failed"
          ? 5
          : 0;

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index < activeCount);
    dot.classList.toggle("is-current", index === Math.max(0, activeCount - 1) && activeCount > 0);
  });
}

function renderCommandThreads() {
  if (!commandThreadSelect) {
    return;
  }

  const options = getAllThreadOptions();
  const visibleIds = new Set(getSelectedThreadIds());
  const nextOptions = options.filter((option) => visibleIds.has(option.id));

  commandThreadSelect.innerHTML = "";

  nextOptions.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.displayLabel;
    commandThreadSelect.appendChild(element);
  });

  const currentValue = String(commandThreadSelect.value || "").trim();
  const targetValue = nextOptions.some((option) => option.id === currentValue)
    ? currentValue
    : nextOptions[0]?.id || "";

  if (targetValue) {
    commandThreadSelect.value = targetValue;
  }

  renderThreadSettingsSummary();
  renderCommands();
  syncCommandInputWithSelectedThread();
}

async function fetchBridgeStatus() {
  const response = await fetch(`/api/status?_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load status: ${response.status}`);
  }

  return response.json();
}

async function fetchThreads() {
  const response = await fetch(`/api/threads?_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load threads: ${response.status}`);
  }

  const data = await response.json();
  state.threads = Array.isArray(data?.threads) ? data.threads : [];
}

async function fetchThreadCounts() {
  const response = await fetch(`/thread-counts.json?_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    state.threadMessageCounts = {};
    return;
  }

  const data = await response.json();
  state.threadMessageCounts = data && typeof data === "object" ? data : {};
}

async function fetchCommands() {
  const url = new URL("/api/commands", window.location.origin);
  url.searchParams.set("clientId", storage.clientId);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load commands: ${response.status}`);
  }

  const data = await response.json();
  state.commands = Array.isArray(data?.commands) ? data.commands : [];
}

async function fetchMessages() {
  const url = new URL("/api/messages", window.location.origin);
  url.searchParams.set("clientId", storage.clientId);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load messages: ${response.status}`);
  }

  const data = await response.json();
  state.messages = Array.isArray(data?.messages) ? data.messages : [];
  const hasNewAssistantReply = state.hasLoadedMessagesOnce && state.messages.some((message) =>
    message?.role === "assistant"
  );
  state.hasLoadedMessagesOnce = true;

  if (hasNewAssistantReply) {
    syncCommandInputWithSelectedThread();
  }
}

async function refreshAll() {
  const results = await Promise.allSettled([
    fetchBridgeStatus(),
    fetchCommands(),
    fetchMessages(),
    fetchThreads(),
    fetchThreadCounts()
  ]);

  const statusResult = results[0];
  const commandsError = results[1].status === "rejected" ? results[1].reason : null;
  const messagesError = results[2].status === "rejected" ? results[2].reason : null;

  if (statusResult.status === "fulfilled") {
    const status = statusResult.value?.status || {};
    const bridgeStatusText = document.querySelector("#bridge-status-text");
    const bridgeWatchdogText = document.querySelector("#bridge-watchdog-text");

    if (bridgeStatusText) {
      bridgeStatusText.textContent = `Статус: ${status.executorLabel || "неизвестно"} · ${status.state || "idle"}`;
    }

    if (bridgeWatchdogText) {
      bridgeWatchdogText.textContent = `Watchdog: ${status.lastError || "ошибок нет"}`;
    }
  }

  renderThreadCategories();
  renderThreadSettingsList();
  renderCommandThreads();

  const hasCachedData = state.commands.length > 0 || state.messages.length > 0;

  if ((commandsError || messagesError) && hasCachedData) {
    setCommandStatusMessage("Часть данных не обновилась, показываю последнюю доступную версию.", { tone: "error" });
  } else if (commandsError && messagesError) {
    setCommandStatusMessage("Не удалось обновить команды и ответы.", { tone: "error" });
  } else if (messagesError) {
    setCommandStatusMessage("Не удалось обновить ответы.", { tone: "error" });
  } else if (commandsError) {
    setCommandStatusMessage("Не удалось обновить команды.", { tone: "error" });
  }

  renderCommands();
}

async function submitCommand(event) {
  event.preventDefault();

  const text = String(commandInput?.value || "").trim();
  const threadId = getActiveThreadId();

  if (!text && !(commandPhotoInput?.files?.[0])) {
    setCommandStatusMessage("Введите сообщение или прикрепите фото.", { tone: "error" });
    return;
  }

  setCommandStatusMessage("Отправляю сообщение…");
  setSubmitProgress("queued", "queued");

  const payload = {
    clientId: storage.clientId,
    threadId,
    threadLabel: getThreadDisplayLabel(threadId, ""),
    text
  };

  const photoFile = commandPhotoInput?.files?.[0];

  if (photoFile) {
    setPhotoStatusMessage("Подготавливаю фото для отправки…");
    payload.photo = await preparePhotoPayload(photoFile);
  }

  const response = await fetch("/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await parseJsonResponse(response);

  if (!response.ok) {
    setSubmitProgress("failed", "error");
    throw new Error(String(result?.error || "").trim() || `Не удалось отправить сообщение (HTTP ${response.status}).`);
  }

  commandInput.value = "";
  clearCommandInputAutofill();

  if (commandPhotoInput) {
    commandPhotoInput.value = "";
    setPhotoStatusMessage("Фото не выбрано.");
  }

  setSubmitProgress("processing", "processing");
  setCommandStatusMessage("Сообщение отправлено.");
  await refreshAll();
}

function startPolling() {
  if (state.commandPoller) {
    window.clearInterval(state.commandPoller);
  }

  state.commandPollerInterval = FAST_POLL_INTERVAL_MS;
  state.commandPoller = window.setInterval(() => {
    refreshAll().catch(() => {});
  }, state.commandPollerInterval);
}

function bindEvents() {
  refreshButton?.addEventListener("click", async () => {
    if (await ensureLatestClient()) {
      return;
    }

    await refreshAll();
  });

  commandForm?.addEventListener("submit", (event) => {
    submitCommand(event).catch((error) => {
      setSubmitProgress("failed", "error");
      setCommandStatusMessage(String(error?.message || "Не удалось отправить сообщение."), { tone: "error" });
    });
  });

  commandThreadSelect?.addEventListener("change", () => {
    renderThreadSettingsSummary();
    renderCommands();
    syncCommandInputWithSelectedThread();
  });

  commandPhotoInput?.addEventListener("change", () => {
    const file = commandPhotoInput.files?.[0];

    if (!file) {
      setPhotoStatusMessage("Фото не выбрано.");
      return;
    }

    const sizeLabel = file.size > 1_000_000
      ? `${(file.size / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1000))} KB`;
    setPhotoStatusMessage(`Выбрано фото: ${file.name} (${sizeLabel})`);
  });

  threadSettingsToggle?.addEventListener("click", () => {
    if (!threadSettingsPanel) {
      return;
    }

    const nextHidden = !threadSettingsPanel.hidden;
    threadSettingsPanel.hidden = nextHidden;
    threadSettingsToggle.setAttribute("aria-expanded", String(!nextHidden));
  });

  threadSettingsShowAll?.addEventListener("change", () => {
    storage.showAllMessages = Boolean(threadSettingsShowAll.checked);
    renderThreadSettingsSummary();
    renderCommands();
  });

  threadSettingsSearch?.addEventListener("input", () => {
    renderThreadSettingsList();
  });

  threadSettingsSave?.addEventListener("click", () => {
    if (threadSettingsPanel) {
      threadSettingsPanel.hidden = true;
      threadSettingsToggle?.setAttribute("aria-expanded", "false");
    }
  });

  threadSettingsSelectAll?.addEventListener("click", () => {
    storage.selectedThreadIds = getAllThreadOptions().map((option) => option.id);
    renderCommandThreads();
    renderThreadSettingsList();
  });

  threadSettingsClear?.addEventListener("click", () => {
    state.activeThreadCategories = [];
    if (threadSettingsSearch) {
      threadSettingsSearch.value = "";
    }
    storage.selectedThreadIds = null;
    renderThreadCategories();
    renderCommandThreads();
    renderThreadSettingsList();
  });
}

async function boot() {
  if (
    !refreshButton ||
    !threadSettingsToggle ||
    !threadSettingsSearch ||
    !threadSettingsSave ||
    !threadSettingsSelectAll ||
    !threadSettingsClear ||
    !commandThreadSelect ||
    !commandPhotoInput ||
    !commandForm ||
    !commandStatus
  ) {
    console.error("Codex Links: missing required DOM nodes during boot.");
    return;
  }

  if (threadSettingsShowAll) {
    threadSettingsShowAll.checked = storage.showAllMessages;
  }

  setPhotoStatusMessage("Фото не выбрано.");
  bindEvents();
  await refreshAll();
  startPolling();

  const url = new URL(window.location.href);
  url.searchParams.set("v", BUILD_VERSION);
  window.history.replaceState({}, "", url.toString());
}

boot().catch((error) => {
  console.error(error);
  setCommandStatusMessage(String(error?.message || "Не удалось запустить интерфейс."), { tone: "error" });
});
