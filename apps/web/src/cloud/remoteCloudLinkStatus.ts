/**
 * Fork: the T3 Connect line on a saved remote environment. Linking runs from
 * this client with its own T3 Connect sign-in, so "signed in" and "signed out"
 * name this client's account, and "linked" names the environment's link.
 */
import type { EnvironmentCloudLinkStateResult } from "@t3tools/contracts";

export type RemoteCloudLinkStatus =
  | {
      readonly kind: "linked";
      /** Whose account the environment is linked to, when this client can tell. */
      readonly account: "yours" | "other" | "unknown";
      /** False when the link only publishes agent activity, so devices cannot connect. */
      readonly managedTunnel: boolean;
      readonly unreachable: boolean;
    }
  | { readonly kind: "removed" }
  | { readonly kind: "not-linked" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unknown" };

export type RemoteCloudLinkAction = "link" | "unlink" | "sign-in";

export function resolveRemoteCloudLinkStatus(input: {
  readonly linkState: EnvironmentCloudLinkStateResult | null;
  /** This client's T3 Connect sign-in; undefined until it loads. */
  readonly signedIn: boolean | undefined;
  readonly userId: string | null | undefined;
}): RemoteCloudLinkStatus {
  const { linkState } = input;
  if (linkState === null) return { kind: "unknown" };
  if (linkState.linked && linkState.linkRevoked !== true) {
    return {
      kind: "linked",
      account:
        input.signedIn !== true || !input.userId || linkState.cloudUserId === null
          ? "unknown"
          : linkState.cloudUserId === input.userId
            ? "yours"
            : "other",
      managedTunnel: linkState.managedTunnelActive ?? true,
      unreachable: linkState.reachability?.status === "unreachable",
    };
  }
  if (input.signedIn === undefined) return { kind: "unknown" };
  if (!input.signedIn) return { kind: "signed-out" };
  return linkState.linkRevoked === true ? { kind: "removed" } : { kind: "not-linked" };
}

export function remoteCloudLinkStatusText(status: RemoteCloudLinkStatus): string {
  switch (status.kind) {
    case "linked":
      if (status.account === "other") return "Linked to another T3 Connect account";
      if (!status.managedTunnel) return "Linked for notifications only";
      return status.unreachable ? "Linked, but other devices cannot reach it" : "Linked";
    case "removed":
      return "Removed from T3 Connect";
    case "not-linked":
      return "Signed in, not linked";
    case "signed-out":
      return "Signed out";
    case "unknown":
      return "Unknown";
  }
}

/**
 * The one action the line offers. `linkable` is false when this client cannot
 * run the link on that server (see `canLinkFromThisClient`).
 */
export function remoteCloudLinkAction(
  status: RemoteCloudLinkStatus,
  linkable: boolean,
): RemoteCloudLinkAction | null {
  switch (status.kind) {
    case "linked":
      // A notifications-only link on your account relinks with remote access.
      return status.account === "yours" && !status.managedTunnel && linkable ? "link" : "unlink";
    case "removed":
    case "not-linked":
      return linkable ? "link" : null;
    case "signed-out":
      return "sign-in";
    case "unknown":
      return null;
  }
}
