import { EnvironmentId, type EnvironmentCloudLinkStateResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const testState = vi.hoisted(() => ({
  linkState: null as EnvironmentCloudLinkStateResult | null,
  signedIn: true as boolean | undefined,
  getToken: vi.fn<() => Promise<string | null>>(),
  link: vi.fn(),
  unlink: vi.fn(),
  refreshState: vi.fn(),
  refreshDiscovery: vi.fn(),
  signIn: vi.fn(),
  toast: vi.fn(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => AsyncResult.success(testState.linkState)) as never,
  useAtomRefresh: (() => testState.refreshState) as never,
}));
vi.mock(import("@clerk/react"), async (original) => ({
  ...(await original()),
  useAuth: (() => ({
    getToken: testState.getToken,
    isSignedIn: testState.signedIn,
    userId: testState.signedIn ? "user-1" : null,
  })) as never,
}));
vi.mock(import("../clerk/useT3ConnectAuthPrompt"), async (original) => ({
  ...(await original()),
  useT3ConnectAuthPrompt: () => ({ authPrompt: null, openAuthPrompt: testState.signIn }),
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: testState.toast } as never };
});
vi.mock(import("../../state/relay"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    relayEnvironmentDiscovery: {
      ...actual.relayEnvironmentDiscovery,
      refresh: testState.refreshDiscovery,
    } as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("../../cloud/remoteCloudLinkAtoms"), async (original) => ({
  ...(await original()),
  linkRemoteEnvironment: testState.link as never,
  unlinkRemoteEnvironment: testState.unlink as never,
}));
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  resolveRelayClerkTokenOptions: () => ({}) as never,
}));

import { RemoteCloudLinkLine } from "./RemoteCloudLinkLine";

const ENVIRONMENT_ID = EnvironmentId.make("remote-1");
const NOT_LINKED: EnvironmentCloudLinkStateResult = {
  linked: false,
  cloudUserId: null,
  relayUrl: null,
  relayIssuer: null,
  publishAgentActivity: false,
};

function setup(linkState: EnvironmentCloudLinkStateResult | null, signedIn = true) {
  testState.linkState = linkState;
  testState.signedIn = signedIn;
  testState.getToken.mockReset().mockResolvedValue("clerk-token");
  for (const command of [testState.link, testState.unlink, testState.refreshDiscovery]) {
    command.mockReset().mockResolvedValue(AsyncResult.success({}));
  }
  testState.refreshState.mockReset();
  testState.signIn.mockReset();
  testState.toast.mockReset();
}

describe("RemoteCloudLinkLine", () => {
  it("links the remote environment with this client's T3 Connect token", async () => {
    setup(NOT_LINKED);
    await using screen = await render(
      <RemoteCloudLinkLine environmentId={ENVIRONMENT_ID} label="cursor-vm" linkable />,
    );
    await expect.element(screen.getByText("Signed in, not linked")).toBeVisible();

    await screen.getByRole("button", { name: "Link to T3 Connect: cursor-vm" }).click();

    await vi.waitFor(() => expect(testState.refreshState).toHaveBeenCalled());
    expect(testState.link).toHaveBeenCalledWith({
      environmentId: ENVIRONMENT_ID,
      input: { clerkToken: "clerk-token" },
    });
    expect(testState.unlink).not.toHaveBeenCalled();
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "T3 Connect linked" }),
    );
  });

  it("unlinks a linked environment", async () => {
    setup({ ...NOT_LINKED, linked: true, cloudUserId: "user-1", managedTunnelActive: true });
    await using screen = await render(
      <RemoteCloudLinkLine environmentId={ENVIRONMENT_ID} label="cursor-vm" linkable />,
    );
    await expect.element(screen.getByText("Linked", { exact: true })).toBeVisible();

    await screen.getByRole("button", { name: "Unlink: cursor-vm" }).click();

    await vi.waitFor(() =>
      expect(testState.unlink).toHaveBeenCalledWith({
        environmentId: ENVIRONMENT_ID,
        input: { clerkToken: "clerk-token" },
      }),
    );
    expect(testState.link).not.toHaveBeenCalled();
  });

  it("opens T3 Connect sign-in when this client is signed out", async () => {
    setup(NOT_LINKED, false);
    await using screen = await render(
      <RemoteCloudLinkLine environmentId={ENVIRONMENT_ID} label="cursor-vm" linkable />,
    );
    await expect.element(screen.getByText("Signed out")).toBeVisible();

    await screen.getByRole("button", { name: "Sign in: cursor-vm" }).click();

    expect(testState.signIn).toHaveBeenCalledTimes(1);
    expect(testState.getToken).not.toHaveBeenCalled();
  });

  it("names the host command when the route cannot link from here", async () => {
    setup(NOT_LINKED);
    await using screen = await render(
      <RemoteCloudLinkLine environmentId={ENVIRONMENT_ID} label="cursor-vm" linkable={false} />,
    );
    await expect.element(screen.getByText("· run `t3 connect link` on the host")).toBeVisible();
    expect(screen.container.querySelector("button")).toBeNull();
  });
});
