const state = {
  commands: [],
  messages: [],
  menuRepos: [],
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
  audioUnlocked: false,
  resetInFlight: false,
  voiceRecognition: null,
  voiceRecognitionActive: false,
  voiceTranscriptBase: "",
  voiceDraftText: "",
  voiceHadResult: false,
  deliverySpeedUntil: 0,
  speedModeClientId: "",
  visibleCommandUpdates: {}
};

const BUILD_VERSION = "20260418-0649";
const SPEED_POLL_INTERVAL_MS = 1000;
const SPEED_POLL_WINDOW_MS = 25000;
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

  get selectedMenuRepoIds() {
    let raw = safeLocalStorageGet("codex-links-selected-menu-repos");

    if (raw === null) {
      raw = readCookie("codex-links-selected-menu-repos")
        || safeLocalStorageGet("codex-links-selected-thread-ids")
        || readCookie("codex-links-selected-thread-ids")
        || null;
    }

    if (raw === null) {
      return [];
    }

    try {
      const value = JSON.parse(raw || "[]");
      safeLocalStorageSet("codex-links-selected-menu-repos", JSON.stringify(value));
      writeCookie("codex-links-selected-menu-repos", JSON.stringify(value));
      return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  set selectedMenuRepoIds(value) {
    if (value === null) {
      safeLocalStorageRemove("codex-links-selected-menu-repos");
      removeCookie("codex-links-selected-menu-repos");
      return;
    }

    const normalized = Array.isArray(value)
      ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];

    const serialized = JSON.stringify(normalized);
    safeLocalStorageSet("codex-links-selected-menu-repos", serialized);
    writeCookie("codex-links-selected-menu-repos", serialized);
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

  get selectedRepoId() {
    const raw = safeLocalStorageGet("codex-links-selected-repo")
      ?? readCookie("codex-links-selected-repo")
      ?? safeLocalStorageGet("codex-links-selected-cloud-repo")
      ?? readCookie("codex-links-selected-cloud-repo")
      ?? safeLocalStorageGet("codex-links-active-bridge-thread")
      ?? readCookie("codex-links-active-bridge-thread");
    return String(raw || "").trim().toLowerCase().replace(/^cloud:/, "");
  },

  set selectedRepoId(value) {
    const normalized = String(value || "").trim().toLowerCase();

    if (!normalized) {
      safeLocalStorageRemove("codex-links-selected-repo");
      removeCookie("codex-links-selected-repo");
      return;
    }

    safeLocalStorageSet("codex-links-selected-repo", normalized);
    writeCookie("codex-links-selected-repo", normalized);
  },

  get adminWriteToken() {
    return String(safeLocalStorageGet("codex-links-admin-write-token") || "").trim();
  },

  set adminWriteToken(value) {
    const normalized = String(value || "").trim();

    if (!normalized) {
      safeLocalStorageRemove("codex-links-admin-write-token");
      return;
    }

    safeLocalStorageSet("codex-links-admin-write-token", normalized);
  }
};

const refreshButton = document.querySelector("#refresh-button");
const deliveryResetButton = document.querySelector("#delivery-reset-button");
const dispatchModeBridgeButton = document.querySelector("#dispatch-mode-bridge");
const dispatchModeCloudButton = document.querySelector("#dispatch-mode-cloud");
const projectNav = document.querySelector("#project-nav");
const commandForm = document.querySelector("#command-form");
const commandTargetLabel = document.querySelector("#command-target-label");
const commandThreadSelect = document.querySelector("#command-thread-select");
const commandPhotoInput = document.querySelector("#command-photo-input");
const commandPhotoClear = document.querySelector("#command-photo-clear");
const commandPhotoStatus = document.querySelector("#command-photo-status");
const commandInput = document.querySelector("#command-input");
const commandVoiceButton = document.querySelector("#command-voice-button");
const commandVoiceStatus = document.querySelector("#command-voice-status");
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
const timelineTabDialog = document.querySelector("#timeline-tab-dialog");
const timelineTabNotifications = document.querySelector("#timeline-tab-notifications");
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

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
    reader.onabort = () => reject(new Error("Чтение фото было прервано браузером."));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

function encodeBase64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function readFileAsDataUrlFallback(file) {
  if (typeof file?.arrayBuffer !== "function") {
    throw new Error("Браузер не смог прочитать фото.");
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const contentType = String(file.type || "image/jpeg").toLowerCase();
  return `data:${contentType};base64,${encodeBase64FromBytes(bytes)}`;
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
    let dataUrl = "";

    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch (error) {
      dataUrl = await readFileAsDataUrlFallback(file).catch(() => {
        throw new Error(String(error?.message || "Не удалось прочитать фото."));
      });
    }

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

function normalizeRepoSelectionId(value) {
  return String(value || "").trim().toLowerCase().replace(/^cloud:/, "");
}

function getRepoAliases(repo) {
  return [...new Set(
    [
      repo?.id,
      repo?.repoId,
      repo?.label,
      repo?.displayLabel,
      ...(Array.isArray(repo?.aliases) ? repo.aliases : [])
    ]
      .map((value) => normalizeRepoSelectionId(value))
      .filter(Boolean)
  )];
}

function canonicalizeRepoSelectionId(value) {
  const normalized = normalizeRepoSelectionId(value);

  if (!normalized) {
    return "";
  }

  const matchedRepo = state.menuRepos.find((repo) => getRepoAliases(repo).includes(normalized));
  return matchedRepo ? normalizeRepoSelectionId(matchedRepo.id) : normalized;
}

function isSameThreadTarget(left, right) {
  const normalizedLeft = canonicalizeRepoSelectionId(left);
  const normalizedRight = canonicalizeRepoSelectionId(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight;
}

function getMenuRepoById(repoId) {
  const normalized = canonicalizeRepoSelectionId(repoId);
  return state.menuRepos.find((repo) => getRepoAliases(repo).includes(normalized)) || null;
}

function isCloudReadyRepo(repo) {
  return Boolean(repo?.cloudReady) && Boolean(String(repo?.targetRepo || "").trim());
}

function formatMenuRepoLabel(repo) {
  const displayLabel = String(repo?.displayLabel || "").trim();
  const label = String(repo?.label || "").trim();
  const nameWithOwner = String(repo?.nameWithOwner || "").trim();
  const name = String(repo?.name || "").trim();
  return displayLabel || label || name || nameWithOwner;
}

function getProjectCategory(repo) {
  return String(repo?.group || repo?.category || "").trim() || "other";
}

function formatCategoryTitle(category) {
  const normalized = String(category || "").trim().toLowerCase();

  if (normalized === "myprojects") {
    return "My Projects";
  }

  if (normalized === "brain") {
    return "Brain";
  }

  if (normalized === "other") {
    return "Other";
  }

  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCategoryPreview(category) {
  const names = getAllMenuOptions()
    .filter((option) => option.category === category)
    .map((option) => option.label || option.displayLabel)
    .filter(Boolean);

  if (!names.length) {
    return "Проекты пока не найдены.";
  }

  return names.join(" · ");
}

function getProjectStatusLabel(repo) {
  return isCloudReadyRepo(repo) ? "cloud-ready" : "bridge-only";
}

function getSelectedDispatchModeLabel() {
  return getActiveDispatchMode() === "cloud" ? "Cloud" : "Bridge";
}

function formatExecutorStatus(status = {}) {
  const selectedModeLabel = getSelectedDispatchModeLabel();
  const executorLabel = String(status?.executorLabel || "").trim() || "неизвестно";
  const executorState = String(status?.state || "").trim() || "idle";

  if (getActiveDispatchMode() === "cloud") {
    return `Статус: ${selectedModeLabel} selected · ${executorLabel} · ${executorState}`;
  }

  return `Статус: ${selectedModeLabel} selected · backend ${executorLabel} · ${executorState}`;
}

function formatWatchdogMessage(rawValue) {
  const raw = String(rawValue || "").trim();

  if (!raw) {
    return "ошибок нет";
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return raw;
    }

    const message = String(parsed.message || "").trim();
    const detail = String(parsed.detail || "").trim();

    if (message && detail) {
      return `${message} ${detail}`;
    }

    if (message) {
      return message;
    }

    if (detail) {
      return detail;
    }
  } catch {
    return raw;
  }

  return raw;
}

function formatProjectPath(repo) {
  if (!repo) {
    return "";
  }

  return `${getProjectCategory(repo)} / ${formatMenuRepoLabel(repo)}`;
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
    const requestedVersion = String(new URL(window.location.href).searchParams.get("v") || "").trim();

    if (
      !latestVersion
      || latestVersion === BUILD_VERSION
      || compareBuildVersions(latestVersion, BUILD_VERSION) < 0
    ) {
      return false;
    }

    if (requestedVersion && requestedVersion === latestVersion) {
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

function getAllMenuOptions() {
  return [...new Map(
    state.menuRepos
      .map((repo) => {
        const id = normalizeRepoSelectionId(repo?.id);
        const repoId = normalizeRepoSelectionId(repo?.repoId || repo?.id);
        const label = escapeThreadLabel(repo?.label || repo?.displayLabel || repo?.name || repo?.id || "").trim();
        const displayLabel = formatMenuRepoLabel(repo);
        const category = getProjectCategory(repo);
        const updatedAt = Number(new Date(repo?.updatedAt || 0)) || 0;

        if (!id || !repoId || !label || !displayLabel) {
          return null;
        }

        return [id, {
          id,
          repoId,
          label,
          displayLabel,
          category,
          updatedAt,
          cloudReady: isCloudReadyRepo(repo),
          targetRepo: String(repo?.targetRepo || "").trim(),
          workspacePath: String(repo?.workspacePath || "").trim(),
          statusLabel: getProjectStatusLabel(repo)
        }];
      })
      .filter(Boolean)
  ).values()].sort((left, right) =>
    left.category.localeCompare(right.category, "ru")
    || (right.updatedAt || 0) - (left.updatedAt || 0)
    || left.displayLabel.localeCompare(right.displayLabel, "ru")
  );
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
        (right.updatedAt || 0) - (left.updatedAt || 0)
        || left.displayLabel.localeCompare(right.displayLabel, "ru")
      )
    }));
}

function getActiveThreadId() {
  return canonicalizeRepoSelectionId(commandThreadSelect?.value || storage.selectedRepoId || "");
}

function getSelectedMenuRepoIds() {
  const availableIds = new Set(getAllMenuOptions().map((option) => option.id));
  const stored = storage.selectedMenuRepoIds
    .map((item) => canonicalizeRepoSelectionId(item))
    .filter((item) => Boolean(item) && availableIds.has(item));

  if (stored.length) {
    return stored;
  }

  return [...availableIds];
}

function getFilteredMenuOptions() {
  return getAllMenuOptions();
}

function getThreadDisplayLabel(threadId, fallbackLabel = "") {
  const normalizedId = normalizeRepoSelectionId(threadId);

  if (!normalizedId) {
    return fallbackLabel;
  }

  const match = getMenuRepoById(normalizedId);
  return match ? formatMenuRepoLabel(match) : fallbackLabel;
}

function getAllCategories() {
  return [...new Set(
    state.menuRepos
      .map((repo) => getProjectCategory(repo))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "ru"));
}

function renderProjectNav() {
  if (!projectNav) {
    return;
  }

  const activeRepo = getMenuRepoById(getActiveThreadId()) || state.menuRepos[0] || null;
  projectNav.dataset.status = activeRepo ? getProjectStatusLabel(activeRepo) : "";
}

function renderThreadCategories() {
  if (!threadCategoriesList || !threadCategoriesSummary) {
    return;
  }

  threadCategoriesList.innerHTML = "";
  const categories = getAllCategories();
  const totalRepos = getAllMenuOptions().length;

  threadCategoriesSummary.textContent = categories.length
    ? `Групп: ${categories.length} · проектов: ${totalRepos}`
    : "Категории не найдены.";

  categories.forEach((category) => {
    const categoryCount = getAllMenuOptions().filter((option) => option.category === category).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thread-category-chip";
    button.dataset.active = state.activeThreadCategories.includes(category) ? "1" : "0";
    button.innerHTML = `
      <span class="thread-category-chip-head">
        <span class="thread-category-chip-title">${escapeHtml(formatCategoryTitle(category))}</span>
        <span class="thread-category-chip-count">${categoryCount}</span>
      </span>
      <span class="thread-category-chip-subtitle">${escapeHtml(getCategoryPreview(category))}</span>
    `;
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
    threadSettingsSummary.textContent = "Показываются все проекты.";
    return;
  }

  const filteredOptions = getFilteredMenuOptions();

  if (state.activeThreadCategories.length) {
    if (!filteredOptions.length) {
      threadSettingsSummary.textContent = "В выбранных группах нет включённых проектов.";
      return;
    }

    threadSettingsSummary.textContent = `Группы: ${state.activeThreadCategories.join(", ")} · проектов в меню: ${filteredOptions.length}.`;
    return;
  }

  const activeThreadId = getActiveThreadId();
  const activeRepo = getMenuRepoById(activeThreadId);
  threadSettingsSummary.textContent = activeRepo
    ? `Выбран проект: ${formatProjectPath(activeRepo)} · ${getProjectStatusLabel(activeRepo)}.`
    : "Выберите проект.";
}

function renderThreadSettingsList() {
  if (!threadSettingsList) {
    return;
  }

  const search = String(threadSettingsSearch?.value || "").trim().toLowerCase();
  const activeCategories = new Set(state.activeThreadCategories);
  const selectedRepoIds = new Set(getSelectedMenuRepoIds());
  const options = getAllMenuOptions().filter((option) => {
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
      checkbox.checked = selectedRepoIds.has(option.id);
      checkbox.addEventListener("change", () => {
        const next = new Set(getSelectedMenuRepoIds());

        if (checkbox.checked) {
          next.add(option.id);
        } else {
          next.delete(option.id);
        }

        storage.selectedMenuRepoIds = [...next];
        renderCommandThreads();
        renderThreadSettingsList();
        renderCommands();
        setCommandStatusMessage(
          checkbox.checked
            ? `Проект добавлен в меню: ${option.displayLabel}.`
            : `Проект убран из меню: ${option.displayLabel}.`
        );
      });

      const text = document.createElement("span");
      text.className = "thread-settings-copy";
      text.innerHTML = `
        <strong>${escapeHtml(option.displayLabel)}</strong>
        <span class="thread-settings-meta">
          <span>${escapeHtml(category)}</span>
          <span class="thread-status-badge" data-status="${escapeHtml(option.statusLabel)}">${escapeHtml(option.statusLabel)}</span>
          ${option.targetRepo ? `<code>${escapeHtml(option.targetRepo)}</code>` : ""}
        </span>
      `;

      row.append(checkbox, text);
      section.appendChild(row);
    });

    threadSettingsList.appendChild(section);
  });
}

function ensureThreadVisible(threadId) {
  const normalizedId = normalizeRepoSelectionId(threadId);

  if (!normalizedId) {
    return false;
  }

  const allOptionIds = getAllMenuOptions().map((option) => option.id);

  if (!allOptionIds.includes(normalizedId)) {
    return false;
  }

  const selectedRepoIds = getSelectedMenuRepoIds();

  if (!selectedRepoIds.includes(normalizedId)) {
    storage.selectedMenuRepoIds = [...selectedRepoIds, normalizedId];
  }

  storage.selectedRepoId = normalizedId;
  return true;
}

function activateReplyThread(threadId) {
  const normalizedId = normalizeRepoSelectionId(threadId);

  if (!ensureThreadVisible(normalizedId)) {
    return false;
  }

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
  const mapped = {
    created: "Команда создана",
    dispatching: "Отправляется исполнителю",
    sent: "Отправлено в cloud",
    accepted: "Исполнитель подтвердил задачу",
    claimed: "Bridge забрал сообщение",
    processing: "Исполнитель работает",
    "waiting-for-codex": "Codex обрабатывает сообщение",
    "saving-reply": "Сохраняю ответ",
    "retrying-photo-read": "Повторно читаю фото",
    "switched-to-bridge": "Переведено на bridge",
    "switched-to-cloud": "Переведено в cloud",
    dispatched: "Команда отправлена",
    "fallback-to-bridge": "Переведено на bridge",
    "fallback-to-cloud": "Переведено в cloud",
    "reply-not-threaded": "Reply пришёл вне thread",
    "codex-target-user-invalid": "Неверный cloud target"
  };

  if (mapped[stage]) {
    return mapped[stage];
  }

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

function parseCommandErrorDetails(command) {
  const raw = String(command?.errorMessage || "").trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getCommandDiagnosticMessage(command) {
  const fallbackReason = String(command?.fallbackReason || "").trim().toLowerCase();
  const timeoutPhase = String(command?.timeoutPhase || "").trim().toLowerCase();
  const diagnosticCode = String(command?.lastDiagnosticCode || "").trim().toLowerCase();

  if (diagnosticCode === "cloud_photo_not_supported") {
    return "Direct OpenAI cloud пока поддерживает только текстовые команды. Для фото используйте bridge или cloud via Slack.";
  }

  if (diagnosticCode === "openai_api_key_missing") {
    return "Cloud не настроен: отсутствует OPENAI_API_KEY.";
  }

  if (diagnosticCode === "openai_request_failed" || diagnosticCode === "openai_response_failed" || diagnosticCode === "openai_empty_response") {
    return "Direct cloud execution не завершился успешно.";
  }

  if (fallbackReason === "direct cloud execution timed out" || timeoutPhase === "result-timeout") {
    return "Cloud не завершил выполнение вовремя.";
  }

  if (fallbackReason === "local bridge did not claim the command in time" || timeoutPhase === "claim-timeout") {
    return "Bridge не забрал сообщение из очереди вовремя.";
  }

  if (fallbackReason === "local bridge stopped heartbeating") {
    return "Bridge перестал heartbeat’ить во время обработки.";
  }

  return "";
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

function getCommandRequestedExecutor(command) {
  const value = String(command?.requestedExecutor || command?.requestedMode || command?.targetExecutionMode || "").trim().toLowerCase();
  return value === "cloud" ? "cloud" : "bridge";
}

function getCommandActualExecutor(command) {
  const value = String(command?.actualExecutor || command?.actualDispatchMode || "").trim().toLowerCase();

  if (value === "cloud" || value === "bridge") {
    return value;
  }

  return "pending";
}

function getCommandLifecycleState(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const stage = String(command?.progressStage || "").trim().toLowerCase();

  if (status === "failed") {
    return "failed";
  }

  if (status === "answered" || status === "acked" || hasAssistantReply(command?.id, command)) {
    return "done";
  }

  if (stage === "switched-to-bridge") {
    return "switched-to-bridge";
  }

  if (stage === "switched-to-cloud") {
    return "switched-to-cloud";
  }

  if (stage === "dispatching" || status === "dispatched") {
    return "dispatching";
  }

  if (stage === "accepted") {
    return "accepted";
  }

  if (status === "processing" || stage === "processing") {
    return "processing";
  }

  return "created";
}

function getCommandDeliveryStatus(command) {
  if (hasAssistantReply(command?.id, command)) {
    return null;
  }

  const lifecycleState = getCommandLifecycleState(command);
  const stageLabel = formatProgressStage(command?.progressStage, String(command?.status || "").trim().toLowerCase());
  const errorMessage = String(command?.errorMessage || "").trim();
  const errorDetails = parseCommandErrorDetails(command);
  const deliveryLabel = getCommandActualExecutor(command) === "pending"
    ? `waiting (${getCommandRequestedExecutor(command)})`
    : getCommandActualExecutor(command);
  const diagnosticMessage = getCommandDiagnosticMessage(command);

  const withDeliveryLabel = (text) => {
    const normalized = String(text || "").trim();

    if (!normalized) {
      return "";
    }

    return `${normalized} · ${deliveryLabel}`;
  };

  if (lifecycleState === "failed") {
    return {
      tone: "error",
      text: withDeliveryLabel(diagnosticMessage || getCommandFailureMessage(command))
    };
  }

  if (!lifecycleState || lifecycleState === "done") {
    return null;
  }

  if (errorDetails?.code === "fallback_to_bridge" || /automatically switched to local bridge/i.test(errorMessage)) {
    return {
      tone: "queued",
      text: withDeliveryLabel(diagnosticMessage || errorDetails?.message || "Cloud не ответил вовремя. Автоматически перевёл задачу на bridge.")
    };
  }

  if (errorDetails?.code === "fallback_to_cloud" || /automatically switched to codex cloud/i.test(errorMessage)) {
    return {
      tone: "queued",
      text: withDeliveryLabel(diagnosticMessage || errorDetails?.message || "Bridge задержался. Автоматически перевёл задачу в cloud.")
    };
  }

  return {
    tone: errorDetails ? "error" : "delivery",
    text: withDeliveryLabel(
      diagnosticMessage
      || errorDetails?.message
      || `Обрабатываю · ${stageLabel || "В очереди"}`
    )
  };
}

function getVisibleTimelineCommands() {
  const showAllMessages = storage.showAllMessages;
  const activeThreadId = showAllMessages ? "" : getActiveThreadId();

  return state.commands
    .filter((command) => !activeThreadId || isSameThreadTarget(command.threadId, activeThreadId))
    .filter((command) => !isHiddenSystemEntry(command))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function syncCommandStatusFromState() {
  const activeCommand = getVisibleTimelineCommands().find((command) => {
    if (hasAssistantReply(command?.id, command)) {
      return false;
    }

    return ["created", "dispatching", "accepted", "processing", "switched-to-bridge", "switched-to-cloud"].includes(getCommandLifecycleState(command));
  });

  if (!activeCommand) {
    setCommandStatusMessage("");
    setSubmitProgress("", "");
    return;
  }

  const lifecycleState = getCommandLifecycleState(activeCommand);
  const isProcessing = ["dispatching", "accepted", "processing", "switched-to-bridge", "switched-to-cloud"].includes(lifecycleState);
  const tone = isProcessing ? "processing" : "queued";
  const deliveryLabel = getCommandActualExecutor(activeCommand);
  const message = lifecycleState === "created"
    ? `Команда создана для ${getCommandRequestedExecutor(activeCommand)}…`
    : lifecycleState === "dispatching"
      ? `Отправляю через ${getCommandRequestedExecutor(activeCommand)}…`
    : lifecycleState === "accepted"
      ? `Исполнитель ${deliveryLabel === "pending" ? getCommandRequestedExecutor(activeCommand) : deliveryLabel} подтвердил задачу…`
    : lifecycleState === "switched-to-bridge"
      ? "Перевёл задачу на bridge…"
      : lifecycleState === "switched-to-cloud"
        ? "Перевёл задачу в cloud…"
        : isProcessing
          ? `Обработка через ${deliveryLabel === "pending" ? getCommandRequestedExecutor(activeCommand) : deliveryLabel}…`
          : `Сообщение в очереди (${getCommandRequestedExecutor(activeCommand)})…`;

  setCommandStatusMessage(message, { tone });
  setSubmitProgress(isProcessing ? "processing" : "queued", tone);
}

function getCommandDeliveryLabel(command) {
  return getCommandActualExecutor(command);
}

function getCommandAnswerTitle(command) {
  const executor = getCommandActualExecutor(command);

  if (executor === "bridge") {
    return "Ответ Codex bridge";
  }

  if (executor === "cloud") {
    return "Ответ Codex сдщгв";
  }

  return "Ответ Codex";
}

function getCommandProjectPath(command) {
  const projectCategory = String(command?.projectCategory || "").trim();
  const projectLabel = String(command?.projectLabel || command?.threadLabel || "").trim();

  if (projectCategory && projectLabel) {
    return `${projectCategory} / ${projectLabel}`;
  }

  return projectLabel;
}

function renderCommandContextMarkup(command) {
  if (!command) {
    return "";
  }

  const projectPath = getCommandProjectPath(command);
  const targetRepo = String(command?.targetRepo || "").trim();
  const statusLabel = targetRepo ? "cloud-ready" : "bridge-only";
  const requestedExecutor = getCommandRequestedExecutor(command);
  const actualExecutor = getCommandActualExecutor(command);
  const fallbackReason = String(command?.fallbackReason || "").trim();
  const parts = [
    projectPath ? `<span>${escapeHtml(projectPath)}</span>` : "",
    `<span class="command-context-badge" data-status="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>`,
    targetRepo ? `<code>${escapeHtml(targetRepo)}</code>` : "",
    `<span>requested: ${escapeHtml(requestedExecutor)}</span>`,
    `<span>actual: ${escapeHtml(actualExecutor)}</span>`,
    `<span>stage: ${escapeHtml(String(command?.deliveryStage || getCommandLifecycleState(command) || "created"))}</span>`,
    fallbackReason ? `<span>fallback: ${escapeHtml(fallbackReason)}</span>` : ""
  ].filter(Boolean);

  return parts.length ? `<div class="command-context">${parts.join("")}</div>` : "";
}

function renderLatencyValue(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return "—";
  }

  return `${Math.round(numeric)} ms`;
}

function renderCommandLatencyMarkup(command) {
  const breakdown = command?.latencyBreakdown || {};
  const items = [
    `create: ${renderLatencyValue(breakdown.apiRequestToCommandCreatedMs)}`,
    `dispatch: ${renderLatencyValue(breakdown.commandCreateToDispatchStartMs)}`,
    `first-ack: ${renderLatencyValue(breakdown.dispatchToFirstAckMs)}`,
    `first-reply: ${renderLatencyValue(breakdown.dispatchToFirstReplyMs)}`,
    `ingest->ui: ${renderLatencyValue(breakdown.ingestToUiVisibleMs)}`
  ];

  return `<div class="command-context command-context-latency">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function getCommandFailureMessage(command) {
  if (String(command?.status || "").trim() !== "failed") {
    return "";
  }

  const message = String(command?.errorMessage || "").trim();
  const details = parseCommandErrorDetails(command);
  const diagnosticMessage = getCommandDiagnosticMessage(command);

  if (diagnosticMessage) {
    return diagnosticMessage;
  }

  if (details?.message) {
    return details.detail ? `${details.message} ${details.detail}`.trim() : details.message;
  }

  if (!message) {
    return "Не удалось доставить сообщение.";
  }

  if (/local bridge timeout/i.test(message) || /local bridge queue timeout/i.test(message)) {
    return "Bridge задержался, задача переведена в cloud.";
  }

  if (/cloud photo commands are not supported yet/i.test(message) || /cloud_photo_not_supported/i.test(message)) {
    return "Direct OpenAI cloud пока поддерживает только текст. Для фото используйте bridge или cloud via Slack.";
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
      status: entry.status || entry.command?.status || entry.linkedCommand?.status || "",
      progressStage: entry.progressStage || entry.command?.progressStage || entry.linkedCommand?.progressStage || "",
      deliveryStage: entry.command?.deliveryStage || entry.linkedCommand?.deliveryStage || "",
      projectCategory: entry.command?.projectCategory || entry.linkedCommand?.projectCategory || "",
      projectLabel: entry.command?.projectLabel || entry.linkedCommand?.projectLabel || "",
      targetRepo: entry.command?.targetRepo || entry.linkedCommand?.targetRepo || "",
      commandError: entry.command?.errorMessage || "",
      requestedExecutor: entry.command?.requestedExecutor || "",
      actualExecutor: entry.command?.actualExecutor || "",
      fallbackReason: entry.command?.fallbackReason || "",
      fallbackCount: entry.command?.fallbackCount || 0,
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

function canRetryCommand(command) {
  return Boolean(String(command?.text || "").trim()) && !command?.photo;
}

function buildRetryPayload(command, executor) {
  return {
    clientId: storage.clientId,
    threadId: String(command?.threadId || "").trim(),
    threadLabel: String(command?.threadLabel || "").trim(),
    text: String(command?.text || "").trim(),
    dispatchMode: executor === "cloud" ? "cloud" : "local-bridge",
    targetExecutionMode: executor,
    targetRepo: String(command?.targetRepo || "").trim(),
    targetRepoUrl: String(command?.targetRepoUrl || "").trim(),
    targetContextFiles: Array.isArray(command?.targetContextFiles) ? command.targetContextFiles : [],
    targetWorkspacePath: String(command?.targetWorkspacePath || "").trim(),
    projectId: String(command?.projectId || "").trim(),
    projectLabel: String(command?.projectLabel || "").trim(),
    projectCategory: String(command?.projectCategory || "").trim(),
    fallbackThreadId: String(command?.fallbackThreadId || "").trim(),
    fallbackThreadLabel: String(command?.fallbackThreadLabel || "").trim()
  };
}

async function retryCommandWithExecutor(commandId, executor) {
  const command = state.commands.find((entry) => String(entry?.id || "").trim() === String(commandId || "").trim());

  if (!command || !canRetryCommand(command)) {
    setCommandStatusMessage("Эту команду нельзя повторить автоматически.", { tone: "error" });
    return;
  }

  setCommandStatusMessage(`Повторяю через ${executor}…`, { tone: "processing" });
  const response = await fetch("/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(buildRetryPayload(command, executor))
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(String(result?.error || "").trim() || `Не удалось повторить сообщение (HTTP ${response.status}).`);
  }

  await refreshAll();
}

async function requestAdminWriteToken(forcePrompt = false) {
  const existing = storage.adminWriteToken;

  if (existing && !forcePrompt) {
    return existing;
  }

  const entered = window.prompt("Введите LINKS_WRITE_TOKEN для Reset maintenance.", existing || "");

  if (!entered) {
    return "";
  }

  storage.adminWriteToken = entered;
  return storage.adminWriteToken;
}

async function runDeliveryReset() {
  if (state.resetInFlight) {
    return;
  }

  const confirmed = window.confirm("Запустить Reset для cloud/bridge delivery? Это вызовет admin maintenance для зависших сообщений.");

  if (!confirmed) {
    return;
  }

  state.resetInFlight = true;
  setResetButtonBusy(true);
  setCommandStatusMessage("Запускаю Reset maintenance…", { tone: "processing" });

  try {
    let token = await requestAdminWriteToken(false);

    if (!token) {
      setCommandStatusMessage("Reset отменён: нет admin token.", { tone: "error" });
      return;
    }

    const makeRequest = (writeToken) => fetch("/api/admin/commands-maintenance", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-write-token": writeToken
      },
      body: JSON.stringify({
        clientId: storage.clientId,
        syncReplies: true
      })
    });

    let response = await makeRequest(token);

    if (response.status === 401) {
      storage.adminWriteToken = "";
      token = await requestAdminWriteToken(true);

      if (!token) {
        setCommandStatusMessage("Reset отменён: нужен корректный admin token.", { tone: "error" });
        return;
      }

      response = await makeRequest(token);
    }

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(String(result?.error || "").trim() || `Reset maintenance failed (HTTP ${response.status}).`);
    }

    const changedCount = Number(result?.summary?.changedCount || 0);
    const dispatchedCount = Number(result?.summary?.dispatchedCount || 0);
    setCommandStatusMessage(`Reset выполнен: changed ${changedCount}, dispatched ${dispatchedCount}.`, { tone: "processing" });
    await refreshAll();
  } catch (error) {
    setCommandStatusMessage(String(error?.message || "Reset maintenance не выполнился."), { tone: "error" });
  } finally {
    state.resetInFlight = false;
    setResetButtonBusy(false);
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

function isTerminalAssistantReplyText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return false;
  }

  if (/\b(error|failed|failure|unable|blocked|need access|permission denied|could not|can'?t complete)\b/i.test(value)) {
    return true;
  }

  if (
    /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.test(value)
    || /\b(pr ready|pull request|opened pr|created pr|implemented|completed|finished|done|готово|исправил|сделал)\b/i.test(value)
  ) {
    return true;
  }

  return !/\b(checking|investigating|looking into|working on|reading|starting|preparing|waiting|running|processing|analyzing|analysing|searching|syncing|opening|reviewing|triaging|debugging|retrying|dispatching|queue(?:d)?|queued|in progress|wip|thinking)\b/i.test(value)
    && !/(проверяю|смотрю|изучаю|читаю|готовлю|запускаю|жду|обрабатываю|анализирую|ищу|синхронизирую|открываю|разбираю|дебажу|повторяю|в очереди|в работе|работаю)/i.test(value);
}

function collapseAssistantReplies(replies) {
  const normalizedReplies = Array.isArray(replies) ? replies : [];

  if (!normalizedReplies.length) {
    return [];
  }

  const latestBySignature = new Map();
  normalizedReplies.forEach((reply) => {
    const text = String(reply?.text || "").trim();
    const prUrl = String(reply?.linkedCommand?.prUrl || "").trim();
    const branchName = String(reply?.linkedCommand?.branchName || "").trim();
    const signature = `${text.toLowerCase()}::${prUrl}::${branchName}`;
    const existing = latestBySignature.get(signature);

    if (!existing || toTimestamp(reply?.createdAt) >= toTimestamp(existing?.createdAt)) {
      latestBySignature.set(signature, reply);
    }
  });

  const uniqueReplies = [...latestBySignature.values()]
    .sort((left, right) => toTimestamp(right?.createdAt) - toTimestamp(left?.createdAt));
  const terminalReply = uniqueReplies.find((reply) => isTerminalAssistantReplyText(reply?.text || ""));

  return terminalReply ? [terminalReply] : uniqueReplies.slice(0, 1);
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
      .filter((entry) => isSameThreadTarget(entry?.threadId, commandThreadId))
      .map((entry) => toTimestamp(entry?.createdAt))
      .filter((value) => value > commandCreatedAt),
      ...visibleMessages
        .filter((entry) => entry?.role === "user")
        .filter((entry) => isSameThreadTarget(entry?.threadId, commandThreadId))
        .map((entry) => toTimestamp(entry?.createdAt))
        .filter((value) => value > commandCreatedAt)
    ]
  );

  return visibleMessages
    .filter((message) => message?.role === "assistant")
    .filter((message) => !String(message?.commandId || "").trim())
    .filter((message) => isSameThreadTarget(message?.threadId, commandThreadId))
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

function isHiddenJunkFeedText(text) {
  const normalized = String(text || "").trim().toLowerCase();
  const allowedTokens = new Set(["photo", "repro", "ignore", "test", "probe"]);

  if (!normalized) {
    return false;
  }

  if (/^(?:photo|repro|ignore)(?:\s+(?:photo|repro|ignore))*$/i.test(normalized)) {
    return true;
  }

  const tokens = normalized
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.length > 0
    && tokens.length <= 6
    && tokens.every((token) => allowedTokens.has(token))
    && tokens.includes("ignore")
    && (tokens.includes("photo") || tokens.includes("repro"));
}

function isTechnicalProbeEntry(entry) {
  const text = normalizeEntryText(entry);
  const isProductionVerificationProbe = text.includes("production")
    && (
      text.includes("verification")
      || text.includes("route check")
      || text.includes(" ping")
    )
    && (
      text.includes("ignore if seen")
      || text.includes("reply with ok only")
    );

  return (
    isHiddenJunkFeedText(text)
    || isProductionVerificationProbe
    || text.includes("delivery-probe")
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

function isCodexDialogMessage(entry) {
  return entry?.role === "assistant"
    && !isHiddenSystemEntry(entry)
    && !isNotificationEntry(entry);
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
  const title = linkedCommand?.threadLabel
    ? `Ответ Codex · ${linkedCommand.threadLabel}`
    : getCommandAnswerTitle(linkedCommand);

  return `
    <details class="command-answer" data-entry-id="${escapeHtml(detailsId)}">
      <summary>
        <span class="command-answer-title">${escapeHtml(title)}</span>
      </summary>
      <div class="command-answer-body">
        <p class="command-answer-text">${escapeHtml(replyEntry?.text || "")}</p>
      </div>
    </details>
  `;
}

function bindAssistantReplyInteractions(container, replies) {
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

}

function renderCommands() {
  pruneExpiredAnswerState();
  renderTimelineTabButtons();
  const showAllMessages = storage.showAllMessages;
  const activeThreadId = showAllMessages ? "" : getActiveThreadId();
  const visibleCommands = getVisibleTimelineCommands();
  const visibleMessages = state.messages
    .filter((message) => !activeThreadId || isSameThreadTarget(message.threadId, activeThreadId))
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
      assistantRepliesByCommandId.set(commandId, collapseAssistantReplies(items));
    });

  visibleCommands.forEach((command) => {
    const commandId = String(command.id || "").trim();

    if (!commandId || assistantRepliesByCommandId.has(commandId)) {
      return;
    }

    const inferredReplies = getInferredAssistantReplies(command, visibleMessages, visibleCommands);

    if (inferredReplies.length) {
      assistantRepliesByCommandId.set(commandId, collapseAssistantReplies(inferredReplies));
    }
  });

  const threadedAssistantMessageIds = new Set(
    [...assistantRepliesByCommandId.values()]
      .flat()
      .map((reply) => String(reply?.message?.id || "").trim())
      .filter(Boolean)
  );

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
        if (message.role === "assistant" && (commandId || threadedAssistantMessageIds.has(String(message.id || "").trim()))) {
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
      .filter((message) => !activeThreadId || isSameThreadTarget(message.threadId, activeThreadId))
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
      const text = String(command?.text || "").trim() || (command?.photo ? "Фото" : "Сообщение без текста");
      const hasPhoto = Boolean(command?.photo);
      const deliveryStatus = getCommandDeliveryStatus(command);
      const failureMessage = getCommandFailureMessage(command);
      const repliesMarkup = (entry.replies || []).map((replyEntry) => renderAssistantReplyMarkup(replyEntry)).join("");

      element.innerHTML = `
        <div class="command-item-top">
          <strong>Вы</strong>
          <time>${formatDate(entry.createdAt)}</time>
        </div>
        <p>${escapeHtml(text)}</p>
        ${hasPhoto ? '<div class="command-fallback-note">К сообщению приложено фото.</div>' : ""}
        ${failureMessage ? `<div class="command-delivery-note" data-tone="error">${escapeHtml(failureMessage)}</div>` : ""}
        ${deliveryStatus?.text ? `<div class="command-delivery-note" data-tone="${escapeHtml(deliveryStatus.tone)}">${escapeHtml(deliveryStatus.text)}</div>` : ""}
        ${repliesMarkup}
      `;

      bindAssistantReplyInteractions(element, entry.replies);
      fragment.appendChild(element);
      return;
    }

    const message = entry.message;
    const linkedCommand = entry.linkedCommand;
    const isAssistant = entry.role === "assistant";
    const hasPhoto = Boolean(linkedCommand?.photo);
    const deliveryStatus = isAssistant ? null : getCommandDeliveryStatus(linkedCommand);
    const failureMessage = isAssistant ? "" : getCommandFailureMessage(linkedCommand);
    const body = isAssistant
      ? renderAssistantReplyMarkup(entry)
      : `
        <p>${escapeHtml(entry.text || "")}</p>
        ${hasPhoto ? '<div class="command-fallback-note">К сообщению приложено фото.</div>' : ""}
        ${failureMessage ? `<div class="command-delivery-note" data-tone="error">${escapeHtml(failureMessage)}</div>` : ""}
        ${deliveryStatus?.text ? `<div class="command-delivery-note" data-tone="${escapeHtml(deliveryStatus.tone)}">${escapeHtml(deliveryStatus.text)}</div>` : ""}
        ${(entry.replies || []).map((replyEntry) => renderAssistantReplyMarkup(replyEntry)).join("")}
      `;

    element.innerHTML = `
      <div class="command-item-top">
        <strong>${isAssistant ? "Codex" : "Вы"}</strong>
        <time>${formatDate(entry.createdAt)}</time>
      </div>
      ${body}
    `;

    bindAssistantReplyInteractions(element, isAssistant ? [entry] : entry.replies);
    fragment.appendChild(element);
  });

  commandTimeline.appendChild(fragment);
  state.lastRenderedTimelineSize = activeItems.length;
  activeItems
    .filter((entry) => entry.kind === "command")
    .forEach((entry) => {
      persistCommandVisible(entry.command?.id).catch(() => {});
    });
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

function setVoiceStatusMessage(message = "", tone = "") {
  if (!commandVoiceStatus) {
    return;
  }

  commandVoiceStatus.textContent = message;
  commandVoiceStatus.dataset.tone = tone;
  commandVoiceStatus.hidden = !message;
}

function syncVoiceButton() {
  if (!commandVoiceButton) {
    return;
  }

  const isRecording = Boolean(state.voiceRecognitionActive);
  commandVoiceButton.dataset.state = isRecording ? "recording" : "idle";
  commandVoiceButton.setAttribute("aria-pressed", isRecording ? "true" : "false");
  commandVoiceButton.title = isRecording ? "Остановить запись" : "Голосовой ввод";
  commandVoiceButton.setAttribute("aria-label", isRecording ? "Остановить запись" : "Голосовой ввод");
  commandVoiceButton.disabled = !SpeechRecognitionCtor;
}

function joinVoiceText(baseText, nextText) {
  const left = String(baseText || "").trim();
  const right = String(nextText || "").trim();

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return `${left}${/[\s\n]$/.test(baseText) ? "" : " "}${right}`;
}

function stopVoiceRecognition() {
  const recognition = state.voiceRecognition;

  if (!recognition) {
    state.voiceRecognitionActive = false;
    syncVoiceButton();
    return;
  }

  state.voiceRecognitionActive = false;

  try {
    recognition.stop();
  } catch {}

  syncVoiceButton();
}

function ensureVoiceRecognition() {
  if (!SpeechRecognitionCtor) {
    return null;
  }

  if (state.voiceRecognition) {
    return state.voiceRecognition;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "ru-RU";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    state.voiceRecognitionActive = true;
    state.voiceHadResult = false;
    state.voiceTranscriptBase = String(commandInput?.value || "");
    state.voiceDraftText = "";
    setVoiceStatusMessage("Слушаю… говорите.");
    syncVoiceButton();
  });

  recognition.addEventListener("result", (event) => {
    let transcript = "";

    for (let index = 0; index < event.results.length; index += 1) {
      const phrase = String(event.results[index]?.[0]?.transcript || "").trim();

      if (!phrase) {
        continue;
      }

      transcript = transcript ? `${transcript} ${phrase}` : phrase;
    }

    state.voiceHadResult = Boolean(transcript);
    state.voiceDraftText = transcript;

    if (commandInput) {
      commandInput.value = joinVoiceText(state.voiceTranscriptBase, transcript);
    }

    const lastResult = event.results[event.results.length - 1];
    setVoiceStatusMessage(
      lastResult?.isFinal ? "Голос добавлен в сообщение." : "Распознаю речь…",
      lastResult?.isFinal ? "success" : ""
    );
  });

  recognition.addEventListener("error", (event) => {
    state.voiceRecognitionActive = false;
    syncVoiceButton();

    const code = String(event?.error || "").trim();

    if (code === "aborted") {
      return;
    }

    if (code === "not-allowed" || code === "service-not-allowed") {
      setVoiceStatusMessage("Браузер не дал доступ к микрофону.", "error");
      return;
    }

    if (code === "no-speech") {
      setVoiceStatusMessage("Не услышал речь. Попробуйте ещё раз.", "error");
      return;
    }

    if (code === "audio-capture") {
      setVoiceStatusMessage("Микрофон недоступен в этом браузере.", "error");
      return;
    }

    setVoiceStatusMessage("Голосовой ввод не сработал. Попробуйте ещё раз.", "error");
  });

  recognition.addEventListener("end", () => {
    state.voiceRecognitionActive = false;
    syncVoiceButton();

    if (!state.voiceHadResult && !String(state.voiceDraftText || "").trim()) {
      setVoiceStatusMessage("Диктовка остановлена.");
      return;
    }

    state.voiceTranscriptBase = String(commandInput?.value || "");
    state.voiceDraftText = "";
  });

  state.voiceRecognition = recognition;
  return recognition;
}

function toggleVoiceRecognition() {
  if (!SpeechRecognitionCtor) {
    setVoiceStatusMessage("Этот браузер не поддерживает голосовой ввод.", "error");
    syncVoiceButton();
    return;
  }

  const recognition = ensureVoiceRecognition();

  if (!recognition) {
    setVoiceStatusMessage("Голосовой ввод недоступен.", "error");
    return;
  }

  if (state.voiceRecognitionActive) {
    stopVoiceRecognition();
    setVoiceStatusMessage("Останавливаю диктовку…");
    return;
  }

  try {
    recognition.start();
  } catch {
    setVoiceStatusMessage("Не удалось запустить микрофон. Попробуйте ещё раз.", "error");
  }
}

function setResetButtonBusy(isBusy) {
  if (!deliveryResetButton) {
    return;
  }

  deliveryResetButton.disabled = Boolean(isBusy);
  deliveryResetButton.textContent = isBusy ? "Reset…" : "Reset";
}

function syncPhotoClearButton() {
  if (!commandPhotoClear) {
    return;
  }

  commandPhotoClear.disabled = !Boolean(commandPhotoInput?.files?.[0]);
}

function clearSelectedPhoto(message = "Фото не выбрано.", tone = "") {
  if (commandPhotoInput) {
    commandPhotoInput.value = "";
  }

  setPhotoStatusMessage(message, tone);
  syncPhotoClearButton();
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
  const selectedRepo = getMenuRepoById(storage.selectedRepoId);
  const activeRepo = selectedRepo || state.menuRepos[0] || null;
  const hasActiveStatus = Boolean(String(commandStatus?.textContent || "").trim());
  const hasPendingCommand = state.commands.some((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    return status === "queued" || status === "dispatched" || status === "processing";
  });

  if (activeRepo && !selectedRepo) {
    storage.selectedRepoId = activeRepo.id;
  }

  dispatchModeBridgeButton?.classList.toggle("is-active", !isCloud);
  dispatchModeCloudButton?.classList.toggle("is-active", isCloud);
  dispatchModeBridgeButton?.setAttribute("aria-selected", String(!isCloud));
  dispatchModeCloudButton?.setAttribute("aria-selected", String(isCloud));

  if (commandTargetLabel) {
    commandTargetLabel.textContent = "Проект";
  }

  renderProjectNav();
  renderThreadCategories();
  renderThreadSettingsSummary();
  renderThreadSettingsList();
  renderCommandThreads();

  if (!hasPendingCommand && !hasActiveStatus) {
    setCommandStatusMessage(
      activeRepo
        ? isCloud && !isCloudReadyRepo(activeRepo)
          ? `Проект: ${formatProjectPath(activeRepo)} · bridge-only, manifest GitHub repo ещё не подтверждён.`
          : `Проект: ${formatProjectPath(activeRepo)} · ${getProjectStatusLabel(activeRepo)} · отправка через ${isCloud ? "cloud" : "bridge"}.`
        : "Выберите проект."
    );
  }
}

function renderCommandThreads() {
  if (!commandThreadSelect) {
    return;
  }

  const nextOptions = getFilteredMenuOptions();
  const currentValue = String(
    commandThreadSelect.dataset.pendingValue
    || commandThreadSelect.value
    || storage.selectedRepoId
    || ""
  ).trim();

  commandThreadSelect.innerHTML = "";

  if (!nextOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Проекты не найдены";
    commandThreadSelect.appendChild(option);
    commandThreadSelect.disabled = true;
    storage.selectedRepoId = "";
    renderThreadSettingsSummary();
    renderCommands();
    return;
  }

  commandThreadSelect.disabled = false;

  groupSelectableOptions(nextOptions).forEach(({ category, items }) => {
    const group = document.createElement("optgroup");
    group.label = category;

    items.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = `${option.displayLabel} · ${option.statusLabel}`;
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

  storage.selectedRepoId = targetValue;

  renderThreadSettingsSummary();
  renderCommands();
}

async function fetchJsonWithRetry(resource, init = {}, label = "data") {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(resource, init);

      if (!response.ok) {
        throw new Error(`Failed to load ${label}: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      if (attempt < 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    }
  }

  throw lastError || new Error(`Failed to load ${label}.`);
}

async function fetchBridgeStatus() {
  const response = await fetch(`/api/status?_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = String(payload?.message || "").trim();
    throw new Error(message || `Failed to load status: ${response.status}`);
  }

  return response.json();
}

function getCommandFreshnessTs(command) {
  const candidates = [
    command?.progressUpdatedAt,
    command?.completedAt,
    command?.resultAt,
    command?.replyIngestedAt,
    command?.firstReplySeenAt,
    command?.firstExecutorAckSeenAt,
    command?.bridgeClaimedAt,
    command?.dispatchedAt,
    command?.dispatchStartedAt,
    command?.createdAt
  ];

  let freshest = 0;

  candidates.forEach((value) => {
    const parsed = Date.parse(String(value || "").trim());

    if (Number.isFinite(parsed) && parsed > freshest) {
      freshest = parsed;
    }
  });

  return freshest;
}

function getCommandStatePriority(command) {
  const status = String(command?.status || "").trim().toLowerCase();

  if (status === "failed") {
    return 5;
  }

  if (status === "answered" || status === "acked") {
    return 4;
  }

  if (status === "processing") {
    return 3;
  }

  if (status === "dispatched") {
    return 2;
  }

  if (status === "queued") {
    return 1;
  }

  return 0;
}

function mergeCommandCollection(commands) {
  const byId = new Map(
    state.commands.map((command) => [String(command?.id || "").trim(), command])
  );

  (Array.isArray(commands) ? commands : []).forEach((incoming) => {
    const id = String(incoming?.id || "").trim();

    if (!id) {
      return;
    }

    const current = byId.get(id);

    if (!current) {
      byId.set(id, incoming);
      return;
    }

    const incomingFreshness = getCommandFreshnessTs(incoming);
    const currentFreshness = getCommandFreshnessTs(current);
    const shouldPreferIncoming = incomingFreshness > currentFreshness
      || (
        incomingFreshness === currentFreshness
        && getCommandStatePriority(incoming) >= getCommandStatePriority(current)
      );

    if (shouldPreferIncoming) {
      byId.set(id, {
        ...current,
        ...incoming,
        uiVisibleAt: incoming.uiVisibleAt || current.uiVisibleAt || ""
      });
      return;
    }

    byId.set(id, {
      ...incoming,
      ...current,
      uiVisibleAt: current.uiVisibleAt || incoming.uiVisibleAt || ""
    });
  });

  state.commands = [...byId.values()].sort((left, right) =>
    String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
  );
}

function mergeMessageCollection(messages) {
  const byId = new Map(
    state.messages.map((message) => [String(message?.id || "").trim(), message])
  );

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const id = String(message?.id || "").trim();

    if (!id) {
      return;
    }

    byId.set(id, message);
  });

  state.messages = [...byId.values()].sort((left, right) =>
    String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""))
  );
}

function noteNewMessages(previousMessages, nextMessages) {
  const previousCodexReplyIds = new Set(
    previousMessages
      .filter((message) => isCodexDialogMessage(message))
      .map((message) => String(message.id || "").trim())
      .filter(Boolean)
  );
  const previousNotificationIds = new Set(
    previousMessages
      .filter((message) => isNotificationEntry(message))
      .map((message) => String(message.id || "").trim())
      .filter(Boolean)
  );

  const hasNewCodexReply = state.hasLoadedMessagesOnce && nextMessages.some((message) => (
    isCodexDialogMessage(message) && !previousCodexReplyIds.has(String(message.id || "").trim())
  ));
  const hasNewNotification = state.hasLoadedMessagesOnce && nextMessages.some((message) => (
    isNotificationEntry(message) && !previousNotificationIds.has(String(message.id || "").trim())
  ));

  if (hasNewCodexReply || hasNewNotification) {
    playReplySound();
  }

  state.hasLoadedMessagesOnce = true;
}

async function fetchDeliverySnapshot(options = {}) {
  const url = new URL("/api/delivery", window.location.origin);
  url.searchParams.set("scope", "public");
  if (options.activeOnly) {
    url.searchParams.set("activeOnly", "1");
  }
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = String(payload?.message || "").trim();
    throw new Error(message || `Failed to load delivery: ${response.status}`);
  }

  return response.json();
}

function applyDeliverySnapshot(snapshot) {
  const previousMessages = [...state.messages];

  mergeCommandCollection(snapshot?.commands);
  mergeMessageCollection(snapshot?.messages);
  noteNewMessages(previousMessages, state.messages);

  const status = snapshot?.status || {};
  const bridgeStatusText = document.querySelector("#bridge-status-text");
  const bridgeWatchdogText = document.querySelector("#bridge-watchdog-text");

  if (bridgeStatusText) {
    bridgeStatusText.textContent = formatExecutorStatus(status);
  }

  if (bridgeWatchdogText) {
    bridgeWatchdogText.textContent = `Watchdog: ${formatWatchdogMessage(status.lastError)}`;
  }
}

function markCommandVisibleLocally(commandId, uiVisibleAt) {
  state.commands = state.commands.map((command) => (
    String(command?.id || "").trim() === String(commandId || "").trim()
      ? { ...command, uiVisibleAt }
      : command
  ));
}

async function persistCommandVisible(commandId) {
  const normalizedId = String(commandId || "").trim();

  if (!normalizedId || state.visibleCommandUpdates[normalizedId]) {
    return;
  }

  const command = state.commands.find((entry) => String(entry?.id || "").trim() === normalizedId);

  if (!command || String(command?.clientId || "").trim() !== storage.clientId || String(command?.uiVisibleAt || "").trim()) {
    return;
  }

  const uiVisibleAt = new Date().toISOString();
  state.visibleCommandUpdates[normalizedId] = true;
  markCommandVisibleLocally(normalizedId, uiVisibleAt);

  try {
    await fetch("/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        action: "visible",
        id: normalizedId,
        clientId: storage.clientId,
        uiVisibleAt
      })
    });
  } catch {
    delete state.visibleCommandUpdates[normalizedId];
  }
}

async function fetchMenuRepos() {
  const data = await fetchJsonWithRetry(`/api/repos?mode=cloud&_=${Date.now()}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  }, "repos");
  state.menuRepos = Array.isArray(data) ? data : Array.isArray(data?.repos) ? data.repos : [];
}

async function refreshAll() {
  const results = await Promise.allSettled([
    fetchDeliverySnapshot(),
    fetchMenuRepos()
  ]);

  const statusResult = results[0];
  const reposError = results[1].status === "rejected" ? results[1].reason : null;

  if (statusResult.status === "fulfilled") {
    applyDeliverySnapshot(statusResult.value);
  }

  renderDispatchModeUi();

  const hasCachedData = state.commands.length > 0 || state.messages.length > 0;

  if (statusResult.status === "rejected" && hasCachedData) {
    setCommandStatusMessage("Часть данных не обновилась, показываю последнюю доступную версию.", { tone: "error" });
  } else if (statusResult.status === "rejected") {
    setCommandStatusMessage(String(statusResult.reason?.message || "Не удалось обновить состояние."), { tone: "error" });
  } else if (reposError) {
    setCommandStatusMessage("Не удалось обновить список репозиториев.", { tone: "error" });
  } else {
    syncCommandStatusFromState();
  }

  startPolling();
  renderCommands();
}

async function refreshSpeedMode() {
  const snapshot = await fetchDeliverySnapshot({ activeOnly: true });
  applyDeliverySnapshot(snapshot);
  renderDispatchModeUi();
  syncCommandStatusFromState();
  renderCommands();
}

function enterDeliverySpeedMode() {
  state.deliverySpeedUntil = Date.now() + SPEED_POLL_WINDOW_MS;
  state.speedModeClientId = storage.clientId;
}

function isDeliverySpeedModeActive() {
  return state.speedModeClientId === storage.clientId && state.deliverySpeedUntil > Date.now();
}

async function submitCommand(event) {
  event.preventDefault();

  if (state.voiceRecognitionActive) {
    stopVoiceRecognition();
  }

  const uiSubmitStartedAt = new Date().toISOString();
  const text = String(commandInput?.value || "").trim();
  const requestedThreadId = getActiveThreadId();
  const requestedDispatchMode = getActiveDispatchMode();
  const activeRepo = getMenuRepoById(requestedThreadId);
  const fallbackThreadId = requestedThreadId;
  const fallbackThreadLabel = activeRepo ? formatMenuRepoLabel(activeRepo) : getThreadDisplayLabel(fallbackThreadId, "");
  const photoFile = commandPhotoInput?.files?.[0];
  const requestedCloudMode = requestedDispatchMode === "cloud";
  const dispatchMode = requestedDispatchMode;
  const threadId = requestedThreadId;
  const threadLabel = activeRepo?.label || fallbackThreadLabel;

  if (!text && !photoFile) {
    setCommandStatusMessage("Введите сообщение или прикрепите фото.", { tone: "error" });
    return;
  }

  if (!activeRepo) {
    setCommandStatusMessage("Сначала выберите проект.", { tone: "error" });
    return;
  }

  if (requestedCloudMode && !isCloudReadyRepo(activeRepo)) {
    setCommandStatusMessage(`Проект ${formatProjectPath(activeRepo)} сейчас bridge-only. Cloud недоступен без manifest-backed GitHub repo.`, { tone: "error" });
    return;
  }

  setCommandStatusMessage(
    dispatchMode === "cloud"
      ? "Отправляю через cloud…"
      : "Отправляю через bridge…"
  );
  setSubmitProgress("queued", "queued");

  const payload = {
    clientId: storage.clientId,
    uiSubmitStartedAt,
    threadId,
    threadLabel,
    text,
    dispatchMode: dispatchMode === "cloud" ? "cloud" : "local-bridge",
    targetExecutionMode: dispatchMode
  };

  payload.targetRepo = String(activeRepo.targetRepo || "").trim();
  payload.targetRepoUrl = String(activeRepo.targetRepoUrl || "").trim();
  payload.targetContextFiles = Array.isArray(activeRepo.contextFiles) ? activeRepo.contextFiles : [];
  payload.targetWorkspacePath = String(activeRepo.workspacePath || "").trim();
  payload.projectId = String(activeRepo.id || "").trim();
  payload.projectLabel = String(activeRepo.label || "").trim();
  payload.projectCategory = getProjectCategory(activeRepo);

  if (fallbackThreadId) {
    payload.fallbackThreadId = fallbackThreadId;
    payload.fallbackThreadLabel = fallbackThreadLabel;
  }

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
  clearSelectedPhoto();
  mergeCommandCollection([result?.command].filter(Boolean));
  enterDeliverySpeedMode();
  startPolling();
  renderCommands();
  syncCommandStatusFromState();
  setSubmitProgress("queued", "processing");
  setCommandStatusMessage(
    dispatchMode === "cloud"
      ? "Команда создана, выполняю direct cloud dispatch…"
      : "Команда создана, жду bridge claim…",
    { tone: "processing" }
  );

  refreshSpeedMode().catch(() => {});
}

function startPolling() {
  if (state.commandPoller) {
    window.clearInterval(state.commandPoller);
  }

  if (isDeliverySpeedModeActive()) {
    state.commandPollerInterval = SPEED_POLL_INTERVAL_MS;
    state.commandPoller = window.setInterval(async () => {
      if (!isDeliverySpeedModeActive()) {
        startPolling();
        return;
      }

      if (await ensureLatestClient()) {
        return;
      }

      refreshSpeedMode().catch(() => {});
    }, state.commandPollerInterval);
    return;
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
    const activeRepo = getMenuRepoById(storage.selectedRepoId) || state.menuRepos[0] || null;

    if (activeRepo && !isCloudReadyRepo(activeRepo)) {
      state.dispatchMode = "bridge";
      storage.dispatchModePreference = "bridge";
      renderDispatchModeUi();
      setCommandStatusMessage(`Проект ${formatProjectPath(activeRepo)} сейчас bridge-only. Cloud недоступен без manifest-backed GitHub repo.`, { tone: "error" });
      return;
    }

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

  deliveryResetButton?.addEventListener("click", () => {
    runDeliveryReset().catch((error) => {
      setCommandStatusMessage(String(error?.message || "Reset maintenance не выполнился."), { tone: "error" });
    });
  });

  commandForm?.addEventListener("submit", (event) => {
    submitCommand(event).catch((error) => {
      setSubmitProgress("failed", "error");
      setCommandStatusMessage(String(error?.message || "Не удалось отправить сообщение."), { tone: "error" });
    });
  });

  commandVoiceButton?.addEventListener("click", () => {
    toggleVoiceRecognition();
  });

  commandThreadSelect?.addEventListener("change", () => {
    storage.selectedRepoId = canonicalizeRepoSelectionId(commandThreadSelect.value);

    const activeRepo = getMenuRepoById(storage.selectedRepoId);

    if (state.dispatchMode === "cloud" && activeRepo && !isCloudReadyRepo(activeRepo)) {
      state.dispatchMode = "bridge";
      storage.dispatchModePreference = "bridge";
      setCommandStatusMessage(`Проект ${formatProjectPath(activeRepo)} bridge-only. Переключаю на bridge.`, { tone: "error" });
    }

    renderDispatchModeUi();
    renderThreadSettingsSummary();
    renderCommands();
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
      clearSelectedPhoto();
      return;
    }

    const sizeLabel = file.size > 1_000_000
      ? `${(file.size / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1000))} KB`;
    const suffix = getActiveDispatchMode() === "cloud"
      ? " · для фото будет использован bridge"
      : "";
    syncPhotoClearButton();
    setPhotoStatusMessage(`Выбрано фото: ${file.name} (${sizeLabel})${suffix}`);
  });

  commandPhotoClear?.addEventListener("click", () => {
    clearSelectedPhoto("Фото удалено из формы.");
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
    const visibleOptions = state.activeThreadCategories.length
      ? getAllMenuOptions().filter((option) => state.activeThreadCategories.includes(option.category))
      : getAllMenuOptions();
    storage.selectedMenuRepoIds = visibleOptions.map((option) => option.id);
    renderCommandThreads();
    renderThreadSettingsList();
    setCommandStatusMessage("В меню добавлены репозитории из текущих категорий.");
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

  clearSelectedPhoto();
  syncVoiceButton();
  setVoiceStatusMessage(
    SpeechRecognitionCtor ? "" : "Голосовой ввод доступен не во всех браузерах.",
    SpeechRecognitionCtor ? "" : "error"
  );
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
