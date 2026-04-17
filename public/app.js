const state = {
  commands: [],
  messages: [],
  threads: [],
  cloudRepos: [],
  threadMessageCounts: {},
  activeThreadCategories: [],
  activeTimelineTab: "dialog",
  dispatchMode: "bridge",
  bridgeWatchdog: null,
  commandPoller: null,
  commandPollerInterval: 0,
  lastRenderedTimelineSize: 0,
  lastRenderedTimelineSignature: "",
  answerOpenUntil: {},
  answerCloseTimer: null,
  hardReloading: false,
  hasLoadedMessagesOnce: false,
  audioUnlocked: false
};

const BUILD_VERSION = "20260417-2358";
const FAST_POLL_INTERVAL_MS = 3500;
const IDLE_POLL_INTERVAL_MS = 12000;
const MAX_PHOTO_FILE_SIZE = 4_500_000;
const MAX_PHOTO_UPLOAD_BYTES = 1_600_000;
const MAX_PHOTO_DIMENSION = 1600;

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
  },

  get activeTimelineTab() {
    const raw = safeLocalStorageGet("codex-links-active-timeline-tab") ?? readCookie("codex-links-active-timeline-tab");
    return raw === "notifications" ? "notifications" : "dialog";
  },

  set activeTimelineTab(value) {
    const normalized = value === "notifications" ? "notifications" : "dialog";
    safeLocalStorageSet("codex-links-active-timeline-tab", normalized);
    writeCookie("codex-links-active-timeline-tab", normalized);
  },

  get dispatchModePreference() {
    const raw = safeLocalStorageGet("codex-links-dispatch-mode") ?? readCookie("codex-links-dispatch-mode");
    return raw === "cloud" ? "cloud" : "bridge";
  },

  set dispatchModePreference(value) {
    const normalized = value === "cloud" ? "cloud" : "bridge";
    safeLocalStorageSet("codex-links-dispatch-mode", normalized);
    writeCookie("codex-links-dispatch-mode", normalized);
  },

  get selectedCloudRepoId() {
    const raw = safeLocalStorageGet("codex-links-selected-cloud-repo") ?? readCookie("codex-links-selected-cloud-repo");
    return String(raw || "").trim().toLowerCase();
  },

  set selectedCloudRepoId(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (!normalized) {
      safeLocalStorageRemove("codex-links-selected-cloud-repo");
      removeCookie("codex-links-selected-cloud-repo");
      return;
    }

    safeLocalStorageSet("codex-links-selected-cloud-repo", normalized);
    writeCookie("codex-links-selected-cloud-repo", normalized);
  },

  get activeBridgeThreadId() {
    const raw = safeLocalStorageGet("codex-links-active-bridge-thread") ?? readCookie("codex-links-active-bridge-thread");
    return String(raw || "").trim();
  },

  set activeBridgeThreadId(value) {
    const normalized = String(value || "").trim();

    if (!normalized) {
      safeLocalStorageRemove("codex-links-active-bridge-thread");
      removeCookie("codex-links-active-bridge-thread");
      return;
    }

    safeLocalStorageSet("codex-links-active-bridge-thread", normalized);
    writeCookie("codex-links-active-bridge-thread", normalized);
  }
};

const refreshButton = document.querySelector("#refresh-button");
const dispatchModeBridgeButton = document.querySelector("#dispatch-mode-bridge");
const dispatchModeCloudButton = document.querySelector("#dispatch-mode-cloud");
const commandForm = document.querySelector("#command-form");
const commandTargetLabel = document.querySelector("#command-target-label");
const commandThreadSelect = document.querySelector("#command-thread-select");
const commandPhotoInput = document.querySelector("#command-photo-input");
const commandPhotoStatus = document.querySelector("#command-photo-status");
const commandInput = document.querySelector("#command-input");
const commandStatus = document.querySelector("#command-status");
const commandTimeline = document.querySelector("#command-timeline");
const submitProgress = document.querySelector("#submit-progress");
const threadSettingsToggle = document.querySelector("#thread-settings-toggle");
const threadSettingsSummary = document.querySelector("#thread-settings-summary");
const cloudRepoPanel = document.querySelector("#cloud-repo-panel");
const cloudRepoSummary = document.querySelector("#cloud-repo-summary");
const cloudRepoSelect = document.querySelector("#cloud-repo-select");
const threadSettingsPanel = document.querySelector("#thread-settings-panel");
const threadSettingsShowAll = document.querySelector("#thread-settings-show-all");
const threadSettingsSearch = document.querySelector("#thread-settings-search");
const threadCategoriesSummary = document.querySelector("#thread-categories-summary");
const threadCategoriesList = document.querySelector("#thread-categories-list");
const threadSettingsList = document.querySelector("#thread-settings-list");
const threadSettingsSave = document.querySelector("#thread-settings-save");
const threadSettingsSelectAll = document.querySelector("#thread-settings-select-all");
const threadSettingsClear = document.querySelector("#thread-settings-clear");
const timelineTabDialog = document.querySelector("#timeline-tab-dialog");
const timelineTabNotifications = document.querySelector("#timeline-tab-notifications");

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

function getActiveDispatchMode() {
  return state.dispatchMode === "cloud" ? "cloud" : "bridge";
}

function buildCloudThreadId(repoId) {
  const normalized = String(repoId || "").trim().toLowerCase();
  return normalized ? `cloud:${normalized}` : "";
}

function getCloudRepoById(repoId) {
  const normalized = String(repoId || "").trim().toLowerCase();
  return state.cloudRepos.find((repo) => String(repo?.id || "").trim().toLowerCase() === normalized) || null;
}

function formatCloudRepoLabel(repo) {
  const name = String(repo?.name || "").trim();
  const owner = String(repo?.nameWithOwner || "").trim();
  return name || owner;
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

    if (
      !latestVersion
      || latestVersion === BUILD_VERSION
      || compareBuildVersions(latestVersion, BUILD_VERSION) < 0
    ) {
      return false;
    }

    state.hardReloading = true;
    setCommandStatusMessage("Обновляю страницу до новой версии…");
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("v", latestVersion);
    nextUrl.searchParams.set("reload", String(Date.now()));
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
        const createdAt = Math.max(0, Number(thread?.createdAt || 0));
        const updatedAt = Math.max(0, Number(thread?.updatedAt || 0));

        if (!id || !label || !displayLabel) {
          return null;
        }

        return [id, {
          id,
          label,
          displayLabel,
          category,
          messageCount,
          createdAt,
          updatedAt
        }];
      })
      .filter(Boolean)
  ).values()].sort((left, right) =>
    left.category.localeCompare(right.category, "ru")
    || (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0)
    || left.displayLabel.localeCompare(right.displayLabel, "ru")
  );
}

function getAllCloudRepoOptions() {
  return state.cloudRepos.map((repo) => ({
    id: buildCloudThreadId(repo.id),
    repoId: String(repo.id || "").trim().toLowerCase(),
    label: String(repo.name || "").trim(),
    displayLabel: formatCloudRepoLabel(repo),
    category: "GitHub",
    updatedAt: Number(new Date(repo.updatedAt || 0)) || 0
  })).sort((left, right) =>
    (right.updatedAt || 0) - (left.updatedAt || 0)
    || left.displayLabel.localeCompare(right.displayLabel, "ru")
  );
}

function getSelectableOptions() {
  return getActiveDispatchMode() === "cloud"
    ? getAllCloudRepoOptions()
    : getAllThreadOptions();
}

function groupSelectableOptions(options) {
  return [...options.reduce((groups, option) => {
    const key = option.category || "Без категории";
    const bucket = groups.get(key) || [];
    bucket.push(option);
    groups.set(key, bucket);
    return groups;
  }, new Map()).entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "ru"))
    .map(([category, items]) => ({
      category,
      items: items.sort((left, right) =>
        (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0)
        || left.displayLabel.localeCompare(right.displayLabel, "ru")
      )
    }));
}

function getActiveThreadId() {
  if (getActiveDispatchMode() === "cloud") {
    return buildCloudThreadId(storage.selectedCloudRepoId);
  }

  return String(commandThreadSelect?.value || storage.activeBridgeThreadId || "").trim();
}

function getSelectedThreadIds() {
  const stored = storage.selectedThreadIds;

  if (stored.length) {
    return stored;
  }

  return getAllThreadOptions().map((option) => option.id);
}

function getThreadDisplayLabel(threadId, fallbackLabel = "") {
  const normalizedId = String(threadId || "").trim();

  if (!normalizedId) {
    return fallbackLabel;
  }

  if (normalizedId.startsWith("cloud:")) {
    const cloudRepo = getCloudRepoById(normalizedId.slice("cloud:".length));
    return cloudRepo ? formatCloudRepoLabel(cloudRepo) : fallbackLabel;
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

  if (getActiveDispatchMode() === "cloud") {
    threadCategoriesList.innerHTML = "";
    threadCategoriesSummary.textContent = "В cloud-режиме вместо категорий показываются репозитории GitHub.";
    return;
  }

  threadCategoriesList.innerHTML = "";
  const categories = getAllCategories();
  const totalThreads = getAllThreadOptions().length;

  threadCategoriesSummary.textContent = categories.length
    ? `Категорий: ${categories.length} · чатов: ${totalThreads}`
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

  if (getActiveDispatchMode() === "cloud") {
    const repo = getCloudRepoById(storage.selectedCloudRepoId);
    threadSettingsSummary.textContent = repo
      ? `Cloud target: ${formatCloudRepoLabel(repo)}.`
      : "Выберите GitHub-репозиторий для Codex Cloud.";
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

  if (getActiveDispatchMode() === "cloud") {
    threadSettingsList.innerHTML = "";
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
  const groupedOptions = groupSelectableOptions(options);

  threadSettingsList.innerHTML = "";

  groupedOptions.forEach(({ category, items }) => {
    const section = document.createElement("section");
    section.className = "thread-settings-group";

    const heading = document.createElement("div");
    heading.className = "thread-settings-group-title";
    heading.textContent = `${category} · ${items.length}`;
    section.appendChild(heading);

    items.forEach((option) => {
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
      section.appendChild(row);
    });

    threadSettingsList.appendChild(section);
  });
}

function renderCloudRepos() {
  if (!cloudRepoSelect || !cloudRepoSummary) {
    return;
  }

  const repos = [...state.cloudRepos];
  cloudRepoSelect.innerHTML = "";
  cloudRepoSummary.textContent = repos.length
    ? `Репозиториев: ${repos.length}`
    : "Cloud-репозитории пока не синхронизированы.";

  if (!repos.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Cloud-репозитории не найдены";
    cloudRepoSelect.appendChild(option);
    cloudRepoSelect.disabled = true;
    return;
  }

  cloudRepoSelect.disabled = false;

  repos.forEach((repo) => {
    const option = document.createElement("option");
    option.value = repo.id;
    option.textContent = formatCloudRepoLabel(repo);
    cloudRepoSelect.appendChild(option);
  });

  const fallbackRepoId = repos[0]?.id || "";
  const selectedRepoId = repos.some((repo) => repo.id === storage.selectedCloudRepoId)
    ? storage.selectedCloudRepoId
    : fallbackRepoId;

  cloudRepoSelect.value = selectedRepoId;
}

function ensureThreadVisible(threadId) {
  const normalizedId = String(threadId || "").trim();

  if (!normalizedId) {
    return false;
  }

  const isCloudThread = normalizedId.startsWith("cloud:");
  const allOptionIds = isCloudThread
    ? getAllCloudRepoOptions().map((option) => option.id)
    : getAllThreadOptions().map((option) => option.id);

  if (!allOptionIds.includes(normalizedId)) {
    return false;
  }

  if (isCloudThread) {
    storage.selectedCloudRepoId = normalizedId.slice("cloud:".length);
    return true;
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

  state.dispatchMode = normalizedId.startsWith("cloud:") ? "cloud" : "bridge";
  storage.dispatchModePreference = state.dispatchMode;
  renderDispatchModeUi();

  if (commandThreadSelect) {
    commandThreadSelect.dataset.pendingValue = normalizedId;
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
  if (hasAssistantReply(command?.id, command)) {
    const relative = formatRelativeTime(command?.progressUpdatedAt || command?.createdAt);
    return relative ? `Ответ получен · ${relative}` : "Ответ получен";
  }

  const status = String(command?.status || "").trim().toLowerCase();
  const label = formatProgressStage(command?.progressStage, status);
  const relative = formatRelativeTime(command?.progressUpdatedAt || command?.createdAt);
  return relative ? `${label} · ${relative}` : label;
}

function getCommandDeliveryStatus(command) {
  if (hasAssistantReply(command?.id, command)) {
    return null;
  }

  const status = String(command?.status || "").trim().toLowerCase();
  const stage = String(command?.progressStage || "").trim().toLowerCase();
  const errorMessage = String(command?.errorMessage || "").trim();

  if (status === "failed") {
    return {
      tone: "error",
      text: getCommandFailureMessage(command)
    };
  }

  const stageTextByKey = {
    queued: "В очереди на отправку",
    claimed: "Команда принята в работу",
    "preparing-input": "Подготавливаю сообщение",
    "sending-to-codex": "Отправляю в Codex",
    dispatched: "Отправляю в Codex",
    processing: "Codex обрабатывает запрос",
    "waiting-for-codex": "Жду ответ Codex",
    "reading-codex-reply": "Читаю ответ Codex",
    "saving-reply": "Сохраняю ответ",
    answered: "Ответ сохранён",
    acked: "Ответ сохранён"
  };

  const text = stageTextByKey[stage] || stageTextByKey[status] || "";

  if (!text) {
    return null;
  }

  if (status === "answered" || status === "acked" || stage === "answered" || stage === "acked") {
    return null;
  }

  if (/automatically switched to local bridge/i.test(errorMessage)) {
    return {
      tone: "queued",
      text: "Cloud не ответил вовремя. Автоматически перевёл задачу на bridge."
    };
  }

  if (/automatically switched to codex cloud/i.test(errorMessage)) {
    return {
      tone: "queued",
      text: "Bridge задержался. Автоматически перевёл задачу в Codex Cloud."
    };
  }

  return {
    tone: "delivery",
    text
  };
}

function getVisibleTimelineCommands() {
  const showAllMessages = getActiveDispatchMode() === "cloud" ? false : storage.showAllMessages;
  const activeThreadId = showAllMessages ? "" : getActiveThreadId();

  return state.commands
    .filter((command) => !activeThreadId || command.threadId === activeThreadId)
    .filter((command) => !isHiddenSystemEntry(command))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function syncCommandStatusFromState() {
  const activeCommand = getVisibleTimelineCommands().find((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    if (hasAssistantReply(command?.id, command)) {
      return false;
    }

    return status === "queued" || status === "dispatched" || status === "processing";
  });

  if (!activeCommand) {
    setCommandStatusMessage("");
    setSubmitProgress("", "");
    return;
  }

  const status = String(activeCommand?.status || "").trim().toLowerCase();
  const isProcessing = status === "processing" || status === "dispatched";
  const tone = isProcessing ? "processing" : "queued";
  const message = isProcessing
    ? "Обработка…"
    : "Сообщение в очереди…";

  setCommandStatusMessage(message, { tone });
  setSubmitProgress(isProcessing ? "processing" : "queued", tone);
}

function getCommandDeliveryLabel(command) {
  return String(command?.dispatchMode || "").trim() === "local-bridge" ? "bridge" : "cloud";
}

function getCommandFailureMessage(command) {
  if (String(command?.status || "").trim() !== "failed") {
    return "";
  }

  const message = String(command?.errorMessage || "").trim();

  if (!message) {
    return "Не удалось доставить сообщение.";
  }

  if (/did not send a slack reply in time/i.test(message)) {
    return "Codex Cloud не ответил вовремя.";
  }

  if (/did not acknowledge the slack task in time/i.test(message)) {
    return "Codex Cloud не подтвердил задачу вовремя.";
  }

  if (/cloud dispatch timeout/i.test(message)) {
    return "Cloud не ответил вовремя, задача переведена на bridge.";
  }

  if (/cloud reply timeout/i.test(message)) {
    return "Cloud завис на ответе, задача переведена на bridge.";
  }

  if (/local bridge timeout/i.test(message) || /local bridge queue timeout/i.test(message)) {
    return "Bridge задержался, задача переведена в Codex Cloud.";
  }

  if (/photo attachments yet/i.test(message)) {
    return "Cloud пока не поддерживает фото. Для изображения используйте bridge.";
  }

  return message;
}

function buildTimelineSignature(items, context = {}) {
  return JSON.stringify({
    activeThreadId: context.activeThreadId || "",
    showAllMessages: Boolean(context.showAllMessages),
    activeTimelineTab: context.activeTimelineTab || "dialog",
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

function hasAssistantReply(commandId, command = null) {
  const normalizedId = String(commandId || "").trim();
  const directReplyExists = normalizedId
    ? state.messages.some((message) => String(message?.commandId || "").trim() === normalizedId)
    : false;

  if (directReplyExists) {
    return true;
  }

  if (!command || !command.threadId || !command.createdAt) {
    return false;
  }

  return getInferredAssistantReplies(command, state.messages, state.commands).length > 0;
}

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getInferredAssistantReplies(command, visibleMessages, visibleCommands) {
  const commandThreadId = String(command?.threadId || "").trim();
  const commandCreatedAt = toTimestamp(command?.createdAt);

  if (!commandThreadId || !commandCreatedAt) {
    return [];
  }

  const nextUserTimestamp = Math.min(
    ...[
      ...visibleCommands
        .filter((entry) => entry?.id !== command?.id)
        .filter((entry) => String(entry?.threadId || "").trim() === commandThreadId)
        .map((entry) => toTimestamp(entry?.createdAt))
        .filter((value) => value > commandCreatedAt),
      ...visibleMessages
        .filter((entry) => entry?.role === "user")
        .filter((entry) => String(entry?.threadId || "").trim() === commandThreadId)
        .map((entry) => toTimestamp(entry?.createdAt))
        .filter((value) => value > commandCreatedAt)
    ]
  );

  return visibleMessages
    .filter((message) => message?.role === "assistant")
    .filter((message) => !String(message?.commandId || "").trim())
    .filter((message) => String(message?.threadId || "").trim() === commandThreadId)
    .filter((message) => {
      const createdAt = toTimestamp(message?.createdAt);
      if (!createdAt || createdAt < commandCreatedAt) {
        return false;
      }

      return !Number.isFinite(nextUserTimestamp) || createdAt < nextUserTimestamp;
    })
    .map((message) => ({
      id: `message:${message.id}`,
      kind: "message",
      role: "assistant",
      text: message.text || "",
      createdAt: message.createdAt,
      threadId: message.threadId || "",
      threadLabel: message.threadLabel || "",
      message,
      linkedCommand: command
    }));
}

function normalizeEntryText(entry) {
  return String(entry?.text || "").trim().toLowerCase();
}

function isTechnicalProbeEntry(entry) {
  const text = normalizeEntryText(entry);

  return (
    text.includes("delivery-probe")
    || text.includes("local bridge probe")
    || text.includes("probe reply with ok only")
    || text.includes("dedupe test ignore")
    || text.includes("codex cloud routing probe ignore")
    || text.includes("test command from site api")
    || text.includes("direct deploy command test")
    || text.includes("ready check command")
  );
}

function isHiddenSystemEntry(entry) {
  const threadId = String(entry?.threadId || "").trim().toLowerCase();

  if (threadId === "dedupe-thread") {
    return true;
  }

  return isTechnicalProbeEntry(entry);
}

function isNotificationEntry(entry) {
  const threadId = String(entry?.threadId || "").trim().toLowerCase();

  if (threadId === "system-notifications") {
    return true;
  }

  if (entry?.systemChannel === "notifications") {
    return true;
  }

  if (isHiddenSystemEntry(entry)) {
    return false;
  }

  const text = normalizeEntryText(entry);
  return text.includes("cloud dispatch недоступен. команда автоматически переведена на локальный bridge.");
}

function getReleaseNotificationEntry() {
  return {
    id: `release:${BUILD_VERSION}`,
    kind: "notification",
    role: "assistant",
    text: "готово",
    createdAt: "2026-04-17T12:30:00.000Z",
    threadId: "system-notifications",
    threadLabel: "Уведомления",
    systemChannel: "notifications",
    statusLabel: "Системное сообщение"
  };
}

function renderTimelineTabButtons() {
  const isDialogActive = state.activeTimelineTab !== "notifications";
  timelineTabDialog?.classList.toggle("is-active", isDialogActive);
  timelineTabNotifications?.classList.toggle("is-active", !isDialogActive);
}

function renderAssistantReplyMarkup(replyEntry) {
  const message = replyEntry?.message || null;
  const linkedCommand = replyEntry?.linkedCommand || null;
  const detailsId = String(message?.id || "").trim();
  const deliveryLabel = getCommandDeliveryLabel(linkedCommand);
  const commandMeta = linkedCommand?.branchName
    ? `<p class="command-answer-meta">Ветка: <code>${escapeHtml(linkedCommand.branchName)}</code></p>`
    : "";
  const prMeta = linkedCommand?.prUrl
    ? `<p class="command-answer-meta"><a href="${escapeHtml(linkedCommand.prUrl)}" target="_blank" rel="noreferrer">Открыть PR</a></p>`
    : "";

  return `
    <details class="command-answer" data-entry-id="${escapeHtml(detailsId)}">
      <summary>
        <span class="command-answer-title">Ответ Codex</span>
        <span class="command-answer-badge">${escapeHtml(deliveryLabel)}</span>
      </summary>
      <div class="command-answer-body">
        <p class="command-answer-text">${escapeHtml(replyEntry?.text || "")}</p>
        ${prMeta}
        ${commandMeta}
        <div class="command-answer-actions">
          <button class="command-reply-link" type="button" data-thread-id="${escapeHtml(replyEntry?.threadId || "")}">
            Ответить
          </button>
        </div>
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
      const didActivate = activateReplyThread(threadId);

      if (!didActivate) {
        setCommandStatusMessage("Не удалось выбрать тему беседы для ответа.", { tone: "error" });
        return;
      }

      if (commandInput) {
        commandInput.value = "";
      }

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
  renderTimelineTabButtons();
  const showAllMessages = getActiveDispatchMode() === "cloud" ? false : storage.showAllMessages;
  const activeThreadId = showAllMessages ? "" : getActiveThreadId();
  const visibleCommands = getVisibleTimelineCommands();
  const visibleMessages = state.messages
    .filter((message) => !activeThreadId || message.threadId === activeThreadId)
    .filter((message) => !isHiddenSystemEntry(message))
    .filter((message) => !isNotificationEntry(message));

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

  visibleCommands.forEach((command) => {
    const commandId = String(command.id || "").trim();

    if (!commandId || assistantRepliesByCommandId.has(commandId)) {
      return;
    }

    const inferredReplies = getInferredAssistantReplies(command, visibleMessages, visibleCommands);

    if (inferredReplies.length) {
      assistantRepliesByCommandId.set(commandId, inferredReplies);
    }
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
  const notificationItems = [
    getReleaseNotificationEntry(),
    ...state.messages
      .filter((message) => !activeThreadId || message.threadId === activeThreadId)
      .filter((message) => isNotificationEntry(message))
      .map((message) => ({
        id: `notification:${message.id}`,
        kind: "notification",
        role: "assistant",
        text: message.text || "",
        createdAt: message.createdAt,
        threadId: message.threadId || "",
        threadLabel: message.threadLabel || "",
        message,
        systemChannel: "notifications",
        statusLabel: "Системное сообщение"
      }))
  ].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  const activeItems = state.activeTimelineTab === "notifications" ? notificationItems : timelineItems;

  const signature = buildTimelineSignature(activeItems, {
    activeThreadId,
    showAllMessages,
    activeTimelineTab: state.activeTimelineTab
  });

  if (signature === state.lastRenderedTimelineSignature) {
    scheduleAnswerAutoClose();
    return;
  }

  state.lastRenderedTimelineSignature = signature;
  commandTimeline.innerHTML = "";

  if (!activeItems.length) {
    commandTimeline.innerHTML = state.activeTimelineTab === "notifications"
      ? '<div class="command-empty">Системные сообщения появятся здесь.</div>'
      : '<div class="command-empty">Здесь будут только ваши сообщения и их доставка.</div>';
    state.lastRenderedTimelineSize = 0;
    return;
  }

  const fragment = document.createDocumentFragment();

  activeItems.forEach((entry) => {
    const element = document.createElement("article");
    element.className = `command-item ${entry.role === "assistant" ? "command-item-assistant" : "command-item-user"}`;

    if (entry.kind === "notification") {
      element.classList.add("command-item-notification");
      element.innerHTML = `
        <div class="command-item-top">
          <strong>Система</strong>
          <time>${formatDate(entry.createdAt)}</time>
        </div>
        <p>${escapeHtml(entry.text || "")}</p>
        <div class="command-item-top">
          <span>${escapeHtml(entry.statusLabel || "Системное сообщение")}</span>
        </div>
      `;
      fragment.appendChild(element);
      return;
    }

    if (entry.kind === "command") {
      const command = entry.command;
      const failureMessage = getCommandFailureMessage(command);
      const deliveryStatus = getCommandDeliveryStatus(command);
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
        ${failureMessage ? "" : ""}
        ${deliveryStatus?.text ? `<div class="command-delivery-note" data-tone="${escapeHtml(deliveryStatus.tone)}">${escapeHtml(deliveryStatus.text)}</div>` : ""}
        ${repliesMarkup}
        <div class="command-item-top">
          <span>${formatCommandStage(command)}</span>
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
      </div>
    `;

    bindAssistantReplyInteractions(element, isAssistant ? [entry] : entry.replies);
    fragment.appendChild(element);
  });

  commandTimeline.appendChild(fragment);
  state.lastRenderedTimelineSize = activeItems.length;
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

function unlockReplySound() {
  if (state.audioUnlocked) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    state.audioUnlocked = true;
    return;
  }

  try {
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.connect(context.destination);
    const resumePromise = typeof context.resume === "function" ? context.resume() : Promise.resolve();

    Promise.resolve(resumePromise)
      .catch(() => {})
      .finally(() => {
        state.audioUnlocked = context.state === "running";
        context.close().catch(() => {});
      });
  } catch {
    // Ignore browsers that block or do not support Web Audio setup here.
  }
}

function playReplySound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const resumePromise = typeof context.resume === "function" ? context.resume() : Promise.resolve();

    Promise.resolve(resumePromise)
      .then(() => {
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
      })
      .catch(() => {
        context.close().catch(() => {});
      });
  } catch {
    // Ignore browsers that do not allow playback in the current state.
  }
}

function renderDispatchModeUi() {
  const isCloud = getActiveDispatchMode() === "cloud";
  const selectedRepo = getCloudRepoById(storage.selectedCloudRepoId);
  const cloudRepo = selectedRepo || state.cloudRepos[0] || null;
  const hasActiveStatus = Boolean(String(commandStatus?.textContent || "").trim());
  const hasPendingCommand = state.commands.some((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    return status === "queued" || status === "dispatched" || status === "processing";
  });

  if (isCloud && cloudRepo && !selectedRepo) {
    storage.selectedCloudRepoId = cloudRepo.id;
  }

  dispatchModeBridgeButton?.classList.toggle("is-active", !isCloud);
  dispatchModeCloudButton?.classList.toggle("is-active", isCloud);
  dispatchModeBridgeButton?.setAttribute("aria-selected", String(!isCloud));
  dispatchModeCloudButton?.setAttribute("aria-selected", String(isCloud));

  if (commandTargetLabel) {
    commandTargetLabel.textContent = isCloud ? "Репозиторий GitHub" : "Беседа Codex";
  }

  if (threadSettingsToggle) {
    threadSettingsToggle.hidden = isCloud;
  }

  if (threadSettingsPanel && isCloud) {
    threadSettingsPanel.hidden = true;
    threadSettingsToggle?.setAttribute("aria-expanded", "false");
  }

  if (cloudRepoPanel) {
    cloudRepoPanel.hidden = !isCloud;
  }

  if (threadSettingsShowAll) {
    const showAllWrap = threadSettingsShowAll.closest("label");

    if (showAllWrap) {
      showAllWrap.hidden = isCloud;
    }
  }

  renderThreadCategories();
  renderThreadSettingsSummary();
  renderThreadSettingsList();
  renderCloudRepos();
  renderCommandThreads();

  if (isCloud && !hasPendingCommand && !hasActiveStatus) {
    setCommandStatusMessage(
      cloudRepo
        ? `Cloud target: ${cloudRepo.nameWithOwner}.`
        : "Выберите GitHub-репозиторий для отправки через Codex Cloud."
    );
  }
}

function renderCommandThreads() {
  if (!commandThreadSelect) {
    return;
  }

  const isCloud = getActiveDispatchMode() === "cloud";
  const options = isCloud ? getAllCloudRepoOptions() : getAllThreadOptions();
  const visibleIds = new Set(isCloud ? options.map((option) => option.id) : getSelectedThreadIds());
  const nextOptions = options.filter((option) => visibleIds.has(option.id));
  const currentValue = String(
    commandThreadSelect.dataset.pendingValue
    || commandThreadSelect.value
    || (isCloud ? buildCloudThreadId(storage.selectedCloudRepoId) : storage.activeBridgeThreadId)
    || ""
  ).trim();

  commandThreadSelect.innerHTML = "";

  groupSelectableOptions(nextOptions).forEach(({ category, items }) => {
    const group = document.createElement("optgroup");
    group.label = category;

    items.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.displayLabel;
      group.appendChild(element);
    });

    commandThreadSelect.appendChild(group);
  });

  delete commandThreadSelect.dataset.pendingValue;
  const targetValue = nextOptions.some((option) => option.id === currentValue)
    ? currentValue
    : nextOptions[0]?.id || "";

  if (targetValue) {
    commandThreadSelect.value = targetValue;
  }

  if (isCloud) {
    storage.selectedCloudRepoId = targetValue.replace(/^cloud:/, "");
  } else {
    storage.activeBridgeThreadId = targetValue;
  }

  renderThreadSettingsSummary();
  renderCommands();
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

async function fetchCloudRepos() {
  const response = await fetch(`/api/repos?mode=cloud&_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load repos: ${response.status}`);
  }

  const data = await response.json();
  state.cloudRepos = Array.isArray(data) ? data : Array.isArray(data?.repos) ? data.repos : [];
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
  state.commands = Array.isArray(data?.commands) ? data.commands : [];
}

async function fetchMessages() {
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
  state.messages = Array.isArray(data?.messages) ? data.messages : [];

  const hasNewAssistantReply = state.hasLoadedMessagesOnce && state.messages.some((message) => (
    message?.role === "assistant" && !previousAssistantIds.has(String(message.id || "").trim())
  ));

  if (hasNewAssistantReply) {
    playReplySound();
  }

  state.hasLoadedMessagesOnce = true;
}

async function refreshAll() {
  const results = await Promise.allSettled([
    fetchBridgeStatus(),
    fetchCommands(),
    fetchMessages(),
    fetchThreads(),
    fetchThreadCounts(),
    fetchCloudRepos()
  ]);

  const statusResult = results[0];
  const commandsError = results[1].status === "rejected" ? results[1].reason : null;
  const messagesError = results[2].status === "rejected" ? results[2].reason : null;
  const reposError = results[5].status === "rejected" ? results[5].reason : null;

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

  renderDispatchModeUi();

  const hasCachedData = state.commands.length > 0 || state.messages.length > 0;

  if ((commandsError || messagesError || reposError) && hasCachedData) {
    setCommandStatusMessage("Часть данных не обновилась, показываю последнюю доступную версию.", { tone: "error" });
  } else if (commandsError && messagesError) {
    setCommandStatusMessage("Не удалось обновить команды и ответы.", { tone: "error" });
  } else if (reposError) {
    setCommandStatusMessage("Не удалось обновить cloud-репозитории.", { tone: "error" });
  } else if (messagesError) {
    setCommandStatusMessage("Не удалось обновить ответы.", { tone: "error" });
  } else if (commandsError) {
    setCommandStatusMessage("Не удалось обновить команды.", { tone: "error" });
  } else {
    syncCommandStatusFromState();
  }

  startPolling();
  renderCommands();
}

async function submitCommand(event) {
  event.preventDefault();

  const text = String(commandInput?.value || "").trim();
  const requestedThreadId = getActiveThreadId();
  const requestedDispatchMode = getActiveDispatchMode();
  const cloudRepo = getCloudRepoById(storage.selectedCloudRepoId);
  const fallbackThreadId = String(storage.activeBridgeThreadId || getAllThreadOptions()[0]?.id || "").trim();
  const fallbackThreadLabel = getThreadDisplayLabel(fallbackThreadId, "");
  const photoFile = commandPhotoInput?.files?.[0];
  const forceBridgeForPhoto = requestedDispatchMode === "cloud" && Boolean(photoFile);
  const dispatchMode = forceBridgeForPhoto ? "bridge" : requestedDispatchMode;
  const threadId = forceBridgeForPhoto && fallbackThreadId
    ? fallbackThreadId
    : requestedThreadId;
  const threadLabel = dispatchMode === "cloud"
    ? formatCloudRepoLabel(cloudRepo)
    : getThreadDisplayLabel(threadId, forceBridgeForPhoto ? fallbackThreadLabel : "");

  if (!text && !photoFile) {
    setCommandStatusMessage("Введите сообщение или прикрепите фото.", { tone: "error" });
    return;
  }

  if (requestedDispatchMode === "cloud" && !cloudRepo) {
    setCommandStatusMessage("Для Codex Cloud сначала выберите GitHub-репозиторий.", { tone: "error" });
    return;
  }

  if (forceBridgeForPhoto) {
    setCommandStatusMessage("Cloud пока не поддерживает фото. Отправляю это сообщение через bridge.", { tone: "processing" });
  } else {
    setCommandStatusMessage("Отправляю сообщение…");
  }
  setSubmitProgress("queued", "queued");

  const payload = {
    clientId: storage.clientId,
    threadId,
    threadLabel,
    text,
    dispatchMode: dispatchMode === "cloud" ? "slack-codex-cloud" : "local-bridge",
    targetExecutionMode: dispatchMode
  };

  if (cloudRepo) {
    payload.targetRepo = cloudRepo.nameWithOwner;
    payload.targetRepoUrl = cloudRepo.url;
    payload.targetContextFiles = Array.isArray(cloudRepo.contextFiles) ? cloudRepo.contextFiles : [];
  }

  if (dispatchMode === "cloud" && fallbackThreadId) {
    payload.fallbackThreadId = fallbackThreadId;
    payload.fallbackThreadLabel = fallbackThreadLabel;
  }

  if (photoFile) {
    setPhotoStatusMessage(
      forceBridgeForPhoto
        ? "Подготавливаю фото и отправляю через bridge…"
        : "Подготавливаю фото для отправки…"
    );
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

  if (commandPhotoInput) {
    commandPhotoInput.value = "";
    setPhotoStatusMessage("Фото не выбрано.");
  }

  setSubmitProgress("processing", "processing");
  setCommandStatusMessage("Обработка…", { tone: "processing" });
  await refreshAll();
}

function startPolling() {
  if (state.commandPoller) {
    window.clearInterval(state.commandPoller);
  }

  const hasActiveCommands = state.commands.some((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    return status === "queued" || status === "dispatched" || status === "processing";
  });

  state.commandPollerInterval = hasActiveCommands ? FAST_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
  state.commandPoller = window.setInterval(async () => {
    if (await ensureLatestClient()) {
      return;
    }

    refreshAll().catch(() => {});
  }, state.commandPollerInterval);
}

function bindEvents() {
  const primeReplySound = () => {
    unlockReplySound();
  };

  document.addEventListener("pointerdown", primeReplySound, { passive: true });
  document.addEventListener("keydown", primeReplySound, { passive: true });

  dispatchModeBridgeButton?.addEventListener("click", () => {
    state.dispatchMode = "bridge";
    storage.dispatchModePreference = "bridge";
    renderDispatchModeUi();
  });

  dispatchModeCloudButton?.addEventListener("click", () => {
    state.dispatchMode = "cloud";
    storage.dispatchModePreference = "cloud";
    renderDispatchModeUi();
  });

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
    if (getActiveDispatchMode() === "cloud") {
      storage.selectedCloudRepoId = String(commandThreadSelect.value || "").replace(/^cloud:/, "");
    } else {
      storage.activeBridgeThreadId = String(commandThreadSelect.value || "").trim();
    }

    renderThreadSettingsSummary();
    renderCloudRepos();
    renderCommands();
  });

  cloudRepoSelect?.addEventListener("change", () => {
    storage.selectedCloudRepoId = String(cloudRepoSelect.value || "").trim();
    renderDispatchModeUi();
    renderCommands();

    const repo = getCloudRepoById(storage.selectedCloudRepoId);

    if (repo) {
      setCommandStatusMessage(`Выбран cloud repo: ${repo.nameWithOwner}.`);
    }
  });

  timelineTabDialog?.addEventListener("click", () => {
    state.activeTimelineTab = "dialog";
    storage.activeTimelineTab = "dialog";
    renderCommands();
  });

  timelineTabNotifications?.addEventListener("click", () => {
    state.activeTimelineTab = "notifications";
    storage.activeTimelineTab = "notifications";
    renderCommands();
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
    const suffix = getActiveDispatchMode() === "cloud"
      ? " · для фото будет использован bridge"
      : "";
    setPhotoStatusMessage(`Выбрано фото: ${file.name} (${sizeLabel})${suffix}`);
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
    renderThreadCategories();
    renderThreadSettingsList();
    setCommandStatusMessage("Фильтры меню сброшены.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    ensureLatestClient().catch(() => {});
  });

  window.addEventListener("focus", () => {
    ensureLatestClient().catch(() => {});
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) {
      return;
    }

    ensureLatestClient().catch(() => {});
  });
}

async function boot() {
  if (
    !refreshButton ||
    !dispatchModeBridgeButton ||
    !dispatchModeCloudButton ||
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

  state.dispatchMode = storage.dispatchModePreference;
  state.activeTimelineTab = storage.activeTimelineTab;
  renderTimelineTabButtons();

  if (commandInput) {
    commandInput.value = "";
  }

  setPhotoStatusMessage("Фото не выбрано.");
  bindEvents();

  if (await ensureLatestClient()) {
    return;
  }

  await refreshAll();
  startPolling();

  const url = new URL(window.location.href);
  url.searchParams.set("v", BUILD_VERSION);
  url.searchParams.delete("reload");
  window.history.replaceState({}, "", url.toString());
}

boot().catch((error) => {
  console.error(error);
  setCommandStatusMessage(String(error?.message || "Не удалось запустить интерфейс."), { tone: "error" });
});
