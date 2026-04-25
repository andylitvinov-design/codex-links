/** Window for treating a newly submitted command as a recent duplicate. */
export const RECENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
/** Window for treating an older matching command as superseded. */
export const SUPERSEDED_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
/** Time allowed for direct cloud execution to acknowledge a command. */
export const CLOUD_FIRST_ACK_TIMEOUT_MS = 15 * 1000;
/** Time allowed for direct cloud execution to produce a result. */
export const CLOUD_RESULT_TIMEOUT_MS = 180 * 1000;
/** Time allowed for Slack-backed cloud execution to acknowledge a text command. */
export const SLACK_FIRST_ACK_TIMEOUT_MS = 60 * 1000;
/** Time allowed for Slack-backed cloud execution to produce a text result. */
export const SLACK_RESULT_TIMEOUT_MS = 120 * 1000;
/** Time allowed for Slack-backed cloud execution to acknowledge a photo command. */
export const SLACK_PHOTO_FIRST_ACK_TIMEOUT_MS = 90 * 1000;
/** Time allowed for Slack-backed cloud execution to produce a photo result. */
export const SLACK_PHOTO_RESULT_TIMEOUT_MS = 300 * 1000;
/** Recovery window after Slack actor validation fails. */
export const SLACK_ACTOR_VALIDATION_RECOVERY_MS = 15 * 1000;
/** Grace period for Slack dispatch thread creation before fallback checks. */
export const SLACK_DISPATCH_GRACE_MS = 15_000;
/** Poll interval while waiting for Slack replies after dispatch. */
export const SLACK_SYNC_POLL_MS = 2_000;
/** Read budget for opportunistic Slack sync during command list reads. */
export const READ_SLACK_SYNC_BUDGET_MS = 2_500;
/** Read budget for Slack sync of a specific command. */
export const READ_SPECIFIC_SLACK_SYNC_BUDGET_MS = 8_000;
/** Timeout used for short Slack API reads during reconciliation. */
export const READ_SLACK_API_TIMEOUT_MS = 1_500;
/** Delay between retry attempts for transient KV write rate limits. */
export const DEFAULT_KV_WRITE_RETRY_DELAY_MS = 100;
/** Maximum recent commands inspected during Slack reply synchronization. */
export const MAX_RECENT_SLACK_SYNC_COMMANDS = 20;
/** Time allowed for the local bridge to claim a text command. */
export const BRIDGE_CLAIM_TIMEOUT_MS = 60 * 1000;
/** Time allowed for the local bridge to produce a text result. */
export const BRIDGE_RESULT_TIMEOUT_MS = 9 * 60 * 1000;
/** Time allowed for the local bridge to produce a long-text result. */
export const BRIDGE_LONG_TEXT_RESULT_TIMEOUT_MS = 9 * 60 * 1000;
/** Time allowed for the local bridge to claim a photo command. */
export const BRIDGE_PHOTO_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
/** Window for retrying or rerouting bridge photo work. */
export const BRIDGE_PHOTO_RETRY_WINDOW_MS = 30 * 60 * 1000;
/** Time allowed for the Claude bridge to claim a command. */
export const CLAUDE_CLAIM_TIMEOUT_MS = 60 * 1000;
/** Time allowed for the Claude bridge to produce a text result. */
export const CLAUDE_RESULT_TIMEOUT_MS = 9 * 60 * 1000;
/** Time allowed for the Claude bridge to produce a long-text result. */
export const CLAUDE_LONG_TEXT_RESULT_TIMEOUT_MS = 9 * 60 * 1000;
/** Window for retrying or rerouting Claude bridge work. */
export const CLAUDE_RETRY_WINDOW_MS = 10 * 60 * 1000;

/** Stable timeout map consumed by command maintenance and tests. */
export const COMMAND_TIMEOUTS = {
  cloudFirstAckMs: CLOUD_FIRST_ACK_TIMEOUT_MS,
  cloudResultMs: CLOUD_RESULT_TIMEOUT_MS,
  slackFirstAckMs: SLACK_FIRST_ACK_TIMEOUT_MS,
  slackResultMs: SLACK_RESULT_TIMEOUT_MS,
  slackPhotoFirstAckMs: SLACK_PHOTO_FIRST_ACK_TIMEOUT_MS,
  slackPhotoResultMs: SLACK_PHOTO_RESULT_TIMEOUT_MS,
  bridgeClaimMs: BRIDGE_CLAIM_TIMEOUT_MS,
  bridgeResultMs: BRIDGE_RESULT_TIMEOUT_MS,
  bridgeLongTextResultMs: BRIDGE_LONG_TEXT_RESULT_TIMEOUT_MS,
  bridgePhotoClaimMs: BRIDGE_PHOTO_CLAIM_TIMEOUT_MS,
  bridgePhotoRetryWindowMs: BRIDGE_PHOTO_RETRY_WINDOW_MS,
  claudeClaimMs: CLAUDE_CLAIM_TIMEOUT_MS,
  claudeResultMs: CLAUDE_RESULT_TIMEOUT_MS,
  claudeLongTextResultMs: CLAUDE_LONG_TEXT_RESULT_TIMEOUT_MS,
  claudeRetryWindowMs: CLAUDE_RETRY_WINDOW_MS
};
