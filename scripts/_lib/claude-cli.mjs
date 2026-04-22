import { execFile } from "node:child_process";

export const DEFAULT_CLAUDE_BIN = "/Users/andriilitvinov/.npm-global/bin/claude";

export function resolveClaudeBin(env = process.env) {
  return String(env?.CLAUDE_BIN || DEFAULT_CLAUDE_BIN).trim() || DEFAULT_CLAUDE_BIN;
}

export async function validateClaudeCli(options = {}) {
  const env = options.env || process.env;
  const claudeBin = resolveClaudeBin(env);
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 10_000);

  return new Promise((resolve, reject) => {
    execFile(claudeBin, ["--version"], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        ...env
      }
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || `Claude CLI failed: ${claudeBin}`)));
        return;
      }

      const version = String(stdout || stderr || "").trim();

      if (!version) {
        reject(new Error(`Claude CLI did not return a version string: ${claudeBin}`));
        return;
      }

      resolve({
        claudeBin,
        version
      });
    });
  });
}
