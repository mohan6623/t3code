import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeClaudeAccount,
  findTerminalSignInUrl,
  readClaudeAccountState,
} from "./ProviderAuthenticationSection.logic";

// The link `claude auth login --claudeai` prints, with test-only PKCE values.
const SIGN_IN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e" +
  "&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback" +
  "&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code" +
  "+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins&code_challenge=test-challenge-0123456789" +
  "&code_challenge_method=S256&state=test-state-0123456789";

/** Cuts text into terminal rows the way a full-screen app wraps a long word. */
function hardWrap(text: string, width: number, firstRowPrefix = "", indent = ""): string[] {
  const rows: string[] = [];
  let rest = text;
  let prefix = firstRowPrefix;
  while (rest.length > 0) {
    const room = width - prefix.length;
    rows.push(prefix + rest.slice(0, room));
    rest = rest.slice(room);
    prefix = indent;
  }
  return rows;
}

describe("findTerminalSignInUrl", () => {
  it("reads the hyperlink Claude Code 2.1 prints", () => {
    const output =
      "Opening browser to sign in…\r\nIf the browser didn't open, visit: " +
      `\u001b]8;;${SIGN_IN_URL}\u0007${SIGN_IN_URL}\u001b]8;;\u0007` +
      "\r\nPaste code here if prompted > ";
    expect(findTerminalSignInUrl(output)).toBe(SIGN_IN_URL);
  });

  it("joins a link hard-wrapped at 80 columns after a label", () => {
    const rows = hardWrap(SIGN_IN_URL, 80, "If the browser didn't open, visit: ");
    expect(rows.length).toBeGreaterThan(3);
    const output = [
      "Opening browser to sign in…",
      ...rows.map((row) => `\u001b[2m${row}\u001b[22m\u001b[K`),
      "",
      "Paste code here if prompted > ",
    ].join("\r\n");
    expect(findTerminalSignInUrl(output)).toBe(SIGN_IN_URL);
  });

  it("joins an indented link that ends exactly at the edge, and stops at the prompt", () => {
    const padded = SIGN_IN_URL.slice(0, Math.floor(SIGN_IN_URL.length / 78) * 78);
    const output = [
      "  Browser didn't open? Use the url below to sign in (c to copy)",
      ...hardWrap(padded, 80, "  ", "  "),
      "  Paste code here if prompted >",
    ].join("\r\n");
    expect(findTerminalSignInUrl(output)).toBe(padded);
  });

  it("does not run a redrawn frame into the link", () => {
    const frame = (status: string) =>
      [status, ...hardWrap(SIGN_IN_URL, 80, "visit: "), "Paste code here if prompted > "].join(
        "\r\n",
      );
    const redraw = "\u001b[2K\u001b[1A".repeat(8) + "\u001b[2K\u001b[G";
    const output = frame("Opening browser…") + redraw + frame("Waiting for the code…");
    expect(findTerminalSignInUrl(output)).toBe(SIGN_IN_URL);
  });

  it("takes the last link, and leaves a short link alone", () => {
    const output =
      "See https://docs.example.com/login for help.\r\n" +
      "Open https://claude.ai/login\r\n" +
      "Done\r\n";
    expect(findTerminalSignInUrl(output)).toBe("https://claude.ai/login");
  });

  it("finds nothing before the link is printed", () => {
    expect(findTerminalSignInUrl("")).toBeNull();
    expect(findTerminalSignInUrl("Opening browser to sign in…\r\n")).toBeNull();
  });
});

describe("readClaudeAccountState", () => {
  const claude = ProviderDriverKind.make("claudeAgent");

  it("reads a subscription login and its plan", () => {
    const state = readClaudeAccountState({
      driver: claude,
      auth: { status: "authenticated", type: "max", label: "Claude Max Subscription" },
    });
    expect(state).toEqual({ kind: "subscription", plan: "Max" });
    expect(describeClaudeAccount(state!)).toBe("Signed in with your Claude subscription (Max)");
  });

  it("reads a setup token", () => {
    const state = readClaudeAccountState({
      driver: claude,
      auth: { status: "authenticated", type: "oauthToken", label: "Claude token" },
    });
    expect(state).toEqual({ kind: "token" });
    expect(describeClaudeAccount(state!)).toBe("Using a token. MCP connectors and usage are off");
  });

  it("reads a signed-out instance and an API key", () => {
    const signedOut = readClaudeAccountState({
      driver: claude,
      auth: { status: "unauthenticated" },
    });
    expect(signedOut).toEqual({ kind: "signedOut" });
    expect(describeClaudeAccount(signedOut!)).toBe("Signed out");
    expect(
      readClaudeAccountState({
        driver: claude,
        auth: { status: "authenticated", type: "apiKey", label: "Claude API Key" },
      }),
    ).toEqual({ kind: "apiKey" });
  });

  it("says nothing for other providers or unknown states", () => {
    expect(
      readClaudeAccountState({
        driver: ProviderDriverKind.make("codex"),
        auth: { status: "unauthenticated" },
      }),
    ).toBeNull();
    expect(readClaudeAccountState({ driver: claude, auth: { status: "unknown" } })).toBeNull();
    expect(
      readClaudeAccountState({ driver: claude, auth: { status: "authenticated" } }),
    ).toBeNull();
  });
});
