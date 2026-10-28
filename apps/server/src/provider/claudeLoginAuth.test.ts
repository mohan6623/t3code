import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import {
  claudeEnvironmentSignInMethod,
  claudeLoginEnvironment,
  parseClaudeAuthStatus,
  removeClaudeSetupToken,
  withClaudeSignInMethod,
  withoutClaudeSetupToken,
} from "./claudeLoginAuth.ts";

const claude = ProviderDriverKind.make("claudeAgent");

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

describe("parseClaudeAuthStatus", () => {
  // Shapes printed by Claude Code 2.1 `claude auth status --json`.
  it("reads a subscription login", () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: "firstParty",
          email: "user@example.com",
          subscriptionType: "max",
        }),
      ),
    ).toBe("subscription");
  });

  it("reads a setup token", () => {
    expect(
      parseClaudeAuthStatus(
        '{\n  "loggedIn": true,\n  "authMethod": "oauth_token",\n  "apiProvider": "firstParty"\n}\n',
      ),
    ).toBe("token");
  });

  it("reads an API key", () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: "api_key",
          apiKeySource: "ANTHROPIC_API_KEY",
        }),
      ),
    ).toBe("apiKey");
  });

  it("reads a signed-out config dir", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false, authMethod: "none" }))).toBe(
      "signedOut",
    );
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toBe("signedOut");
  });

  it("says nothing for other output", () => {
    expect(parseClaudeAuthStatus("")).toBeUndefined();
    expect(parseClaudeAuthStatus("Not logged in")).toBeUndefined();
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "bedrock" }))).toBe(
      undefined,
    );
  });
});

describe("claudeEnvironmentSignInMethod", () => {
  it("names the credential the environment injects, API key first like the CLI", () => {
    expect(claudeEnvironmentSignInMethod({ CLAUDE_CODE_OAUTH_TOKEN: "t" })).toBe("token");
    expect(
      claudeEnvironmentSignInMethod({ CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" }),
    ).toBe("apiKey");
    expect(claudeEnvironmentSignInMethod({ CLAUDE_CODE_OAUTH_TOKEN: " " })).toBeUndefined();
    expect(claudeEnvironmentSignInMethod({})).toBeUndefined();
  });
});

describe("withClaudeSignInMethod", () => {
  it("marks a signed-in setup token so settings can offer a subscription sign-in", () => {
    const provider = { auth: { status: "authenticated" as const, email: "user@example.com" } };
    expect(withClaudeSignInMethod(provider, "token").auth).toEqual({
      status: "authenticated",
      email: "user@example.com",
      type: "oauthToken",
      label: "Claude token",
    });
  });

  it("keeps subscription logins and signed-out snapshots as they are", () => {
    const subscription = {
      auth: { status: "authenticated" as const, type: "max", label: "Claude Max Subscription" },
    };
    expect(withClaudeSignInMethod(subscription, "subscription")).toBe(subscription);
    const signedOut = { auth: { status: "unauthenticated" as const } };
    expect(withClaudeSignInMethod(signedOut, "token")).toBe(signedOut);
  });
});

describe("withoutClaudeSetupToken", () => {
  it("drops only the setup token", () => {
    expect(
      withoutClaudeSetupToken({
        driver: claude,
        displayName: "Maxx",
        environment: [
          { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "", sensitive: true, valueRedacted: true },
          { name: "CLAUDE_CONFIG_DIR", value: "/home/u/.claude-account2", sensitive: false },
        ],
      }),
    ).toEqual({
      driver: claude,
      displayName: "Maxx",
      environment: [
        { name: "CLAUDE_CONFIG_DIR", value: "/home/u/.claude-account2", sensitive: false },
      ],
    });
  });

  it("drops an empty environment, and says when there was no token", () => {
    expect(
      withoutClaudeSetupToken({
        driver: claude,
        environment: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "t", sensitive: true }],
      }),
    ).toEqual({ driver: claude });
    expect(withoutClaudeSetupToken({ driver: claude })).toBeUndefined();
    expect(
      withoutClaudeSetupToken({
        driver: claude,
        environment: [{ name: "PATH", value: "/usr/bin", sensitive: false }],
      }),
    ).toBeUndefined();
  });
});

describe("removeClaudeSetupToken", () => {
  const instanceId = ProviderInstanceId.make("claudeAgent_maxx");
  const layer = ServerSettings.ServerSettingsService.layerTest({
    providerInstances: {
      [instanceId]: {
        driver: claude,
        environment: [
          { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "setup-token", sensitive: true },
          { name: "CLAUDE_CONFIG_DIR", value: "/home/u/.claude-account2", sensitive: false },
        ],
      },
    },
  });

  it.effect("removes the saved token from the instance after a sign-in", () =>
    Effect.gen(function* () {
      expect(yield* removeClaudeSetupToken(instanceId)).toBe(true);
      const settings = yield* ServerSettings.ServerSettingsService;
      const instance = (yield* settings.getSettings).providerInstances[instanceId];
      expect(instance?.environment?.map((variable) => variable.name)).toEqual([
        "CLAUDE_CONFIG_DIR",
      ]);
      // Nothing left to remove the second time.
      expect(yield* removeClaudeSetupToken(instanceId)).toBe(false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("leaves settings alone for an instance without a token", () =>
    Effect.gen(function* () {
      expect(yield* removeClaudeSetupToken(ProviderInstanceId.make("claudeAgent"))).toBe(false);
    }).pipe(Effect.provide(layer)),
  );
});
