const $ = (id) => document.getElementById(id);

const fields = {
  project: $("project"),
  repo: $("repo"),
  liveUrl: $("liveUrl"),
  category: $("category"),
  problem: $("problem"),
  prompt: $("prompt"),
  rewrittenPrompt: $("rewrittenPrompt"),
  verificationResult: $("verificationResult"),
  status: $("status")
};

function setStatus(message, type = "") {
  fields.status.textContent = message;
  fields.status.className = `status ${type}`.trim();
}

function readPayload(promptOverride) {
  return {
    project: fields.project.value,
    repo: fields.repo.value,
    liveUrl: fields.liveUrl.value,
    category: fields.category.value,
    problem: fields.problem.value,
    prompt: promptOverride ?? fields.prompt.value
  };
}

function fillFromParams() {
  const params = new URLSearchParams(window.location.search);
  const entries = ["project", "repo", "liveUrl", "category", "problem", "prompt"];

  for (const key of entries) {
    const value = params.get(key);
    if (value !== null && fields[key]) {
      fields[key].value = value;
    }
  }

  if (!fields.prompt.value.trim() && fields.problem.value.trim()) {
    fields.prompt.value = `Repo: ${fields.repo.value}\nLive URL: ${fields.liveUrl.value}\n\nUser report:\n${fields.problem.value}\n\nFirst prove the failing layer before patching.`;
  }
}

function renderVerification(result) {
  if (!result?.ok) {
    fields.verificationResult.textContent = JSON.stringify(result, null, 2);
    return;
  }

  fields.verificationResult.textContent = [
    `Score: ${result.score}/10`,
    `Verdict: ${result.verdict}`,
    "",
    "Problem understanding:",
    result.problemUnderstanding,
    "",
    "Weaknesses:",
    ...(result.weaknesses?.length ? result.weaknesses.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Recommendations:",
    ...(result.recommendations?.length ? result.recommendations.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Passed checks:",
    ...(result.passedChecks?.length ? result.passedChecks.map((item) => `- ${item}`) : ["- none"])
  ].join("\n");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { ok: false, error: "non_json_response", excerpt: text.slice(0, 300) };
  }

  if (!response.ok && data) {
    data.httpStatus = response.status;
  }

  return data;
}

async function verifyPrompt(useRewritten = false) {
  const sourcePrompt = useRewritten && fields.rewrittenPrompt.value.trim()
    ? fields.rewrittenPrompt.value
    : fields.prompt.value;

  setStatus("Verifying prompt...", "warn");
  const result = await postJson("/api/prompt-router/verify", readPayload(sourcePrompt));
  renderVerification(result);

  if (result?.rewrittenPrompt) {
    fields.rewrittenPrompt.value = result.rewrittenPrompt;
  }

  setStatus(result?.ok ? "Verification complete." : "Verification failed.", result?.ok ? "ok" : "bad");
}

async function sendTo(target) {
  const prompt = fields.rewrittenPrompt.value.trim() || fields.prompt.value.trim();

  if (!prompt) {
    setStatus("Prompt is empty.", "bad");
    return;
  }

  setStatus(`Sending to ${target}...`, "warn");
  const result = await postJson("/api/prompt-router/send", {
    ...readPayload(prompt),
    target
  });

  if (result?.prompt && (result.mode === "prompt-only" || !result.commandId)) {
    fields.rewrittenPrompt.value = result.prompt;
  }

  setStatus(JSON.stringify({
    ok: result?.ok,
    mode: result?.mode,
    target: result?.target,
    commandId: result?.commandId,
    status: result?.status,
    dispatch: result?.dispatch
  }, null, 2), result?.ok ? "ok" : "bad");
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  setStatus("Copied to clipboard.", "ok");
}

$("verifyPrompt").addEventListener("click", () => verifyPrompt(false));
$("rewritePrompt").addEventListener("click", () => verifyPrompt(false));
$("verifyAgain").addEventListener("click", () => verifyPrompt(true));
$("sendCodex").addEventListener("click", () => sendTo("codex"));
$("sendClaude").addEventListener("click", () => sendTo("claude-code"));
$("sendCopilot").addEventListener("click", () => sendTo("code-copilot"));
$("createIssue").addEventListener("click", () => sendTo("github-issue"));
$("copyPrompt").addEventListener("click", () => copyText(fields.prompt.value));
$("copyRewritten").addEventListener("click", () => copyText(fields.rewrittenPrompt.value || fields.prompt.value));

fillFromParams();
