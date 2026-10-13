import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origin = "https://codex-links.pages.dev";
const assets = ["version.json", "app.js", "index.html"];

export function validateRelease(files) {
  const build = JSON.parse(files["version.json"]).build;
  if (typeof build !== "string" || !/^\d{8}-\d{4}$/.test(build)) {
    throw new Error("Invalid release build marker.");
  }
  const appBuild = files["app.js"].match(/const BUILD_VERSION = "([^"]+)";/)?.[1];
  const indexBuild = files["index.html"].match(/var build = "([^"]+)";/)?.[1];
  if (appBuild !== build || indexBuild !== build ||
      !files["index.html"].includes(`/app.js?v=${build}`) ||
      !files["index.html"].includes(`/styles.css?v=${build}`)) {
    throw new Error("Release markers or cache-busting URLs disagree.");
  }
  return build;
}

export async function readRelease(directory = "public") {
  const files = Object.fromEntries(await Promise.all(assets.map(async name =>
    [name, await readFile(resolve(directory, name), "utf8")]
  )));
  return { build: validateRelease(files), files };
}

export async function verifyProduction(local, { fetchImpl = fetch, nonce = Date.now() } = {}) {
  const remote = {};
  // Only these three static files; never execute the app or call application APIs.
  for (const name of assets) {
    // Pages canonicalizes /index.html to /; request the final static route directly.
    const path = name === "index.html" ? "/" : `/${name}`;
    const response = await fetchImpl(`${origin}${path}?release_check=${nonce}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Static verification HTTP ${response.status}: ${name}`);
    remote[name] = await response.text();
  }
  if (validateRelease(remote) !== local.build) throw new Error("Production build does not match expected build.");
  // Exact bytes strengthen marker proof; still not independent server-function SHA proof.
  for (const name of assets) {
    if (remote[name] !== local.files[name]) throw new Error(`Production static file differs: ${name}`);
  }
  return local.build;
}

async function main() {
  const local = await readRelease();
  if (process.argv[2] === "--local") {
    console.log(`build=${local.build}`);
    return;
  }
  if (process.argv[2] !== "--production") throw new Error("Choose --local or --production.");
  if (process.env.EXPECTED_BUILD !== local.build) throw new Error("Checked-out build differs from tested build.");
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await verifyProduction(local);
      console.log(`Verified production static build ${local.build}.`);
      return;
    } catch (error) {
      console.error(`Propagation check ${attempt}/12: ${error.message}`);
      if (attempt === 12) throw error;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
