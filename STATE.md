# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: сохранить подтверждённую photo-stable live точку и держать `bridge` и `cloud -> bridge` photo delivery рабочими на production
- saved rollback point: production build `20260418-1518`
- saved rollback commit: `53691ee7af31c3353bb4023cf0cd5fff0cdacdc0`
- saved rollback git tag: `saved/live-20260418-1518`
- last confirmed live proof:
  - `Bridge` photo `79bcae9d-b1b2-49b8-98aa-f34a37f4457a` -> `answered`
  - `Cloud` photo `4113f59d-9aa5-45ad-9e5b-4cb107ee748c` -> `bridge` -> `answered`
- next step: при следующем risky change сначала проверять photo smoke по обоим путям, затем уже менять routing/UI
