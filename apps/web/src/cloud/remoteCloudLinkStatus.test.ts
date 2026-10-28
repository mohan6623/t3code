import type { EnvironmentCloudLinkStateResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  remoteCloudLinkAction,
  remoteCloudLinkStatusText,
  resolveRemoteCloudLinkStatus,
} from "./remoteCloudLinkStatus";

const NOT_LINKED: EnvironmentCloudLinkStateResult = {
  linked: false,
  cloudUserId: null,
  relayUrl: null,
  relayIssuer: null,
  publishAgentActivity: false,
};

const LINKED: EnvironmentCloudLinkStateResult = {
  linked: true,
  cloudUserId: "user-1",
  relayUrl: "https://relay.example.test",
  relayIssuer: "https://relay.example.test",
  managedTunnelActive: true,
  publishAgentActivity: false,
};

describe("remote T3 Connect status", () => {
  it("is unknown until the link state is read", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: null,
      signedIn: true,
      userId: "user-1",
    });
    expect(status).toEqual({ kind: "unknown" });
    expect(remoteCloudLinkStatusText(status)).toBe("Unknown");
    expect(remoteCloudLinkAction(status, true)).toBeNull();
  });

  it("offers a link when this client is signed in and the server is not linked", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: NOT_LINKED,
      signedIn: true,
      userId: "user-1",
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Signed in, not linked");
    expect(remoteCloudLinkAction(status, true)).toBe("link");
    // A LAN route cannot get a link proof, so it offers nothing.
    expect(remoteCloudLinkAction(status, false)).toBeNull();
  });

  it("offers sign-in when this client is signed out", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: NOT_LINKED,
      signedIn: false,
      userId: null,
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Signed out");
    expect(remoteCloudLinkAction(status, true)).toBe("sign-in");
  });

  it("waits for the sign-in state before naming an unlinked server", () => {
    expect(
      resolveRemoteCloudLinkStatus({ linkState: NOT_LINKED, signedIn: undefined, userId: null }),
    ).toEqual({ kind: "unknown" });
  });

  it("shows a link on this account and offers unlink", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: LINKED,
      signedIn: true,
      userId: "user-1",
    });
    expect(status).toEqual({
      kind: "linked",
      account: "yours",
      managedTunnel: true,
      unreachable: false,
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Linked");
    expect(remoteCloudLinkAction(status, true)).toBe("unlink");
  });

  it("names a link on another account", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: LINKED,
      signedIn: true,
      userId: "user-2",
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Linked to another T3 Connect account");
    expect(remoteCloudLinkAction(status, true)).toBe("unlink");
  });

  it("shows a link even while this client is signed out", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: LINKED,
      signedIn: false,
      userId: null,
    });
    expect(status).toMatchObject({ kind: "linked", account: "unknown" });
    expect(remoteCloudLinkStatusText(status)).toBe("Linked");
  });

  it("relinks a notifications-only link on this account", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: { ...LINKED, managedTunnelActive: false },
      signedIn: true,
      userId: "user-1",
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Linked for notifications only");
    expect(remoteCloudLinkAction(status, true)).toBe("link");
    expect(remoteCloudLinkAction(status, false)).toBe("unlink");
  });

  it("names an unreachable link", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: {
        ...LINKED,
        reachability: {
          status: "unreachable",
          checkedAt: "2026-10-28T00:00:00.000Z",
          cause: "connector_not_running",
          reason: "The tunnel is down.",
          hint: null,
          fix: "Restart the server.",
        },
      },
      signedIn: true,
      userId: "user-1",
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Linked, but other devices cannot reach it");
  });

  it("offers to link again after T3 Connect removed the environment", () => {
    const status = resolveRemoteCloudLinkStatus({
      linkState: { ...LINKED, linkRevoked: true },
      signedIn: true,
      userId: "user-1",
    });
    expect(remoteCloudLinkStatusText(status)).toBe("Removed from T3 Connect");
    expect(remoteCloudLinkAction(status, true)).toBe("link");
  });
});
