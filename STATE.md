# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: держать Slack-backed cloud как default executor, direct OpenAI как опциональный путь, и не оставлять bridge-команды в вечном `waiting-for-codex`
- next step: прогнать production smoke для `cloud-via-slack` и bridge, затем отдельно проверить opt-in `direct-openai`

## 2026-05-12 OpenClaw Readiness

- local status: installed, `openclaw` at `/Users/andriilitvinov/.npm-global/bin/openclaw`, version `OpenClaw 2026.4.26 (be8c246)`
- verification command: `bash scripts/check-openclaw.sh`
- integration status: readiness layer only; OpenClaw is not an active executor in production dispatch
- next action: add an explicit `openclaw` local executor mode only after command execution, auth, daemon/gateway state, artifact output, and telemetry are verified
