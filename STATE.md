# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: держать Slack-backed cloud как default executor, direct OpenAI как опциональный путь, и не оставлять bridge-команды в вечном `waiting-for-codex`
- next step: прогнать production smoke для `cloud-via-slack` и bridge, затем отдельно проверить opt-in `direct-openai`
- known live failure mode: `photo-finalization stall` where the message becomes visible before the linked command reaches terminal state, leaving the yellow processing badge visible too long
