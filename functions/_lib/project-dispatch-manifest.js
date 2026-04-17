const PROJECT_DISPATCH_MANIFEST = {
  version: 1,
  updatedAt: "2026-04-17T00:00:00Z",
  projects: [
    {
      id: "links",
      label: "links",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links",
      targetRepo: "andylitvinov-design/codex-links",
      targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: true
    },
    {
      id: "artefacts",
      label: "artefacts",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/artefacts",
      targetRepo: "andylitvinov-design/artefacts",
      targetRepoUrl: "https://github.com/andylitvinov-design/artefacts",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: true
    },
    {
      id: "alchemist",
      label: "alchemy",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/alchemist",
      targetRepo: "",
      targetRepoUrl: "",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: false
    },
    {
      id: "sales",
      label: "sales",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/sales",
      targetRepo: "",
      targetRepoUrl: "",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: false
    },
    {
      id: "ezohata",
      label: "ezohata",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/ezohata",
      targetRepo: "",
      targetRepoUrl: "",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: false
    },
    {
      id: "management",
      label: "management",
      group: "brain",
      workspacePath: "/Users/andriilitvinov/projects/brain/management",
      targetRepo: "andylitvinov-design/brain-management",
      targetRepoUrl: "https://github.com/andylitvinov-design/brain-management",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: true
    },
    {
      id: "advice",
      label: "advice",
      group: "brain",
      workspacePath: "/Users/andriilitvinov/projects/brain/advice",
      targetRepo: "",
      targetRepoUrl: "",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      visible: true,
      cloudReady: false
    }
  ]
};

function normalizeText(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeContextFiles(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => normalizeText(entry, 80))
      .filter(Boolean)
  )];
}

function normalizeProjectId(value) {
  return normalizeText(value, 120).toLowerCase();
}

function normalizeAliases(values, fallback = []) {
  return [...new Set(
    [...(Array.isArray(values) ? values : []), ...(Array.isArray(fallback) ? fallback : [])]
      .map((value) => normalizeProjectId(value))
      .filter(Boolean)
  )];
}

function normalizeProjectEntry(project) {
  if (!project || typeof project !== "object") {
    return null;
  }

  const id = normalizeProjectId(project.id);
  const label = normalizeText(project.label, 160);
  const group = normalizeText(project.group, 120) || "other";
  const workspacePath = normalizeText(project.workspacePath, 500);
  const targetRepo = normalizeText(project.targetRepo, 240);
  const targetRepoUrl = normalizeText(project.targetRepoUrl, 400);
  const contextFiles = normalizeContextFiles(project.contextFiles);
  const aliases = normalizeAliases(project.aliases, [id, label]);
  const visible = normalizeBoolean(project.visible);
  const cloudReady = normalizeBoolean(project.cloudReady) && Boolean(targetRepo);

  if (!id || !label) {
    return null;
  }

  return {
    id,
    repoId: id,
    label,
    name: label,
    nameWithOwner: targetRepo,
    url: targetRepoUrl,
    updatedAt: PROJECT_DISPATCH_MANIFEST.updatedAt,
    isPrivate: false,
    contextReady: Boolean(contextFiles.length),
    contextFiles,
    workspacePath,
    category: group,
    group,
    displayLabel: label,
    targetRepo,
    targetRepoUrl,
    aliases,
    visible,
    cloudReady,
    statusLabel: cloudReady ? "cloud-ready" : "bridge-only"
  };
}

function getNormalizedManifestProjects() {
  return PROJECT_DISPATCH_MANIFEST.projects
    .map((project) => normalizeProjectEntry(project))
    .filter(Boolean);
}

export function findProjectTargetById(projectId) {
  const normalizedId = normalizeProjectId(projectId);

  if (!normalizedId) {
    return null;
  }

  return getNormalizedManifestProjects().find((project) =>
    project.id === normalizedId || (Array.isArray(project.aliases) && project.aliases.includes(normalizedId))
  ) || null;
}

export function resolveProjectDispatchTarget(input = {}) {
  const project = findProjectTargetById(input.threadId || input.projectId || input.id);
  const dispatchMode = normalizeText(input.dispatchMode, 80).toLowerCase();
  const providedTargetRepo = normalizeText(input.targetRepo, 240).toLowerCase();
  const providedTargetRepoUrl = normalizeText(input.targetRepoUrl, 400);
  const providedWorkspacePath = normalizeText(input.targetWorkspacePath, 500);
  const providedContextFiles = normalizeContextFiles(input.targetContextFiles);
  const projectId = normalizeProjectId(input.projectId || input.threadId || input.id) || project?.id || "links";
  const projectLabel = normalizeText(input.projectLabel, 160) || project?.label || projectId;
  const projectGroup = normalizeText(input.projectCategory, 120) || project?.group || "other";

  if (!project && !providedTargetRepo) {
    return {
      ok: false,
      error: "Selected project is not present in the dispatch manifest."
    };
  }

  if (project && !project.visible) {
    return {
      ok: false,
      error: "Selected project is not present in the dispatch manifest."
    };
  }

  const effectiveTargetRepo = providedTargetRepo || project?.targetRepo || "";
  const effectiveTargetRepoUrl = providedTargetRepoUrl || project?.targetRepoUrl || "";
  const effectiveWorkspacePath = providedWorkspacePath || project?.workspacePath || "";
  const effectiveContextFiles = providedContextFiles.length ? providedContextFiles : (project?.contextFiles || []);

  const needsCloudRepo = dispatchMode === "cloud" || dispatchMode === "slack-codex-cloud";

  if (needsCloudRepo && !effectiveTargetRepo) {
    return {
      ok: false,
      error: `Project ${projectLabel} is bridge-only until a manifest-backed GitHub repository is confirmed.`
    };
  }

  return {
    ok: true,
    value: {
      id: projectId,
      label: projectLabel,
      group: projectGroup,
      workspacePath: effectiveWorkspacePath,
      targetRepo: effectiveTargetRepo,
      targetRepoUrl: effectiveTargetRepoUrl,
      contextFiles: effectiveContextFiles,
      visible: project?.visible ?? true,
      cloudReady: Boolean(effectiveTargetRepo)
    }
  };
}

export function listVisibleProjectTargets() {
  const repos = getNormalizedManifestProjects()
    .filter((project) => project.visible)
    .map((project) => ({ ...project }));

  return {
    repos,
    generatedAt: new Date().toISOString(),
    source: "project-dispatch-manifest"
  };
}

export { PROJECT_DISPATCH_MANIFEST };
