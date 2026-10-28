import type { ServerProvider } from "@t3tools/contracts";

// Fork: helpers for the in-app Claude sign-in (see apps/server/src/provider/claudeLoginAuth.ts).

/** ESC ] 8 ; params ; target ST. Claude prints its sign-in link as one of these. */
const OSC8_LINK = /\u001b\]8;[^;\u0007\u001b]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*([@-~])/g;
const SHORT_ESCAPE = /\u001b[@-Z\\-_]/g;
const URL_TEXT = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
/** Narrower rows are not a terminal edge, so a link there ends where it stops. */
const MIN_WRAPPED_ROW = 40;

/** Visible text of terminal output. Cursor moves become line breaks, so redrawn lines do not run together. */
function terminalText(output: string): string {
  return output
    .replace(OSC, "")
    .replace(CSI, (_sequence, final: string) =>
      final === "C" ? " " : "ABEFGHJdf".includes(final) ? "\n" : "",
    )
    .replace(SHORT_ESCAPE, "")
    .replace(/\r\n?/g, "\n");
}

/**
 * The last https link in sign-in terminal output. A link wrapped onto the
 * following lines (each line only link text, no spaces) is joined back.
 */
export function findTerminalSignInUrl(output: string): string | null {
  const hyperlinks = [...output.matchAll(OSC8_LINK)]
    .map((match) => match[1] ?? "")
    .filter((target) => target.startsWith("https://"));
  if (hyperlinks.length > 0) return hyperlinks.at(-1)!;

  const lines = terminalText(output).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    const start = line.lastIndexOf("https://");
    if (start < 0) continue;
    const rest = line.slice(start);
    let url = rest.split(/\s/, 1)[0]!;
    // The link ran to the edge of the terminal, so it may go on below.
    let wrapped = url.length === rest.trimEnd().length && line.trimEnd().length >= MIN_WRAPPED_ROW;
    for (let next = index + 1; wrapped && next < lines.length; next++) {
      const piece = lines[next]!.trim();
      if (!URL_TEXT.test(piece)) break;
      url += piece;
      wrapped = lines[next]!.trimEnd().length >= lines[next - 1]!.trimEnd().length;
    }
    return url.replace(/[.,;:!?'")\]>]+$/, "");
  }
  return null;
}

/** The web app's copy of CLAUDE_TOKEN_AUTH_TYPE in claudeLoginAuth.ts. */
const CLAUDE_TOKEN_AUTH_TYPE = "oauthToken";

export type ClaudeAccountState =
  | { readonly kind: "subscription"; readonly plan: string | null }
  | { readonly kind: "token" }
  | { readonly kind: "apiKey" }
  | { readonly kind: "signedOut" };

/** How a Claude instance is signed in, or null for other providers and unknown states. */
export function readClaudeAccountState(
  provider: Pick<ServerProvider, "driver" | "auth">,
): ClaudeAccountState | null {
  if (provider.driver !== "claudeAgent") return null;
  if (provider.auth.status === "unauthenticated") return { kind: "signedOut" };
  if (provider.auth.status !== "authenticated") return null;
  switch (provider.auth.type) {
    case CLAUDE_TOKEN_AUTH_TYPE:
      return { kind: "token" };
    case "apiKey":
      return { kind: "apiKey" };
    case undefined:
    case "bedrock":
    case "customEndpoint":
      return null;
    default: {
      // The server labels plans "Claude Max Subscription"; keep the plan name.
      const label = provider.auth.label?.trim() ?? "";
      const plan = /^Claude (.+?) Subscription$/i.exec(label)?.[1] ?? label;
      return { kind: "subscription", plan: plan || null };
    }
  }
}

export function describeClaudeAccount(state: ClaudeAccountState): string {
  switch (state.kind) {
    case "subscription":
      return state.plan
        ? `Signed in with your Claude subscription (${state.plan})`
        : "Signed in with your Claude subscription";
    case "token":
      return "Using a token. MCP connectors and usage are off";
    case "apiKey":
      return "Using an API key. MCP connectors and usage are off";
    case "signedOut":
      return "Signed out";
  }
}
