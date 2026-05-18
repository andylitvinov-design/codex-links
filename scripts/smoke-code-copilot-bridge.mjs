#!/usr/bin/env node
import {
  buildReviewerPrompt,
  callLocalModel,
  readConfig
} from "./code-copilot-bridge.mjs";

function printStep(name, value = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), step: name, ...value }));
}

async function main() {
  const config = readConfig({
    ...process.env,
    LINKS_WRITE_TOKEN: process.env.LINKS_WRITE_TOKEN || "smoke-not-required"
  });

  printStep("config", {
    provider: config.provider,
    model: config.model,
    ollamaUrl: config.provider === "ollama" ? config.ollamaUrl : undefined,
    lmstudioUrl: config.provider !== "ollama" ? config.lmstudioUrl : undefined
  });

  const prompt = buildReviewerPrompt({
    id: "smoke",
    text: "Repo: andylitvinov-design/finance\nLive URL: https://ezohata-incoming-ledger.vercel.app\n\nUser report: Prompt Router smoke test.\n\nFirst prove the failing layer before patching."
  });

  const started = Date.now();
  const answer = await callLocalModel(config, prompt);
  const durationMs = Date.now() - started;

  printStep("local-model-response", {
    durationMs,
    answerLength: answer.length,
    excerpt: answer.slice(0, 300)
  });

  if (!answer.trim()) {
    throw new Error("Local Code Copilot model returned an empty answer.");
  }

  printStep("ok", { status: "local_code_copilot_smoke_passed" });
}

main().catch((error) => {
  console.error(JSON.stringify({
    at: new Date().toISOString(),
    step: "failed",
    error: String(error?.message || error)
  }));
  process.exit(1);
});
