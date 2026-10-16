import { isStandbyEnabled, standbyResponse } from "../_lib/standby.js";

// Applies only to /api/*, so regular static Pages assets do not invoke this guard.
export async function onRequest(context) {
  return isStandbyEnabled(context.env) ? standbyResponse() : context.next();
}
