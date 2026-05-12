#!/usr/bin/env bash
set -euo pipefail

started_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
binary="openclaw"
binary_path="$(command -v "${binary}" 2>/dev/null || true)"
version_output="needs verification"
command_supported="false"
run_supported="false"
status="not_installed"
stdout_summary=""
stderr_summary=""
needs_verification="true"
probe_timed_out="false"

summarize() {
  printf '%s' "${1:-}" \
    | tr '\n\r\t' '   ' \
    | tr -cd '[:print:]' \
    | cut -c 1-240
}

summarize_status_json() {
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(input);
        const summary = [
          `runtime=${data.runtimeVersion || "unknown"}`,
          `gatewayReachable=${Boolean(data.gateway && data.gateway.reachable)}`,
          `gatewayError=${data.gateway && data.gateway.error ? data.gateway.error : "none"}`,
          `gatewayService=${data.gatewayService && data.gatewayService.runtimeShort ? data.gatewayService.runtimeShort : "unknown"}`,
          `tasksActive=${data.tasks && Number.isFinite(data.tasks.active) ? data.tasks.active : "unknown"}`
        ].join("; ");
        process.stdout.write(summary);
      } catch {
        process.stdout.write(input);
      }
    });
  '
}

finish() {
  local finished_ms duration_ms
  finished_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
  duration_ms="$((finished_ms - started_ms))"

  printf 'status=%s\n' "${status}"
  printf 'binary=%s\n' "${binary_path:-${binary}}"
  printf 'version=%s\n' "$(summarize "${version_output}")"
  printf 'command_supported=%s\n' "${command_supported}"
  printf 'run_supported=%s\n' "${run_supported}"
  printf 'stdout_summary=%s\n' "$(summarize "${stdout_summary}")"
  printf 'stderr_summary=%s\n' "$(summarize "${stderr_summary}")"
  printf 'duration_ms=%s\n' "${duration_ms}"
  printf 'needs_verification=%s\n' "${needs_verification}"
}

if [[ -z "${binary_path}" ]]; then
  stderr_summary="OpenClaw binary was not found on PATH."
  finish
  exit 1
fi

safe_env=(env -i "PATH=${PATH:-/usr/bin:/bin}" "HOME=${HOME:-}" "TMPDIR=${TMPDIR:-/tmp}")

version_output="$("${safe_env[@]}" "${binary_path}" --version 2>&1 | head -n 1 || true)"
help_output="$("${safe_env[@]}" "${binary_path}" --help 2>&1 || true)"

if grep -Eq '(^|[[:space:]])status([[:space:]]|$)' <<<"${help_output}"; then
  command_supported="true"
fi

if [[ "${command_supported}" != "true" ]]; then
  status="needs_verification"
  stderr_summary="No safe non-destructive status command was found in openclaw --help."
  finish
  exit 0
fi

set +e
probe_stderr_file="$(mktemp "${TMPDIR:-/tmp}/openclaw-probe-stderr.XXXXXX")"
probe_stdout_file="$(mktemp "${TMPDIR:-/tmp}/openclaw-probe-stdout.XXXXXX")"
probe_meta_file="$(mktemp "${TMPDIR:-/tmp}/openclaw-probe-meta.XXXXXX")"
trap 'rm -f "${probe_stdout_file:-}" "${probe_stderr_file:-}" "${probe_meta_file:-}"' EXIT
node - "${binary_path}" "${probe_stdout_file}" "${probe_stderr_file}" "${probe_meta_file}" <<'NODE'
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");

const [, , binary, stdoutPath, stderrPath, metaPath] = process.argv;
let stdout = "";
let stderr = "";
let timedOut = false;

const child = spawn(binary, ["status", "--json", "--timeout", "2000"], {
  env: {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || "",
    TMPDIR: process.env.TMPDIR || "/tmp"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000).unref();
}, 20000);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.on("error", (error) => { stderr += String(error && error.message ? error.message : error); });
child.on("close", (code, signal) => {
  clearTimeout(timeout);
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);
  writeFileSync(metaPath, JSON.stringify({ code, signal, timedOut }));
});
NODE
node_exit=$?
probe_output="$(cat "${probe_stdout_file}")"
probe_stderr="$(cat "${probe_stderr_file}")"
probe_exit="$(node -e 'const fs=require("fs"); const p=process.argv[1]; let d={code:1,timedOut:false}; try { d=JSON.parse(fs.readFileSync(p,"utf8")); } catch {} process.stdout.write(String(d.code === null ? 124 : d.code));' "${probe_meta_file}")"
probe_timed_out="$(node -e 'const fs=require("fs"); const p=process.argv[1]; let d={timedOut:false}; try { d=JSON.parse(fs.readFileSync(p,"utf8")); } catch {} process.stdout.write(d.timedOut ? "true" : "false");' "${probe_meta_file}")"
if [[ ${node_exit} -ne 0 ]]; then
  probe_exit="${node_exit}"
fi
set -e

if [[ "${probe_exit}" == "0" ]]; then
  status="ok"
  stdout_summary="$(summarize_status_json <<<"${probe_output}")"
  stderr_summary="${probe_stderr}"
  needs_verification="true"
else
  status="needs_verification"
  stdout_summary="$(summarize_status_json <<<"${probe_output}")"
  stderr_summary="openclaw status --json --timeout 2000 exited with code ${probe_exit}. ${probe_stderr}"
  if [[ "${probe_timed_out}" == "true" ]]; then
    stderr_summary="openclaw status --json --timeout 2000 exceeded external 20000ms timeout. ${probe_stderr}"
  fi
fi

finish
