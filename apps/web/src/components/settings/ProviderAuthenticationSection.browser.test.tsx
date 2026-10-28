import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerProvider,
} from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

// Fork: the Claude sign-in section, with a fake terminal sign-in.
const setup = vi.hoisted(() => ({
  auth: null as ProviderAuthState | null,
  authState: vi.fn(() => "auth"),
  startAuth: vi.fn(),
  completeAuth: vi.fn(),
  respondAuth: vi.fn(),
  cancelAuth: vi.fn(),
  logoutAuth: vi.fn(),
  confirm: vi.fn(),
  openExternal: vi.fn(),
  readClipboard: vi.fn(),
  writeClipboard: vi.fn(),
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providerAuthState: setup.authState as never,
      startProviderAuth: setup.startAuth as never,
      completeProviderAuth: setup.completeAuth as never,
      respondProviderAuth: setup.respondAuth as never,
      cancelProviderAuth: setup.cancelAuth as never,
      logoutProviderAuth: setup.logoutAuth as never,
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: setup.auth,
    error: null,
    isPending: false,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  ensureLocalApi: () =>
    ({
      dialogs: { confirm: setup.confirm },
      shell: { openExternal: setup.openExternal },
    }) as never,
}));
vi.mock(import("../../hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  readTextFromClipboard: setup.readClipboard,
  writeTextToClipboard: setup.writeClipboard,
}));

import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

const environmentId = EnvironmentId.make("remote-vm");
const instanceId = ProviderInstanceId.make("claudeAgent_maxx");
const signInUrl =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=test-client&state=test-only";

function claudeProvider(auth: ServerProvider["auth"]): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    installed: true,
    enabled: true,
    version: "2.1.312",
    status: auth.status === "authenticated" ? "ready" : "error",
    auth: { ...auth, canLogout: true },
    checkedAt: "2026-10-28T00:00:00.000Z",
    models: [],
    skills: [],
    slashCommands: [],
    setup: { canAuthenticate: true, canInstall: false },
  };
}

function authState(patch: Partial<ProviderAuthState> = {}): ProviderAuthState {
  return {
    instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
    methods: [
      {
        id: "claude-subscription",
        name: "Claude subscription",
        description: null,
        type: "terminal",
      },
    ],
    ...patch,
  };
}

const terminalOutput =
  "Opening browser to sign in…\r\nIf the browser didn't open, visit: " +
  `\u001b]8;;${signInUrl}\u0007${signInUrl}\u001b]8;;\u0007\r\nPaste code here if prompted > `;

async function renderSection(provider: ServerProvider, hasSavedClaudeToken?: boolean) {
  const screen = await render(
    <ProviderAuthenticationSection
      environmentId={environmentId}
      environmentLabel="Cursor VM"
      instanceId={instanceId}
      provider={provider}
      readOnly={false}
      hasSavedClaudeToken={hasSavedClaudeToken}
    />,
  );
  const button = (label: string) =>
    [...screen.container.querySelectorAll("button")].find(
      (element) => element.textContent === label,
    ) ?? null;
  return Object.assign(screen, {
    button,
    text: () => screen.container.textContent ?? "",
    async click(label: string) {
      await vi.waitFor(() => expect(button(label)?.disabled, `${label} enabled`).toBe(false));
      await act(async () => button(label)!.click());
    },
  });
}

/** Terminal bytes the section sent, without resize-only messages. */
function sentData(): string[] {
  return setup.respondAuth.mock.calls
    .map(([call]) => (call as { input: { response: { data: string } } }).input.response.data)
    .filter((data) => data.length > 0);
}

function reset() {
  vi.clearAllMocks();
  setup.auth = authState();
  for (const command of [
    setup.startAuth,
    setup.completeAuth,
    setup.respondAuth,
    setup.cancelAuth,
    setup.logoutAuth,
  ]) {
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  }
  setup.confirm.mockReset().mockResolvedValue(false);
  setup.openExternal.mockReset().mockResolvedValue(true);
  setup.readClipboard.mockReset().mockResolvedValue("");
  setup.writeClipboard.mockReset().mockResolvedValue(undefined);
}

describe("Claude account", () => {
  it("offers a subscription sign-in to a signed-out instance", async () => {
    reset();
    await using screen = await renderSection(claudeProvider({ status: "unauthenticated" }));
    expect(screen.text()).toContain("Signed out.");
    expect(screen.button("Sign out")).toBeNull();
    await screen.click("Sign in with Claude subscription");
    expect(setup.startAuth).toHaveBeenCalledWith({ environmentId, input: { instanceId } });
  });

  it("offers a subscription sign-in instead of sign-out to a token instance", async () => {
    reset();
    await using screen = await renderSection(
      claudeProvider({ status: "authenticated", type: "oauthToken", label: "Claude token" }),
    );
    expect(screen.text()).toContain("Using a token. MCP connectors and usage are off.");
    expect(screen.button("Sign in with Claude subscription")).not.toBeNull();
    expect(screen.button("Sign out")).toBeNull();
    expect(screen.button("Change account")).toBeNull();
  });

  it("keeps change account and sign out for a subscription login", async () => {
    reset();
    await using screen = await renderSection(
      claudeProvider({ status: "authenticated", type: "max", label: "Claude Max Subscription" }),
    );
    expect(screen.text()).toContain("Signed in with your Claude subscription (Max).");
    expect(screen.button("Change account")).not.toBeNull();
    expect(screen.button("Sign out")).not.toBeNull();
  });

  it("says when the sign-in removed the saved token", async () => {
    reset();
    const screen = await renderSection(
      claudeProvider({ status: "authenticated", type: "oauthToken", label: "Claude token" }),
      true,
    );
    await screen.click("Sign in with Claude subscription");
    expect(screen.text()).not.toContain("Removed the saved token");
    await screen.rerender(
      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel="Cursor VM"
        instanceId={instanceId}
        provider={claudeProvider({
          status: "authenticated",
          type: "max",
          label: "Claude Max Subscription",
        })}
        readOnly={false}
        hasSavedClaudeToken={false}
      />,
    );
    expect(screen.text()).toContain(
      "Removed the saved token (CLAUDE_CODE_OAUTH_TOKEN) from this provider.",
    );
    await screen.unmount();
  });
});

describe("Claude sign-in terminal", () => {
  const waiting = () =>
    authState({
      phase: "waiting",
      flowId: "flow-1",
      expiresAt: "2026-10-28T00:10:00.000Z",
      interaction: {
        type: "terminal",
        id: "terminal",
        output: terminalOutput,
        outputOffset: terminalOutput.length,
      },
    });

  it("opens and copies the sign-in link from the action row", async () => {
    reset();
    setup.auth = waiting();
    await using screen = await renderSection(claudeProvider({ status: "unauthenticated" }));
    await screen.click("Open link");
    expect(setup.openExternal).toHaveBeenCalledWith(signInUrl);
    await screen.click("Copy link");
    expect(setup.writeClipboard).toHaveBeenCalledWith(signInUrl, "Provider sign-in link");
  });

  it("pastes the clipboard into the terminal", async () => {
    reset();
    setup.auth = waiting();
    setup.readClipboard.mockResolvedValue("pasted-code#state");
    await using screen = await renderSection(claudeProvider({ status: "unauthenticated" }));
    await screen.click("Paste");
    await vi.waitFor(() => expect(sentData().join("")).toContain("pasted-code#state"));
    expect(setup.respondAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId,
        input: expect.objectContaining({ instanceId, flowId: "flow-1", interactionId: "terminal" }),
      }),
    );
  });

  it("sends a typed code, then Enter", async () => {
    reset();
    setup.auth = waiting();
    await using screen = await renderSection(claudeProvider({ status: "unauthenticated" }));
    const field = await vi.waitFor(() => {
      const input = screen.container.querySelector<HTMLInputElement>(
        'input[aria-label="Sign-in code"]',
      );
      expect(input).not.toBeNull();
      return input!;
    });
    expect(field.placeholder).toBe("Paste the code here");
    await userEvent.fill(field, "  code-123#state-456  ");
    await screen.click("Send");
    await vi.waitFor(() => expect(sentData().at(-1)).toBe("\r"));
    const sent = sentData();
    expect(sent.slice(0, -1).join("")).toContain("code-123#state-456");
    expect(sent.join("")).not.toContain("  code");
    expect(field.value).toBe("");
  });
});
