import { spawn } from "node:child_process";

export async function withCodexAppServer(run) {
  const codexBin = process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";
  const child = spawn(codexBin, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let nextId = 1;
  let buffer = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;

    while (true) {
      const newlineIndex = buffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let message;

      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (typeof message.id === "undefined") {
        continue;
      }

      const resolver = pending.get(message.id);

      if (!resolver) {
        continue;
      }

      pending.delete(message.id);

      if (message.error) {
        resolver.reject(new Error(message.error.message || "Unknown app-server error."));
      } else {
        resolver.resolve(message.result);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", () => {});

  function request(method, params) {
    const id = nextId;
    nextId += 1;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${payload}\n`);
    });
  }

  try {
    await request("initialize", {
      clientInfo: {
        name: "codex-links-bridge",
        title: "Codex Links Bridge",
        version: "1.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });

    return await run({ request });
  } finally {
    child.kill();
  }
}
