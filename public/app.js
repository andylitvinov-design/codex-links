const state = {
  commands: [],
  messages: [],
  threads: [],
  bridgeWatchdog: null,
  commandPoller: null,
  lastRenderedTimelineSize: 0,
  answerOpenUntil: {},
  answerCloseTimer: null
};

const sharedCookieDomain = (
  window.location.hostname === "codex-links.pages.dev" ||
  window.location.hostname.endsWith(".codex-links.pages.dev")
)
  ? ".codex-links.pages.dev"
  : null;

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
    let value = localStorage.getItem("codex-links-client-id");

    if (!value) {
      value = readCookie("codex-links-client-id");
    }

    if (!value) {
      value = crypto.randomUUID();
    }

    localStorage.setItem("codex-links-client-id", value);
    writeCookie("codex-links-client-id", value);
    return value;
  },

  get selectedThreadIds() {
    let raw = localStorage.getItem("codex-links-selected-thread-ids");

    if (raw === null) {
      raw = readCookie("codex-links-selected-thread-ids") || null;
    }

    if (raw === null) {
      return null;
    }

    try {
      const value = JSON.parse(raw || "[]");
      localStorage.setItem("codex-links-selected-thread-ids", JSON.stringify(value));
      writeCookie("codex-links-selected-thread-ids", JSON.stringify(value));
      return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return null;
    }
  },

  set selectedThreadIds(value) {
    if (value === null) {
      localStorage.removeItem("codex-links-selected-thread-ids");
      removeCookie("codex-links-selected-thread-ids");
      return;
    }

    const normalized = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    const serialized = JSON.stringify(normalized);
    localStorage.setItem("codex-links-selected-thread-ids", serialized);
    writeCookie("codex-links-selected-thread-ids", serialized);
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
const threadSettingsToggle = document.querySelector("#thread-settings-toggle");
const threadSettingsSummary = document.querySelector("#thread-settings-summary");
const threadSettingsPanel = document.querySelector("#thread-settings-panel");
const threadSettingsSearch = document.querySelector("#thread-settings-search");
const threadSettingsList = document.querySelector("#thread-settings-list");
const threadSettingsSave = document.querySelector("#thread-settings-save");
const threadSettingsSelectAll = document.querySelector("#thread-settings-select-all");
const threadSettingsClear = document.querySelector("#thread-settings-clear");

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

function getAllThreadOptions() {
  return [...new Map(
    state.threads
      .map((thread) => {
        const id = String(thread?.id || "").trim();
        const label = escapeThreadLabel(thread?.label || "").trim();
        const displayLabel = escapeThreadLabel(thread?.displayLabel || thread?.label || "").trim();

        if (!id || !label || !displayLabel) {
          return null;
        }

        return [id, { id, label, displayLabel }];
      })
      .filter(Boolean)
  ).values()].sort((left, right) => left.displayLabel.localeCompare(right.displayLabel, "ru"));
}

function getThreadOptions() {
  const options = getAllThreadOptions();
  const storedSelection = storage.selectedThreadIds;
  const linksThread = options.find((option) => option.id === "links");

  if (storedSelection === null) {
    return linksThread ? [linksThread] : options;
  }

  const selectedIds = new Set(storedSelection);
  const filtered = options.filter((option) => selectedIds.has(option.id));

  if (filtered.length) {
    return filtered;
  }

  return linksThread ? [linksThread] : options;
}

function getVisibleThreadIds() {
  return new Set(getThreadOptions().map((option) => option.id).filter(Boolean));
}

function getActiveThreadId() {
  return String(commandThreadSelect.value || "").trim();
}

function getThreadDisplayLabel(threadId, fallbackLabel = "") {
  const normalizedId = String(threadId || "").trim();

  if (!normalizedId) {
    return fallbackLabel;
  }

  const match = state.threads.find((thread) => String(thread?.id || "").trim() === normalizedId);
  return match?.displayLabel || match?.label || fallbackLabel;
}

function setThreadSettingsOpen(isOpen) {
  threadSettingsToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

  if (isOpen) {
    threadSettingsPanel.removeAttribute("hidden");
    renderThreadSettingsList();
    return;
  }

  threadSettingsPanel.setAttribute("hidden", "");
}

function renderThreadSettingsSummary() {
  const allOptions = getAllThreadOptions();
  const visibleOptions = getThreadOptions();

  if (!allOptions.length) {
    threadSettingsSummary.textContent = "Каталог чатов ещё не загружен.";
    return;
  }

  if (storage.selectedThreadIds === null) {
    if (visibleOptions.length === 1 && visibleOptions[0]?.id === "links") {
      threadSettingsSummary.textContent = "По умолчанию показывается чат Links.";
      return;
    }

    threadSettingsSummary.textContent = `Показываются все чаты: ${allOptions.length}.`;
    return;
  }

  if (!visibleOptions.length) {
    threadSettingsSummary.textContent = "В меню нет выбранных чатов.";
    return;
  }

  threadSettingsSummary.textContent = `В меню выбрано чатов: ${visibleOptions.length} из ${allOptions.length}.`;
}

function renderThreadSettingsList() {
  const allOptions = getAllThreadOptions();
  const storedSelection = storage.selectedThreadIds;
  const selectedIds = new Set(storedSelection || []);
  const useAllAsSelected = storedSelection === null;
  const query = String(threadSettingsSearch.value || "").trim().toLowerCase();

  threadSettingsList.innerHTML = "";

  if (!allOptions.length) {
    threadSettingsList.innerHTML = '<div class="command-empty">Каталог чатов ещё пуст.</div>';
    return;
  }

  const items = allOptions.filter((option) => {
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
    const row = document.createElement("label");
    row.className = "thread-settings-item";
    row.innerHTML = `
      <input type="checkbox" value="${option.id}" ${(useAllAsSelected || selectedIds.has(option.id)) ? "checked" : ""} />
      <span>${option.displayLabel}</span>
    `;
    threadSettingsList.appendChild(row);
  });
}

function collectCheckedThreadIds() {
  return [...threadSettingsList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
}

function saveThreadSelection(ids) {
  storage.selectedThreadIds = ids;
  renderCommandThreads();
  renderThreadSettingsList();
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

function formatCommandStage(status) {
  if (status === "acked") return "Появилось в Codex";
  if (status === "pending") return "Ждёт отправки в Codex";
  return status || "Неизвестно";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";

    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }

    return `data:${file.type || "image/jpeg"};base64,${window.btoa(binary)}`;
  } catch {
    throw new Error("Не удалось прочитать фото.");
  }
}

function renderCommands() {
  pruneExpiredAnswerState();
  commandTimeline.innerHTML = "";
  const activeThreadId = getActiveThreadId();

  const items = [
    ...state.commands.map((command) => ({
      id: `command:${command.id}`,
      role: "user",
      text: command.text || "Сообщение без текста",
      createdAt: command.createdAt,
      threadId: command.threadId || "",
      threadLabel: command.threadLabel || "",
      status: command.status
    })),
    ...state.messages.map((message) => ({
      id: `message:${message.id}`,
      role: "assistant",
      text: message.text || "",
      createdAt: message.createdAt,
      threadId: message.threadId || "",
      threadLabel: message.threadLabel || ""
    }))
  ]
    .filter((entry) => !activeThreadId || entry.threadId === activeThreadId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));

  if (!items.length) {
    commandTimeline.innerHTML = '<div class="command-empty">Здесь будут только ваши сообщения и их доставка.</div>';
    state.lastRenderedTimelineSize = 0;
    return;
  }

  items.forEach((entry) => {
      const element = document.createElement("article");
      element.className = `command-item ${entry.role === "assistant" ? "command-item-assistant" : "command-item-user"}`;
      const threadMeta = activeThreadId
        ? ""
        : `<span>${escapeHtml(getThreadDisplayLabel(entry.threadId, entry.threadLabel || ""))}</span>`;
      const body = entry.role === "assistant"
        ? `
        <details class="command-answer">
          <summary>Ответ Codex</summary>
          <p>${escapeHtml(entry.text)}</p>
        </details>
      `
        : `<p>${escapeHtml(entry.text)}</p>`;
      element.innerHTML = `
        <div class="command-item-top">
          <strong>${entry.role === "assistant" ? "Codex" : "Вы"}</strong>
          <time>${formatDate(entry.createdAt)}</time>
        </div>
        ${body}
        <div class="command-item-top">
          <span>${entry.role === "assistant" ? "Ответ получен" : formatCommandStage(entry.status)}</span>
          ${threadMeta}
        </div>
      `;

      if (entry.role === "assistant") {
        const details = element.querySelector(".command-answer");

        if (details) {
          details.dataset.entryId = entry.id;

          if (state.answerOpenUntil[entry.id] && state.answerOpenUntil[entry.id] > Date.now()) {
            details.open = true;
          }

          details.addEventListener("toggle", () => {
            if (details.open) {
              state.answerOpenUntil[entry.id] = Date.now() + 2 * 60 * 1000;
            } else {
              delete state.answerOpenUntil[entry.id];
            }

            scheduleAnswerAutoClose();
          });
        }
      }

      commandTimeline.appendChild(element);
    });

  if (items.length !== state.lastRenderedTimelineSize) {
    commandTimeline.scrollTop = 0;
    state.lastRenderedTimelineSize = items.length;
  }

  scheduleAnswerAutoClose();
}

function renderBridgeStatus() {
  const pending = state.commands.find((command) => command.status === "pending");

  if (pending) {
    bridgeStatusText.textContent = "Есть команда, которая ещё ждёт доставки в Codex.";
    return;
  }

  const acked = [...state.commands]
    .filter((command) => command.status === "acked")
    .sort((left, right) => String(right.ackedAt || "").localeCompare(String(left.ackedAt || "")))[0];

  if (acked) {
    bridgeStatusText.textContent = `Мост работает. Последняя команда доставлена ${formatDate(acked.ackedAt || acked.createdAt)}.`;
    return;
  }

  bridgeStatusText.textContent = "Мост готов. Новые команды будут отправляться в Codex.";
}

function renderBridgeWatchdog() {
  const status = state.bridgeWatchdog;

  if (!status) {
    bridgeWatchdogText.textContent = "Watchdog: нет данных о bridge.";
    return;
  }

  const stateLabel = status.bridgeOnline
    ? (status.state === "running" ? "bridge online, обрабатывает" : "bridge online")
    : "bridge offline";
  const parts = [stateLabel];

  if (status.lastRunAt) {
    parts.push(`last run ${formatRelativeMinutes(status.lastRunAt)}`);
  }

  parts.push(`pending ${status.pendingCount || 0}`);

  if (status.oldestPendingAt) {
    parts.push(`oldest ${formatRelativeMinutes(status.oldestPendingAt)}`);
  }

  if (status.lastDeliveredCount) {
    parts.push(`last batch ${status.lastDeliveredCount}`);
  }

  if (status.lastError) {
    parts.push(`error: ${status.lastError}`);
  }

  bridgeWatchdogText.textContent = `Watchdog: ${parts.join(" · ")}`;
}

async function loadCommands() {
  const url = new URL("/api/commands", window.location.origin);
  url.searchParams.set("scope", "recent");
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
  renderCommands();
  renderBridgeStatus();
}

async function loadMessages() {
  const url = new URL("/api/messages", window.location.origin);
  url.searchParams.set("scope", "recent");
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
  state.messages = data.messages || [];
  renderCommands();
}

async function loadThreads() {
  const url = new URL("/api/threads", window.location.origin);
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
  renderCommandThreads();
  renderThreadSettingsList();
}

async function loadBridgeWatchdog() {
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

function ensureCommandPolling() {
  if (state.commandPoller) {
    window.clearInterval(state.commandPoller);
  }

  state.commandPoller = window.setInterval(() => {
    Promise.all([loadCommands(), loadMessages(), loadBridgeWatchdog()]).catch(() => {});
  }, 15000);
}

async function submitCommand(event) {
  event.preventDefault();
  commandStatus.textContent = "Отправляю…";

  const text = String(commandInput.value || "").trim();
  const photoFile = commandPhotoInput.files?.[0] || null;

  if (!text && !photoFile) {
    commandStatus.textContent = "Нужно ввести сообщение или выбрать фото.";
    return;
  }

  const selected = getThreadOptions().find((option) => option.id === commandThreadSelect.value);

  if (!selected) {
    commandStatus.textContent = "Нет доступного чата Codex.";
    return;
  }

  try {
    const photo = photoFile
      ? {
          fileName: photoFile.name,
          contentType: photoFile.type || "image/jpeg",
          size: photoFile.size,
          dataUrl: await readFileAsDataUrl(photoFile)
        }
      : null;

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

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Не удалось отправить команду.");
    }

    commandInput.value = "";
    commandPhotoInput.value = "";
    renderPhotoStatus();
    commandStatus.textContent = "Команда принята.";
    await Promise.all([loadCommands(), loadMessages(), loadThreads()]);
  } catch (error) {
    commandStatus.textContent = error.message;
  }
}

refreshButton.addEventListener("click", async () => {
  await Promise.all([loadCommands(), loadMessages(), loadThreads(), loadBridgeWatchdog()]);
});

threadSettingsToggle.addEventListener("click", () => {
  setThreadSettingsOpen(threadSettingsPanel.hasAttribute("hidden"));
});

threadSettingsSearch.addEventListener("input", renderThreadSettingsList);

threadSettingsSave.addEventListener("click", () => {
  saveThreadSelection(collectCheckedThreadIds());
  commandStatus.textContent = "Настройки меню сохранены.";
  setThreadSettingsOpen(false);
});

threadSettingsSelectAll.addEventListener("click", () => {
  saveThreadSelection(getAllThreadOptions().map((option) => option.id));
  commandStatus.textContent = "В меню добавлены все чаты.";
  setThreadSettingsOpen(false);
});

threadSettingsClear.addEventListener("click", () => {
  saveThreadSelection([]);
  commandStatus.textContent = "Все чаты сняты из меню.";
  setThreadSettingsOpen(false);
});

commandThreadSelect.addEventListener("change", renderCommands);
commandPhotoInput.addEventListener("change", renderPhotoStatus);
commandForm.addEventListener("submit", submitCommand);

Promise.all([loadCommands(), loadMessages(), loadBridgeWatchdog()])
  .then(() => {
    ensureCommandPolling();
  })
  .catch(() => {
    commandStatus.textContent = "Не удалось загрузить переписку.";
  });

loadThreads().catch(() => {
  renderCommandThreads();
});
