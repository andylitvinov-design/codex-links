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

const BUILD_VERSION = "20260415-1710";
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

function writeCookie(name, value, maxAgeSeconds = 60 * 60 * 24 * 365) {
  const parts = [
    `${name}=${encodeURIComponent(String(value || ""))}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Lax"
  ];

  if (sharedCookieDomain) {
    parts.push(`Domain=${sharedCookieDomain}`);
  }

  if (window.location.protocol === "https:") {
    parts.push("Secure");
  }

  document.cookie = parts.join("; ");
}

function removeCookie(name) {
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax"
  ];

  if (sharedCookieDomain) {
    parts.push(`Domain=${sharedCookieDomain}`);
  }

  if (window.location.protocol === "https:") {
    parts.push("Secure");
  }

  document.cookie = parts.join("; ");
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
      return null;
    }

    try {
      const value = JSON.parse(raw || "[]");
      safeLocalStorageSet("codex-links-selected-thread-ids", JSON.stringify(value));
      writeCookie("codex-links-selected-thread-ids", JSON.stringify(value));
      return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return null;
    }
  },

  set selectedThreadIds(value) {
    if (value === null) {
      safeLocalStorageRemove("codex-links-selected-thread-ids");
      removeCookie("codex-links-selected-thread-ids");
      return;
    }

    const normalized = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
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
const bridgeStatusText = document.querySelector("#bridge-status-text");
const bridgeWatchdogText = document.querySelector("#bridge-watchdog-text");
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
const exportDateFrom = document.querySelector("#export-date-from");
const exportDateTo = document.querySelector("#export-date-to");
const exportDataset = document.querySelector("#export-dataset");
const exportButton = document.querySelector("#export-button");
const exportStatus = document.querySelector("#export-status");

function isoDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function getDefaultExportFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return isoDateOnly(date);
}

function getDefaultExportToDate() {
  return isoDateOnly(new Date());
}

function setExportStatusMessage(message, tone = "") {
  if (!exportStatus) {
    return;
  }

  exportStatus.textContent = message;
  exportStatus.dataset.tone = tone;
}

async function exportDataForPeriod() {
  if (!exportDateFrom || !exportDateTo || !exportDataset || !exportButton) {
    return;
  }

  const from = String(exportDateFrom.value || "").trim();
  const to = String(exportDateTo.value || "").trim();
  const dataset = String(exportDataset.value || "all").trim();

  if (!from || !to) {
    setExportStatusMessage("Выбери обе даты периода.", "error");
    return;
  }

  if (from > to) {
    setExportStatusMessage("Дата начала должна быть не позже даты конца.", "error");
    return;
  }

  exportButton.disabled = true;
  setExportStatusMessage("Готовлю выгрузку…", "processing");

  try {
    const url = new URL("/api/export", window.location.origin);
    url.searchParams.set("dataset", dataset);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("clientId", storage.clientId);

    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        accept: "text/csv"
      }
    });

    if (!response.ok) {
      const result = await parseJsonResponse(response);
      const message = String(result?.error || "").trim();
      throw new Error(message || `Не удалось выгрузить данные (HTTP ${response.status}).`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename=\"([^\"]+)\"/i);
    const filename = match?.[1] || `codex-links-export_${dataset}_${from}_${to}.csv`;
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setExportStatusMessage("CSV выгружен. Файл можно открыть в Excel.", "success");
  } catch (error) {
    const message = String(error?.message || "").trim();
    setExportStatusMessage(message || "Не удалось выгрузить данные.", "error");
  } finally {
    exportButton.disabled = false;
  }
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function escapeThreadLabel(thread) {
  return thread || "";
}

function isCloudCodexCategory(category) {
  return CLOUD_CODEX_CATEGORIES.has(String(category || "").trim().toLowerCase());
}

function formatCategoryLabel(category) {
  const value = String(category || "").trim();

  if (!value) {
    return "";
  }

  return isCloudCodexCategory(value) ? `${value} *` : value;
}

function toTitleStart(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compactThreadLabel(rawLabel) {
  let label = String(rawLabel || "").replace(/\s+/g, " ").trim();

  if (!label) {
    return "";
  }

  const leadingVerbPatterns = [
    /^опубликовать\s+/i,
    /^подсчитай\s+/i,
    /^сделай\s+/i,
    /^обнови\s+/i,
    /^проверь\s+/i,
    /^покажи\s+/i,
    /^собери\s+/i,
    /^создай\s+/i,
    /^переделай\s+/i,
    /^подготовь\s+/i
  ];

  leadingVerbPatterns.forEach((pattern) => {
    label = label.replace(pattern, "");
  });

  label = label
    .replace(/^страницу\s+/i, "страница ")
    .replace(/^сценарии\s+/i, "сценарии ")
    .replace(/^страница\s+ссылок$/i, "Страница ссылок")
    .replace(/^сценарии\s+мышления$/i, "Сценарии мышления");

  label = toTitleStart(label);

  if (label.length <= 28) {
    return label;
  }

  const shortened = label.slice(0, 28).replace(/\s+\S*$/, "").trim();
  return `${shortened || label.slice(0, 28).trim()}…`;
}

function formatThreadOptionLabel(thread) {
  const category = String(thread?.category || "").trim();
  const label = escapeThreadLabel(thread?.label || "").trim();
  const displayLabel = escapeThreadLabel(thread?.displayLabel || thread?.label || "").trim();
  const compactLabel = compactThreadLabel(label);

  if (category && compactLabel) {
    return `${formatCategoryLabel(category)} / ${compactLabel}`;
  }

  return displayLabel;
}

function formatRelativeMinutes(value) {
  const timestamp = Date.parse(String(value || "").trim());

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

        return [id, { id, label, displayLabel, category, messageCount }];
      })
      .filter(Boolean)
  ).values()].sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, "ru"));
}

function getThreadOptions() {
  const options = getAllThreadOptions();
  const selectedThreadIds = storage.selectedThreadIds;

  if (selectedThreadIds === null) {
    return options;
  }

  const selectedIds = new Set(
    (Array.isArray(selectedThreadIds) ? selectedThreadIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  return options.filter((option) => selectedIds.has(option.id));
}

function getVisibleThreadIds() {
  return new Set(getThreadOptions().map((option) => option.id).filter(Boolean));
}

function getActiveThreadId() {
  return String(commandThreadSelect.value || "").trim();
}

function clearCommandInputAutofill() {
  state.commandInputAutofill = {
    text: "",
    threadId: "",
    replyId: ""
  };
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

function renderCategoryList() {
  if (!threadCategoriesList || !threadCategoriesSummary) {
    return;
  }

  const categories = getAllCategories();
  threadCategoriesList.innerHTML = "";

  if (!categories.length) {
    threadCategoriesSummary.textContent = "Категории ещё не загружены.";
    threadCategoriesList.innerHTML = '<div class="command-empty">Список категорий появится после загрузки чатов.</div>';
    return;
  }

  const starredCount = categories.filter((category) => isCloudCodexCategory(category)).length;
  const activeCategories = [...new Set(
    (Array.isArray(state.activeThreadCategories) ? state.activeThreadCategories : [])
      .map((category) => String(category || "").trim())
      .filter(Boolean)
  )];
  threadCategoriesSummary.textContent = activeCategories.length
    ? `Фильтр: ${activeCategories.map((category) => formatCategoryLabel(category)).join(", ")}`
    : starredCount
      ? `${categories.length} всего, ${starredCount} со звездочкой.`
      : `${categories.length} всего.`;

  categories.forEach((category) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `thread-category-chip${isCloudCodexCategory(category) ? " thread-category-chip-starred" : ""}${activeCategories.includes(category) ? " thread-category-chip-active" : ""}`;
    item.textContent = formatCategoryLabel(category);
    item.addEventListener("click", () => {
      const nextCategories = new Set(activeCategories);

      if (nextCategories.has(category)) {
        nextCategories.delete(category);
      } else {
        nextCategories.add(category);
      }

      state.activeThreadCategories = [...nextCategories];
      renderCategoryList();
      renderCommandThreads();
      renderThreadSettingsList();
      renderThreadSettingsSummary();
    });
    threadCategoriesList.appendChild(item);
  });
}

function setThreadSettingsOpen(isOpen) {
  threadSettingsToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

  if (isOpen) {
    threadSettingsPanel.removeAttribute("hidden");
    renderCategoryList();
    renderThreadSettingsList();
    return;
  }

  threadSettingsPanel.setAttribute("hidden", "");
}

function renderThreadSettingsSummary() {
  const allOptions = getAllThreadOptions();
  const showAllMessages = storage.showAllMessages;
  const activeCategories = [...new Set(
    (Array.isArray(state.activeThreadCategories) ? state.activeThreadCategories : [])
      .map((category) => String(category || "").trim())
      .filter(Boolean)
  )];
  const selectedThreadIds = storage.selectedThreadIds;
  const query = String(threadSettingsSearch?.value || "").trim();
  const activeThreadLabel = getThreadDisplayLabel(getActiveThreadId(), "");

  if (!allOptions.length) {
    threadSettingsSummary.textContent = "Каталог чатов ещё не загружен.";
    return;
  }

  const filterParts = [];

  if (activeCategories.length) {
    filterParts.push(`категории: ${activeCategories.map((category) => formatCategoryLabel(category)).join(", ")}`);
  }

  if (query) {
    filterParts.push(`поиск: ${query}`);
  }

  const filterText = filterParts.length ? `Фильтр: ${filterParts.join(", ")}.` : "Фильтр не ограничивает список чатов.";
  const selectedThreadsText = selectedThreadIds === null
    ? "В поле Беседа Codex: все чаты."
    : `В поле Беседа Codex: ${selectedThreadIds.length} чатов.`;
  const timelineText = showAllMessages ? "Лента: все диалоги." : "Лента: текущая беседа.";
  const selectedText = activeThreadLabel ? `Выбран чат: ${activeThreadLabel}.` : "";

  threadSettingsSummary.textContent = [timelineText, filterText, selectedThreadsText, selectedText].filter(Boolean).join(" ");
}

function renderShowAllMessagesToggle() {
  if (!threadSettingsShowAll) {
    return;
  }

  threadSettingsShowAll.checked = storage.showAllMessages;
}

function formatMessageCount(count) {
  const value = Math.max(0, Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} сообщение`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${value} сообщения`;
  }

  return `${value} сообщений`;
}

function getThreadMessageCount(option) {
  const threadId = String(option?.id || "").trim();
  const staticCount = Number(state.threadMessageCounts?.[threadId]);

  if (Number.isFinite(staticCount) && staticCount >= 0) {
    return Math.floor(staticCount);
  }

  return Math.max(0, Number(option?.messageCount || 0));
}

function renderThreadSettingsList() {
  const allOptions = getAllThreadOptions();
  const query = String(threadSettingsSearch.value || "").trim().toLowerCase();
  const activeCategories = new Set(
    (Array.isArray(state.activeThreadCategories) ? state.activeThreadCategories : [])
      .map((category) => String(category || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const selectedThreadIds = storage.selectedThreadIds;
  const selectedIds = new Set(
    (Array.isArray(selectedThreadIds) ? selectedThreadIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const useAllByDefault = selectedThreadIds === null;
  const activeThreadId = getActiveThreadId();

  threadSettingsList.innerHTML = "";

  if (!allOptions.length) {
    threadSettingsList.innerHTML = '<div class="command-empty">Каталог чатов ещё пуст.</div>';
    return;
  }

  const items = allOptions.filter((option) => {
    const optionCategory = String(option.category || "").trim().toLowerCase();

    if (activeCategories.size && !activeCategories.has(optionCategory)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return option.displayLabel.toLowerCase().includes(query) || option.label.toLowerCase().includes(query);
  });

  if (!items.length) {
    threadSettingsList.innerHTML = '<div class="command-empty">Ничего не найдено.</div>';
    return;
  }

  items.forEach((option) => {
    const messageCount = getThreadMessageCount(option);
    const row = document.createElement("label");
    row.className = `thread-settings-item thread-settings-choice${option.id === activeThreadId ? " thread-settings-choice-active" : ""}`;
    row.innerHTML = `
      <input type="checkbox" value="${option.id}" ${selectedIds.has(option.id) ? "checked" : ""} />
      <span class="thread-settings-choice-copy">
        <span class="thread-settings-choice-title">${option.displayLabel}</span>
        <span class="thread-settings-choice-meta">${formatMessageCount(messageCount)}${option.id === activeThreadId ? " · выбран" : ""}</span>
      </span>
    `;
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox?.addEventListener("change", () => {
      const nextSelectedIds = new Set(useAllByDefault ? [] : selectedIds);

      if (checkbox.checked) {
        nextSelectedIds.add(option.id);
      } else {
        nextSelectedIds.delete(option.id);
      }

      storage.selectedThreadIds = [...nextSelectedIds];
      renderCommandThreads();
      renderThreadSettingsSummary();
      renderThreadSettingsList();
      renderCommands();
      setCommandStatusMessage(
        checkbox.checked
          ? `Чат добавлен в поле Беседа Codex: ${option.displayLabel}.`
          : `Чат убран из поля Беседа Codex: ${option.displayLabel}.`
      );
    });
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

function renderCommandThreads() {
  const options = getThreadOptions();
  const previousValue = commandThreadSelect.value;

  commandThreadSelect.innerHTML = "";

  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Нет доступных чатов";
    commandThreadSelect.appendChild(option);
    commandThreadSelect.disabled = true;
    renderThreadSettingsSummary();
    return;
  }

  options.forEach((thread) => {
    const option = document.createElement("option");
    option.value = thread.id;
    option.textContent = thread.displayLabel;
    commandThreadSelect.appendChild(option);
  });

  commandThreadSelect.disabled = false;
  commandThreadSelect.value = options.some((option) => option.id === previousValue)
    ? previousValue
    : options[0].id;
  renderThreadSettingsSummary();
  renderCommands();
}

function formatProgressStage(progressStage, status) {
  const stage = String(progressStage || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const dispatchMode = String(state.bridgeWatchdog?.dispatchMode || "").trim().toLowerCase();

  if (stage === "queued") {
    if (dispatchMode === "local-bridge") {
      return "Ждет локальный bridge";
    }

    return "Стоит в очереди";
  }
  if (stage === "dispatched" || normalizedStatus === "dispatched") return "Отправлено в Codex Cloud";
  if (stage === "claimed") return "Bridge забрал команду";
  if (stage === "preparing-input") return "Подготавливаю сообщение";
  if (stage === "sending-to-codex") return "Отправляю в Codex";
  if (stage === "waiting-for-codex") return "Codex думает";
  if (stage === "reading-codex-reply") return "Жду ответ Codex";
  if (stage === "saving-reply") return "Сохраняю ответ";
  if (stage === "processing" || normalizedStatus === "processing") {
    if (dispatchMode === "local-bridge") {
      return "Локальный bridge обрабатывает";
    }

    return "В обработке";
  }
  if (stage === "answered" || normalizedStatus === "answered") return "Ответ получен";
  if (stage === "failed" || normalizedStatus === "failed") return "Ошибка";
  if (stage === "acked") return "Появилось в Codex";
  if (normalizedStatus === "processing") {
    if (dispatchMode === "local-bridge") {
      return "Локальный bridge обрабатывает";
    }

    return "В обработке";
  }
  return "";
}

function getProgressStep(progressStage, status) {
  const stage = String(progressStage || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  if (stage === "queued" || normalizedStatus === "queued" || normalizedStatus === "pending") return 1;
  if (stage === "dispatched" || normalizedStatus === "dispatched" || stage === "claimed") return 2;
  if (stage === "preparing-input" || stage === "sending-to-codex") return 3;
  if (stage === "waiting-for-codex" || stage === "reading-codex-reply" || stage === "saving-reply" || normalizedStatus === "processing" || stage === "processing") return 4;
  if (normalizedStatus === "answered" || normalizedStatus === "acked" || normalizedStatus === "failed" || stage === "answered" || stage === "failed") return 5;
  return 0;
}

function hasEarlierActiveCommand(command) {
  const threadId = String(command?.threadId || "").trim();
  const createdAt = String(command?.createdAt || "").trim();

  if (!threadId || !createdAt) {
    return false;
  }

  return state.commands.some((entry) => {
    if (!entry || entry === command) {
      return false;
    }

    const status = String(entry.status || "").trim().toLowerCase();

    if (status !== "queued" && status !== "dispatched" && status !== "processing") {
      return false;
    }

    return String(entry.threadId || "").trim() === threadId
      && String(entry.createdAt || "").trim().localeCompare(createdAt) < 0;
  });
}

function formatCommandStage(command) {
  const progressLabel = formatProgressStage(command?.progressStage, command?.status);
  const dispatchMode = String(command?.dispatchMode || state.bridgeWatchdog?.dispatchMode || "").trim().toLowerCase();

  if (progressLabel) {
    return progressLabel;
  }

  const status = String(command?.status || "").trim().toLowerCase();

  if (status === "failed") return command?.errorMessage || "Ошибка";
  if (status === "answered" && command?.prUrl) return "PR готов";
  if (status === "answered") return "Ответ получен";
  if (status === "acked") return "Появилось в Codex";
  if ((status === "queued" || status === "pending") && hasEarlierActiveCommand(command)) {
    return "Жду предыдущий запрос в этой теме";
  }
  if (status === "dispatched") return "Отправлено в Codex Cloud";
  if (status === "processing") {
    return dispatchMode === "local-bridge" ? "Локальный bridge обрабатывает" : "В обработке";
  }
  if (status === "queued" || status === "pending") {
    if (dispatchMode === "local-bridge") {
      return "Ждет локальный bridge";
    }

    return "Стоит в очереди";
  }
  return status || "Неизвестно";
}

function getLocalBridgeFallbackMessage(command) {
  const dispatchMode = String(command?.dispatchMode || "").trim().toLowerCase();
  const errorMessage = String(command?.errorMessage || "").trim();

  if (dispatchMode !== "local-bridge" || !errorMessage) {
    return "";
  }

  if (!/falling back to local bridge|переведена на локальный bridge|локальный bridge/i.test(errorMessage)) {
    return "";
  }

  return "Cloud недоступен. Команда автоматически переведена на local bridge.";
}

function getCommandStageTone(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const stage = String(command?.progressStage || "").trim().toLowerCase();

  if (status === "failed" || stage === "failed") return "error";
  if (status === "answered" || status === "acked" || stage === "answered") return "success";
  if (
    status === "processing"
    || status === "dispatched"
    || stage === "claimed"
    || stage === "preparing-input"
    || stage === "sending-to-codex"
    || stage === "waiting-for-codex"
    || stage === "reading-codex-reply"
    || stage === "saving-reply"
    || stage === "processing"
  ) {
    return "processing";
  }

  if (status === "queued" || status === "pending" || stage === "queued") {
    return "queued";
  }

  return "neutral";
}

function setCommandStatusMessage(text, options = {}) {
  if (!commandStatus) {
    return;
  }

  const {
    tone = "neutral",
    source = "manual"
  } = options;

  const value = String(text || "").trim();
  commandStatus.textContent = value;
  commandStatus.dataset.source = source;
  commandStatus.dataset.tone = value ? tone : "";
  commandStatus.classList.toggle("form-status-chip", Boolean(value));
}

function clearAutoCommandStatusMessage() {
  if (!commandStatus || commandStatus.dataset.source !== "auto") {
    return;
  }

  setCommandStatusMessage("", { source: "auto" });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildTimelineSignature(timelineItems, options = {}) {
  const {
    activeThreadId = "",
    showAllMessages = false
  } = options;

  return JSON.stringify({
    activeThreadId,
    showAllMessages,
    items: timelineItems.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      role: entry.role,
      createdAt: entry.createdAt,
      threadId: entry.threadId,
      threadLabel: entry.threadLabel,
      textLength: String(entry.text || "").length,
      commandStatus: entry.command?.status || "",
      commandStage: entry.command?.progressStage || "",
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

function pruneExpiredAnswerState() {
  const now = Date.now();

  Object.entries(state.answerOpenUntil).forEach(([entryId, expiresAt]) => {
    if (!expiresAt || expiresAt <= now) {
      delete state.answerOpenUntil[entryId];
    }
  });
}

function scheduleAnswerAutoClose() {
  if (state.answerCloseTimer) {
    window.clearTimeout(state.answerCloseTimer);
    state.answerCloseTimer = null;
  }

  pruneExpiredAnswerState();

  const expirations = Object.values(state.answerOpenUntil)
    .map((value) => Number(value) || 0)
    .filter(Boolean)
    .sort((left, right) => left - right);

  if (!expirations.length) {
    return;
  }

  const nextExpiration = expirations[0];
  const delay = Math.max(nextExpiration - Date.now(), 0);

  state.answerCloseTimer = window.setTimeout(() => {
    pruneExpiredAnswerState();
    renderCommands();
  }, delay + 50);
}

function renderPhotoStatus() {
  const file = commandPhotoInput.files?.[0];

  if (!file) {
    commandPhotoStatus.textContent = "Фото не выбрано.";
    return;
  }

  commandPhotoStatus.textContent = `Фото: ${file.name}`;
}

async function readFileAsDataUrl(file) {
  const inferContentType = () => {
    const declared = String(file?.type || "").trim().toLowerCase();

    if (declared.startsWith("image/")) {
      return declared;
    }

    const name = String(file?.name || "").trim().toLowerCase();

    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    if (name.endsWith(".gif")) return "image/gif";
    if (name.endsWith(".heic")) return "image/heic";
    if (name.endsWith(".heif")) return "image/heif";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    return "";
  };

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const inferredContentType = inferContentType();

      if (result.startsWith("data:image/")) {
        resolve(result);
        return;
      }

      if (result.startsWith("data:") && inferredContentType) {
        resolve(result.replace(/^data:[^;]+;/i, `data:${inferredContentType};`));
        return;
      }

      reject(new Error("Не удалось прочитать фото."));
    };

    reader.onerror = () => {
      reject(new Error("Не удалось прочитать фото."));
    };

    reader.readAsDataURL(file);
  });
}

function inferDataUrlContentType(dataUrl) {
  const match = /^data:([^;]+);base64,/i.exec(String(dataUrl || "").trim());
  return match ? String(match[1] || "").trim().toLowerCase() : "";
}

function estimateDataUrlSize(dataUrl) {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(String(dataUrl || "").trim());

  if (!match) {
    return 0;
  }

  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : (base64.endsWith("=") ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото."));
    image.src = dataUrl;
  });
}

async function optimizePhotoPayload(file) {
  if (!file) {
    return null;
  }

  if (file.size > MAX_PHOTO_FILE_SIZE) {
    throw new Error("Фото слишком большое. Выберите изображение до 4.5 MB.");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const originalContentType = inferDataUrlContentType(originalDataUrl) || String(file.type || "image/jpeg").toLowerCase();

  if (
    file.size <= MAX_PHOTO_UPLOAD_BYTES
    && /^(image\/jpeg|image\/jpg|image\/png|image\/webp|image\/gif|image\/heic|image\/heif)$/i.test(originalContentType)
  ) {
    return {
      fileName: file.name,
      contentType: originalContentType === "image/jpg" ? "image/jpeg" : originalContentType,
      size: file.size,
      dataUrl: originalDataUrl
    };
  }

  const image = await loadImageElement(originalDataUrl);
  const longestSide = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
  const scale = longestSide > MAX_PHOTO_DIMENSION ? MAX_PHOTO_DIMENSION / longestSide : 1;
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return {
      fileName: file.name,
      contentType: originalContentType === "image/jpg" ? "image/jpeg" : originalContentType,
      size: file.size,
      dataUrl: originalDataUrl
    };
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  let dataUrl = originalDataUrl;

  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    dataUrl = originalDataUrl;
  }

  return {
    fileName: file.name.replace(/\.[a-z0-9]+$/i, ".jpg"),
    contentType: inferDataUrlContentType(dataUrl) || "image/jpeg",
    size: estimateDataUrlSize(dataUrl),
    dataUrl
  };
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
        ${hasPhoto ? '<div class="command-photo-note">К сообщению приложено фото.</div>' : ""}
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

function getLatestTrackedCommand() {
  return [...state.commands]
    .filter((command) => ["queued", "dispatched", "processing"].includes(String(command?.status || "").trim().toLowerCase()))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0] || null;
}

function renderSubmitProgress() {
  if (!submitProgress) {
    return;
  }

  const dots = [...submitProgress.querySelectorAll(".submit-progress-dot")];
  const command = getLatestTrackedCommand();
  const currentStep = getProgressStep(command?.progressStage, command?.status);
  const tone = command ? getCommandStageTone(command) : "neutral";

  dots.forEach((dot, index) => {
    const step = index + 1;
    dot.classList.toggle("is-active", currentStep > 0 && step <= currentStep);
    dot.classList.toggle("is-current", currentStep > 0 && step === currentStep && !["acked", "answered", "failed"].includes(String(command?.status || "").trim().toLowerCase()));
  });

  submitProgress.dataset.tone = tone;

  submitProgress.setAttribute(
    "aria-label",
    `Стадия обработки запроса: ${command ? formatCommandStage(command) : "Нет активного запроса"}`
  );
}

function isCloudMisconfigured(status) {
  const mode = String(status?.dispatchMode || "").trim().toLowerCase();
  const error = String(status?.lastError || "").trim().toLowerCase();

  return mode !== "slack-codex-cloud" && error.includes("missing slack secrets");
}

function renderBridgeStatus() {
  if (!bridgeStatusText) {
    return;
  }

  if (!state.bridgeWatchdog) {
    bridgeStatusText.textContent = "Проверяю режим исполнения Codex…";
    return;
  }

  const pending = state.commands.find((command) => ["queued", "dispatched", "processing", "pending"].includes(String(command?.status || "").trim().toLowerCase()));
  const latestAnswered = [...state.commands]
    .filter((command) => ["answered", "acked"].includes(String(command?.status || "").trim().toLowerCase()))
    .sort((left, right) => String(right.completedAt || right.ackedAt || right.createdAt || "").localeCompare(String(left.completedAt || left.ackedAt || left.createdAt || "")))[0];
  const dispatchMode = String(state.bridgeWatchdog?.dispatchMode || "").trim().toLowerCase();
  const cloudMisconfigured = isCloudMisconfigured(state.bridgeWatchdog);

  if (pending) {
    bridgeStatusText.textContent = dispatchMode === "slack-codex-cloud"
      ? "Codex Cloud обрабатывает очередь через Slack."
      : (cloudMisconfigured
        ? "Cloud не настроен: в Pages не заданы Slack secrets. Текущая задача ждет или уже обрабатывается локальным bridge."
        : "Локальный bridge обрабатывает очередь.");
    return;
  }

  if (latestAnswered) {
    bridgeStatusText.textContent = dispatchMode === "slack-codex-cloud"
      ? `Codex Cloud активен. Последний ответ получен ${formatDate(latestAnswered.completedAt || latestAnswered.ackedAt || latestAnswered.createdAt)}.`
      : (cloudMisconfigured
        ? `Cloud не настроен: видны только результаты локального bridge. Последний локальный ответ получен ${formatDate(latestAnswered.ackedAt || latestAnswered.createdAt)}.`
        : `Локальный bridge активен. Последний ответ получен ${formatDate(latestAnswered.ackedAt || latestAnswered.createdAt)}.`);
    return;
  }

  bridgeStatusText.textContent = dispatchMode === "slack-codex-cloud"
    ? "Codex Cloud настроен. Прод-исполнение идёт через Slack, локальный bridge только запасной."
    : (cloudMisconfigured
      ? "Cloud не настроен: добавьте Slack secrets в Pages, иначе приложение работает только пока доступен локальный bridge."
      : "Локальный bridge готов. Новые команды будут отправляться в Codex.");
}

function renderBridgeWatchdog() {
  if (!bridgeWatchdogText) {
    return;
  }

  const status = state.bridgeWatchdog;

  if (!status) {
    bridgeWatchdogText.textContent = "Watchdog: нет данных о текущем исполнителе.";
    return;
  }

  const mode = String(status.dispatchMode || "").trim().toLowerCase();
  const label = mode === "slack-codex-cloud" ? "cloud" : "local";
  const stateLabel = status.bridgeOnline
    ? (status.state === "running"
      ? (label === "cloud" ? "Cloud online, обрабатывает" : "Local bridge online, обрабатывает")
      : (label === "cloud" ? "Cloud online" : "Local bridge online"))
    : (label === "cloud" ? "Cloud offline" : "Local bridge offline");
  const parts = [stateLabel];

  if (status.lastRunAt) {
    parts.push(`последний запуск ${formatRelativeMinutes(status.lastRunAt)}`);
  }

  if (status.lastDispatchAt) {
    parts.push(`последняя отправка ${formatRelativeMinutes(status.lastDispatchAt)}`);
  }

  parts.push(`в очереди ${status.pendingCount || 0}`);

  if (status.oldestPendingAt) {
    parts.push(`самая старая ${formatRelativeMinutes(status.oldestPendingAt)}`);
  }

  if (status.lastDeliveredCount) {
    parts.push(`последняя доставка ${status.lastDeliveredCount}`);
  }

  if (status.lastError) {
    parts.push(`ошибка: ${status.lastError}`);
  }

  bridgeWatchdogText.textContent = `Watchdog: ${parts.join(" · ")}`;
}

async function loadCommands(options = {}) {
  const { render = true } = options;

  if (await ensureLatestClient()) {
    return;
  }

  const url = new URL("/api/commands", window.location.origin);
  url.searchParams.set("scope", "public");
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
  state.commands = data.commands || [];
  if (!threadSettingsPanel.hasAttribute("hidden")) {
    renderThreadSettingsList();
  }
  if (render) {
    renderCommands();
  }
  renderBridgeStatus();
  renderSubmitProgress();
}

async function loadMessages(options = {}) {
  const { render = true } = options;

  if (state.hardReloading) {
    return;
  }

  const url = new URL("/api/messages", window.location.origin);
  url.searchParams.set("scope", "public");
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
  const previousAssistantIds = new Set(
    state.messages
      .filter((message) => message?.role === "assistant")
      .map((message) => String(message.id || "").trim())
      .filter(Boolean)
  );
  state.messages = data.messages || [];
  const hasNewAssistantReply = state.hasLoadedMessagesOnce && state.messages.some((message) =>
    message?.role === "assistant" && !previousAssistantIds.has(String(message.id || "").trim())
  );

  if (hasNewAssistantReply) {
    playReplySound();
  }

  state.hasLoadedMessagesOnce = true;

  if (!threadSettingsPanel.hasAttribute("hidden")) {
    renderThreadSettingsList();
  }

  if (render) {
    renderCommands();
  }
}

async function loadThreads() {
  if (state.hardReloading) {
    return;
  }

  const url = new URL("/api/threads", window.location.origin);
  url.searchParams.set("clientId", storage.clientId);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load threads: ${response.status}`);
  }

  const data = await response.json();
  state.threads = Array.isArray(data.threads) ? data.threads : [];

  const selectedThreadIds = storage.selectedThreadIds;

  if (selectedThreadIds !== null) {
    const existingIds = new Set(
      state.threads
        .map((thread) => String(thread?.id || "").trim())
        .filter(Boolean)
    );

    storage.selectedThreadIds = selectedThreadIds.filter((id) => existingIds.has(String(id || "").trim()));
  }

  if (state.activeThreadCategories.length) {
    const existingCategories = new Set(
      state.threads
        .map((thread) => String(thread?.category || "").trim())
        .filter(Boolean)
    );

    state.activeThreadCategories = state.activeThreadCategories.filter((category) => existingCategories.has(category));
  }

  renderCommandThreads();
  renderCategoryList();
  renderThreadSettingsList();
}

async function loadThreadCounts() {
  if (state.hardReloading) {
    return;
  }

  const url = new URL("/thread-counts.json", window.location.origin);
  url.searchParams.set("v", BUILD_VERSION);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load thread counts: ${response.status}`);
  }

  const data = await response.json();
  state.threadMessageCounts = data && typeof data === "object" ? data : {};

  if (!threadSettingsPanel.hasAttribute("hidden")) {
    renderThreadSettingsList();
  }
}

async function loadBridgeWatchdog() {
  if (state.hardReloading) {
    return;
  }

  const url = new URL("/api/status", window.location.origin);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load bridge status: ${response.status}`);
  }

  const data = await response.json();
  state.bridgeWatchdog = data.status || null;
  renderBridgeWatchdog();
}

function getRejectedResult(results, index) {
  return results[index]?.status === "rejected" ? results[index].reason : null;
}

function hasConversationSnapshot() {
  return state.commands.length > 0 || state.messages.length > 0;
}

function hasActiveCommands() {
  return state.commands.some((command) => ["queued", "dispatched", "processing"].includes(String(command?.status || "").trim().toLowerCase()));
}

async function refreshSiteData(options = {}) {
  const { includeThreads = false, silent = false, forceRender = false } = options;
  const jobs = [loadCommands({ render: false }), loadMessages({ render: false }), loadBridgeWatchdog()];

  if (includeThreads) {
    jobs.push(loadThreads());
    jobs.push(loadThreadCounts());
  }

  const results = await Promise.allSettled(jobs);

  if (state.hardReloading) {
    return results;
  }

  const commandsError = getRejectedResult(results, 0);
  const messagesError = getRejectedResult(results, 1);
  const hasCachedData = hasConversationSnapshot();

  if (!silent) {
    if ((commandsError || messagesError) && hasCachedData) {
      setCommandStatusMessage("");
    } else if (commandsError && messagesError) {
      setCommandStatusMessage("Не удалось загрузить переписку.", { tone: "error" });
    } else if (commandsError) {
      setCommandStatusMessage("Не удалось обновить очередь.", { tone: "error" });
    } else if (messagesError) {
      setCommandStatusMessage("Не удалось загрузить ответы Codex.", { tone: "error" });
    } else if (
      commandStatus.textContent === "Не удалось загрузить переписку."
      || commandStatus.textContent === "Не удалось обновить очередь."
      || commandStatus.textContent === "Не удалось загрузить ответы Codex."
    ) {
      setCommandStatusMessage("");
    }
  }

  if (forceRender) {
    state.lastRenderedTimelineSignature = "";
  }

  renderCommands();
  renderBridgeStatus();
  renderSubmitProgress();
  ensureCommandPolling();

  return results;
}

function ensureCommandPolling() {
  const nextInterval = hasActiveCommands() ? FAST_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;

  if (state.commandPoller && state.commandPollerInterval === nextInterval) {
    return;
  }

  if (state.commandPoller) {
    window.clearInterval(state.commandPoller);
  }

  state.commandPoller = window.setInterval(() => {
    refreshSiteData({ silent: true }).catch(() => {});
  }, nextInterval);
  state.commandPollerInterval = nextInterval;
}

function playReplySound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(1240, context.currentTime + 0.16);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.34);
  oscillator.addEventListener("ended", () => {
    context.close().catch(() => {});
  });
}

async function submitCommand(event) {
  event.preventDefault();
  setCommandStatusMessage("");

  const text = String(commandInput.value || "").trim();
  const photoFile = commandPhotoInput.files?.[0] || null;

  if (!text && !photoFile) {
    setCommandStatusMessage("Нужно ввести сообщение или выбрать фото.", { tone: "error" });
    return;
  }

  const selected = getThreadOptions().find((option) => option.id === commandThreadSelect.value);

  if (!selected) {
    setCommandStatusMessage("Нет доступного чата Codex.", { tone: "error" });
    return;
  }

  try {
    const photo = photoFile ? await optimizePhotoPayload(photoFile) : null;

    const response = await fetch("/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text,
        clientId: storage.clientId,
        threadId: selected.id,
        threadLabel: selected.label,
        photo
      })
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const message = String(result?.error || "").trim();
      throw new Error(message || `Не удалось отправить команду (HTTP ${response.status}).`);
    }

    commandInput.value = "";
    clearCommandInputAutofill();
    commandPhotoInput.value = "";
    renderPhotoStatus();
    renderSubmitProgress();
    await refreshSiteData({ includeThreads: true, silent: true });
    setCommandStatusMessage("");
  } catch (error) {
    const message = String(error?.message || "").trim();
    setCommandStatusMessage(
      message === "The string did not match the expected pattern."
        ? "Не удалось подготовить или отправить фото. Чаще всего это слишком большой файл или временная ошибка API."
        : (message || "Не удалось отправить команду."),
      { tone: "error" }
    );
  }
}

function bootApp() {
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
    !commandStatus ||
    !exportDateFrom ||
    !exportDateTo ||
    !exportDataset ||
    !exportButton
  ) {
    console.error("Codex Links: missing required DOM nodes during boot.");
    return;
  }

  exportDateFrom.value = getDefaultExportFromDate();
  exportDateTo.value = getDefaultExportToDate();
  exportButton.addEventListener("click", () => {
    exportDataForPeriod().catch(() => {});
  });

  refreshButton.addEventListener("click", async () => {
    if (await ensureLatestClient()) {
      return;
    }

    await refreshSiteData({ includeThreads: true, forceRender: true });
  });

  threadSettingsToggle.addEventListener("click", () => {
    const willOpen = threadSettingsPanel.hasAttribute("hidden");
    setThreadSettingsOpen(willOpen);

    if (willOpen && !state.threads.length) {
      loadThreads().catch(() => {
        renderCategoryList();
        renderThreadSettingsList();
      });
    }
  });

  threadSettingsShowAll?.addEventListener("change", () => {
    storage.showAllMessages = threadSettingsShowAll.checked;
    renderThreadSettingsSummary();
    renderCommands();
  });

  threadSettingsSearch.addEventListener("input", () => {
    renderThreadSettingsList();
    renderThreadSettingsSummary();
  });

  threadSettingsSave.addEventListener("click", () => {
    setCommandStatusMessage("Меню закрыто.");
    setThreadSettingsOpen(false);
  });

  threadSettingsSelectAll.addEventListener("click", () => {
    state.activeThreadCategories = [];
    storage.selectedThreadIds = null;
    threadSettingsSearch.value = "";
    renderCategoryList();
    renderCommandThreads();
    renderThreadSettingsList();
    renderThreadSettingsSummary();
    setCommandStatusMessage("В поле Беседа Codex снова показаны все чаты.");
  });

  threadSettingsClear.addEventListener("click", () => {
    state.activeThreadCategories = [];
    threadSettingsSearch.value = "";
    renderCategoryList();
    renderCommandThreads();
    renderThreadSettingsList();
    renderThreadSettingsSummary();
    setCommandStatusMessage("Фильтр меню сброшен.");
  });

  commandThreadSelect.addEventListener("change", () => {
    renderThreadSettingsSummary();
    renderThreadSettingsList();
    renderCommands();
  });
  commandInput.addEventListener("input", () => {
    if (String(commandInput.value || "") !== String(state.commandInputAutofill.text || "")) {
      clearCommandInputAutofill();
    }
  });
  commandPhotoInput.addEventListener("change", renderPhotoStatus);
  commandForm.addEventListener("submit", submitCommand);

  refreshSiteData({ includeThreads: true })
    .then(() => {
      renderShowAllMessagesToggle();
      ensureCommandPolling();
    })
    .catch((error) => {
      setCommandStatusMessage(String(error?.message || "Не удалось запустить интерфейс."), { tone: "error" });
    });

  loadThreadCounts().catch(() => {});

  renderShowAllMessagesToggle();
}

bootApp();
