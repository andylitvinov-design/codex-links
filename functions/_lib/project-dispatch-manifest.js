const PROJECT_DISPATCH_MANIFEST = {
  version: 2,
  updatedAt: "2026-05-05T00:00:00Z",
  projects: [
    {
      id: "links",
      label: "links",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links",
      targetRepo: "andylitvinov-design/codex-links",
      targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      deploy: {
        platform: "cloudflare-pages",
        productionBranch: "main",
        productionUrl: "https://codex-links.pages.dev/",
        smokePath: "/",
        versionPath: "/version.json"
      },
      codexCloud: {
        environmentName: "codex-links",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "deploy-check"]
      },
      visible: true,
      cloudReady: true
    },
    {
      id: "finance",
      label: "finance",
      group: "finance",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/finance",
      targetRepo: "andylitvinov-design/finance",
      targetRepoUrl: "https://github.com/andylitvinov-design/finance",
      aliases: ["ezohata-ledger", "ledger", "incoming-ledger"],
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      deploy: {
        platform: "vercel",
        productionBranch: "main",
        productionUrl: "https://ezohata-incoming-ledger.vercel.app/",
        smokePath: "/api/status"
      },
      codexCloud: {
        environmentName: "finance",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "pr"]
      },
      visible: true,
      cloudReady: true
    },
    {
      id: "reiki-yggdrasil",
      label: "reiki yggdrasil",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/reiki-yggdrasil",
      targetRepo: "andylitvinov-design/reiki-yggdrasil",
      targetRepoUrl: "https://github.com/andylitvinov-design/reiki-yggdrasil",
      aliases: ["reiki", "yggdrasil"],
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      codexCloud: {
        environmentName: "reiki-yggdrasil",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "design-check"]
      },
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
      aliases: ["artifacts", "artifacts-site", "artefacts-site"],
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      codexCloud: {
        environmentName: "artefacts",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "content"]
      },
      visible: true,
      cloudReady: true
    },
    {
      id: "ai-projects-brain",
      label: "ai projects brain",
      group: "brain",
      workspacePath: "/Users/andriilitvinov/projects/brain/ai-projects-brain",
      targetRepo: "andylitvinov-design/ai-projects-brain",
      targetRepoUrl: "https://github.com/andylitvinov-design/ai-projects-brain",
      aliases: ["project-brain", "projects-brain", "brain-base"],
      contextFiles: ["AGENTS.md", "README.md", "STATE.md", "systems/agent-rules.md", "systems/codex-project-workflow.md"],
      codexCloud: {
        environmentName: "ai-projects-brain",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["docs", "memory-update", "audit"]
      },
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
      targetRepo: "andylitvinov-design/ezohata",
      targetRepoUrl: "https://github.com/andylitvinov-design/ezohata",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      codexCloud: {
        environmentName: "ezohata",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "content"]
      },
      visible: true,
      cloudReady: true
    },
    {
      id: "ezohata_ads",
      label: "ezohata ads",
      group: "myprojects",
      workspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/ezohata_ads",
      targetRepo: "andylitvinov-design/ezohata_ads",
      targetRepoUrl: "https://github.com/andylitvinov-design/ezohata_ads",
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      codexCloud: {
        environmentName: "ezohata_ads",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "content"]
      },
      visible: true,
      cloudReady: true
    },
    {
      id: "management",
      label: "management",
      group: "brain",
      workspacePath: "/Users/andriilitvinov/projects/brain/management",
      targetRepo: "andylitvinov-design/brain-management",
      targetRepoUrl: "https://github.com/andylitvinov-design/brain-management",
      aliases: ["brain-management"],
      contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      codexCloud: {
        environmentName: "brain-management",
        environmentId: "needs-verification",
        defaultBranch: "main",
        dispatchMode: "cloud-via-slack",
        allowedActions: ["audit", "fix", "test", "dashboard"]
      },
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

function normalizeAllowedActions(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => normalizeProjectId(entry))
      .filter(Boolean)
  )];
}

function normalizeCodexCloudConfig(value, targetRepo = "") {
  const source = value && typeof value === "object" ? value : {};
  const environmentName = normalizeText(source.environmentName, 160);
  const environmentId = normalizeText(source.environmentId, 160);
  const defaultBranch = normalizeText(source.defaultBranch, 120) || "main";
  const dispatchMode = normalizeText(source.dispatchMode, 80) || "cloud-via-slack";
  const allowedActions = normalizeAllowedActions(source.allowedActions);

  if (!targetRepo && !environmentName && !environmentId) {
    return null;
  }

  return {
    environmentName,
    environmentId: environmentId || "needs-verification",
    defaultBranch,
    dispatchMode,
    allowedActions,
    verified: Boolean(environmentId && environmentId !== "needs-verification")
  };
}

function normalizeDeployConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const platform = normalizeText(source.platform, 80);
  const productionBranch = normalizeText(source.productionBranch, 120) || "main";
  const productionUrl = normalizeText(source.productionUrl, 400);
  const smokePath = normalizeText(source.smokePath, 160) || "/";
  const versionPath = normalizeText(source.versionPath, 160);

  if (!platform && !productionUrl) {
    return null;
  }

  return {
    platform,
    productionBranch,
    productionUrl,
    smokePath,
    versionPath
  };
}

function isProductionChangingText(value) {
  const text = normalizeText(value, 4000).toLowerCase();

  if (!text) {
    return false;
  }

  return /(^|\b)(fix|update|change|implement|deploy|merge|pull request|pr|production|site|ui|css|html|app|release|исправ|обнов|измени|сделай|задеплой|деплой|сайт|продакшн)(\b|$)/i.test(text);
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
  const deploy = normalizeDeployConfig(project.deploy);
  const codexCloud = normalizeCodexCloudConfig(project.codexCloud, targetRepo);
  const aliases = normalizeAliases(project.aliases, [id, label]);
  const visible = normalizeBoolean(project.visible);
  const cloudReady = normalizeBoolean(project.cloudReady) && Boolean(targetRepo);

  if (!id || !label) {
    return null;
  }

  return {
    id,
    projectKey: id,
    repoId: id,
    label,
    name: label,
    nameWithOwner: targetRepo,
    url: targetRepoUrl,
    updatedAt: PROJECT_DISPATCH_MANIFEST.updatedAt,
    isPrivate: false,
    contextReady: Boolean(contextFiles.length),
    contextFiles,
    deploy,
    productionVerifiable: Boolean(deploy?.productionUrl),
    codexCloud,
    codexEnvironmentName: codexCloud?.environmentName || "",
    codexEnvironmentId: codexCloud?.environmentId || "",
    codexEnvironmentVerified: Boolean(codexCloud?.verified),
    defaultBranch: codexCloud?.defaultBranch || deploy?.productionBranch || "main",
    allowedActions: codexCloud?.allowedActions || [],
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
  const project = findProjectTargetById(input.projectKey || input.projectId || input.threadId || input.id);
  const dispatchMode = normalizeText(input.dispatchMode, 80).toLowerCase();
  const providedTargetRepo = normalizeText(input.targetRepo, 240).toLowerCase();
  const providedTargetRepoUrl = normalizeText(input.targetRepoUrl, 400);
  const providedWorkspacePath = normalizeText(input.targetWorkspacePath, 500);
  const providedContextFiles = normalizeContextFiles(input.targetContextFiles);
  const projectId = project?.id || normalizeProjectId(input.projectKey || input.projectId || input.threadId || input.id) || "links";
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
  const effectiveDeploy = normalizeDeployConfig(input.deploy) || project?.deploy || null;
  const effectiveCodexCloud = normalizeCodexCloudConfig(input.codexCloud, effectiveTargetRepo) || project?.codexCloud || null;

  const needsCloudRepo = dispatchMode === "cloud" || dispatchMode === "slack-codex-cloud" || dispatchMode === "cloud-via-slack";
  const needsProductionVerification = needsCloudRepo && isProductionChangingText(input.text || input.effectivePrompt);

  if (needsCloudRepo && !effectiveTargetRepo) {
    return {
      ok: false,
      error: `Project ${projectLabel} is bridge-only until a manifest-backed GitHub repository is confirmed.`
    };
  }

  if (needsProductionVerification && !effectiveDeploy?.productionUrl) {
    return {
      ok: false,
      code: "setup-needed",
      error: `Project ${projectLabel} needs deploy metadata before production-changing cloud tasks can be guaranteed.`
    };
  }

  return {
    ok: true,
    value: {
      id: projectId,
      projectKey: projectId,
      label: projectLabel,
      group: projectGroup,
      workspacePath: effectiveWorkspacePath,
      targetRepo: effectiveTargetRepo,
      targetRepoUrl: effectiveTargetRepoUrl,
      contextFiles: effectiveContextFiles,
      deploy: effectiveDeploy,
      codexCloud: effectiveCodexCloud,
      codexEnvironmentName: effectiveCodexCloud?.environmentName || "",
      codexEnvironmentId: effectiveCodexCloud?.environmentId || "",
      codexEnvironmentVerified: Boolean(effectiveCodexCloud?.verified),
      defaultBranch: effectiveCodexCloud?.defaultBranch || effectiveDeploy?.productionBranch || "main",
      allowedActions: effectiveCodexCloud?.allowedActions || [],
      productionVerifiable: Boolean(effectiveDeploy?.productionUrl),
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
