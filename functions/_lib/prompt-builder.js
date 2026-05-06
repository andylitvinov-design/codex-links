function normalizeText(value) {
  return String(value || "").trim();
}

export function buildSlackCommandPrompt(command, env, resolvedCodexThreadId = "") {
  const threadId = normalizeText(command?.threadId);
  const threadLabel = normalizeText(command?.threadLabel) || threadId || "Links";
  const projectCategory = normalizeText(command?.projectCategory) || "other";
  const projectLabel = normalizeText(command?.projectLabel) || threadLabel;
  const projectId = normalizeText(command?.projectKey) || normalizeText(command?.projectId) || threadId;
  const targetRepo = normalizeText(command?.targetRepo);
  const targetRepoUrl = normalizeText(command?.targetRepoUrl);
  const targetWorkspacePath = normalizeText(command?.targetWorkspacePath);
  const deploy = command?.deploy && typeof command.deploy === "object" ? command.deploy : {};
  const productionBranch = normalizeText(deploy.productionBranch) || "main";
  const productionUrl = normalizeText(deploy.productionUrl);
  const smokePath = normalizeText(deploy.smokePath) || "/";
  const versionPath = normalizeText(deploy.versionPath);
  const codexThreadId = normalizeText(resolvedCodexThreadId) || (/^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(threadId) ? threadId : "");
  const contextFiles = Array.isArray(command?.targetContextFiles) && command.targetContextFiles.length
    ? command.targetContextFiles.map((item) => normalizeText(item)).filter(Boolean)
    : ["AGENTS.md", "README.md", "STATE.md"];

  // Build photo note. When photoFileUrl is present (obtained after Slack file
  // upload), inject a curl command with Authorization header so Codex Cloud can
  // download and read the image directly. Without this Codex only gets a Slack
  // permalink that requires browser auth and always fails with "couldn't complete".
  const photoFileUrl = normalizeText(command?.photoFileUrl);
  const slackBotToken = normalizeText(env?.SLACK_BOT_TOKEN);

  let photoNote = "";

  if (command?.photo) {
    if (photoFileUrl && slackBotToken) {
      photoNote = [
        "",
        "",
        "An image from Codex Links is attached. Download it before starting:",
        `curl -L -o /tmp/codex_photo.png -H "Authorization: Bearer ${slackBotToken}" "${photoFileUrl}"`,
        "Read /tmp/codex_photo.png as the attached image for this task.",
        "Base your answer on concrete visual evidence from the image, not on guesses.",
        "If the download fails or the file is unreadable, say so clearly in-thread instead of pretending you saw it.",
        "The final answer must start with one short sentence describing what you observed in the image."
      ].join("\n");
    } else {
      photoNote = [
        "",
        "",
        "An image from Codex Links is attached in a file reply inside this same Slack thread.",
        "Read the attached image before doing the work.",
        "Base your answer on concrete visual evidence from the image, not on guesses.",
        "If the task is about what is shown in the image, explicitly mention the relevant visible detail you observed before giving the fix or conclusion.",
        "If the image is missing or unreadable, say that clearly in-thread instead of pretending you saw it."
      ].join("\n");
    }
  }

  const repoUrlLine = targetRepoUrl ? `Repository URL: ${targetRepoUrl}` : "";
  const workspacePathLine = targetWorkspacePath ? `Workspace path: ${targetWorkspacePath}` : "";
  const contextLine = contextFiles.length
    ? `Start by reading repo root context files in order: ${contextFiles.join(" -> ")}.`
    : "Start by reading the repo root context files first.";
  const ackLine = `ACK repo=${targetRepo || "unknown"} project=${projectId || "unknown"} command=${normalizeText(command?.id) || "unknown"}`;

  return [
    `${String(env?.SLACK_CODEX_MENTION || "").trim() || ""}`.trim(),
    "New Codex Links task.",
    "",
    `Project: ${projectCategory} / ${projectLabel}`,
    `Project Key: ${projectId}`,
    `Repository: ${targetRepo}`,
    repoUrlLine,
    workspacePathLine,
    productionUrl ? `Production URL: ${productionUrl}` : "",
    productionUrl ? `Production branch: ${productionBranch}` : "",
    productionUrl ? `Production smoke path: ${smokePath}` : "",
    versionPath ? `Production version path: ${versionPath}` : "",
    `Conversation Label: ${threadLabel}`,
    codexThreadId ? `Codex Thread ID: ${codexThreadId}` : "",
    `Command ID: ${normalizeText(command?.id)}`,
    "Mode: work in Codex Cloud only inside the selected repository boundary.",
    "Do not switch to sibling repositories or unrelated workspace folders.",
    "Important: Conversation Label is a human label, not a thread id.",
    "If Codex Thread ID is absent, create or reuse the correct Codex thread inside the target repository yourself.",
    contextLine,
    "Immediately reply in this Slack thread with this exact first acknowledgement line before doing the work:",
    ackLine,
    "Keep every progress update and the final result in the same Slack thread.",
    "Delivery rule: create a branch and PR, never push directly to main.",
    productionUrl
      ? `Production rule: after PR checks pass, merge into ${productionBranch}, wait for production deploy, then verify ${productionUrl}${smokePath === "/" ? "" : smokePath}.`
      : "",
    "Final reply must include this exact structured block:",
    "COMMAND_ID: <command id>",
    "PR_URL: <GitHub PR URL or none>",
    "BRANCH: <branch name or none>",
    "MERGE_COMMIT: <merge commit SHA or none>",
    "LIVE_URL: <production URL or none>",
    "VERIFY_STATUS: <production-verified, blocked, or none>",
    command?.photo
      ? "For photo-based requests, the final answer must start with one short sentence describing what you observed in the image."
      : "",
    "",
    "User request:",
    normalizeText(command?.effectivePrompt || command?.text) || "User sent a photo-only request.",
    photoNote,
    "",
    "Reply in this Slack thread with progress updates. Include the PR URL when ready."
  ]
    .filter(Boolean)
    .join("\n");
}
