import { createKvReadGuard } from "../../../functions/_lib/kv-read-guard.js";

// Separate Pages project, separate marker. No default standby or write blocking.
export const onRequest = createKvReadGuard({
  binding: "SAVE_STORE",
  scope: "save-v1",
  run: context => context.next()
});
