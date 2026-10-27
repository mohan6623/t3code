import { describe, expect, it } from "vite-plus/test";

import { claudeLoginEnvironment } from "./claudeLoginAuth.ts";

describe("claudeLoginEnvironment", () => {
  it("drops credentials that would stand in for the account and points at its config dir", () => {
    const env = claudeLoginEnvironment(
      {
        PATH: "/usr/bin",
        CLAUDE_CODE_OAUTH_TOKEN: "setup-token",
        ANTHROPIC_API_KEY: "key",
        ANTHROPIC_AUTH_TOKEN: "token",
        CLAUDE_CONFIG_DIR: "/home/u/.claude",
      },
      "/home/u/.claude-account2",
    );
    expect(env).toEqual({ PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/home/u/.claude-account2" });
  });
});
