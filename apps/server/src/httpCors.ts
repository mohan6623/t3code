import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

// Fork: PATCH for the device hub's stream settings (stream quality menu).
export const browserApiCorsAllowedMethods = ["GET", "POST", "PATCH", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;

/** MCP refuses every browser Origin with 403, so the browser CORS layer must not answer for it. */
export const MCP_HTTP_PATH = "/mcp";
