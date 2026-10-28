// Fork: T3 Connect status and its one action on a saved remote environment row,
// so an SSH host can be linked to this client's T3 Connect account from here.
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useAuth } from "@clerk/react";
import { findErrorTraceId } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  selectEnvironmentQueryData,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { resolveRelayClerkTokenOptions } from "~/cloud/publicConfig";
import {
  linkRemoteEnvironment,
  remoteCloudLinkState,
  unlinkRemoteEnvironment,
} from "~/cloud/remoteCloudLinkAtoms";
import {
  type RemoteCloudLinkAction,
  remoteCloudLinkAction,
  remoteCloudLinkStatusText,
  resolveRemoteCloudLinkStatus,
} from "~/cloud/remoteCloudLinkStatus";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useAtomCommand } from "~/state/use-atom-command";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { toastManager } from "../ui/toast";

const ACTION_LABELS: Record<RemoteCloudLinkAction, string> = {
  link: "Link to T3 Connect",
  unlink: "Unlink",
  "sign-in": "Sign in",
};

function reportFailure(title: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const traceId = findErrorTraceId(cause);
  console.error(`[t3-connect] ${title}`, { message, traceId, cause });
  toastManager.add({
    type: "error",
    title,
    description: traceId ? `${message} Trace ID: ${traceId}` : message,
  });
}

export function RemoteCloudLinkLine({
  environmentId,
  label,
  linkable,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** False when this client cannot run the link on that server, e.g. over a LAN route. */
  readonly linkable: boolean;
}) {
  const { getToken, isSignedIn, userId } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const stateAtom = remoteCloudLinkState({ environmentId, input: null });
  const linkState = selectEnvironmentQueryData(useAtomValue(stateAtom));
  const refreshState = useAtomRefresh(stateAtom);
  const link = useAtomCommand(linkRemoteEnvironment, { reportFailure: false });
  const unlink = useAtomCommand(unlinkRemoteEnvironment, { reportFailure: false });
  const refreshRelayEnvironments = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<"link" | "unlink" | null>(null);
  const status = resolveRemoteCloudLinkStatus({ linkState, signedIn: isSignedIn, userId });
  const action = remoteCloudLinkAction(status, linkable);

  const run = async (kind: "link" | "unlink") => {
    setBusy(kind);
    try {
      const token = await settlePromise(() => getToken(resolveRelayClerkTokenOptions()));
      const clerkToken = token._tag === "Success" ? (token.value ?? null) : null;
      if (kind === "link" && clerkToken === null) {
        reportFailure(
          "Could not link to T3 Connect",
          token._tag === "Failure"
            ? squashAtomCommandFailure(token)
            : new Error("Sign in to T3 Connect first."),
        );
        return;
      }
      // Linking runs on that server, and may first install its relay client.
      const result =
        kind === "link" && clerkToken !== null
          ? await link({ environmentId, input: { clerkToken } })
          : await unlink({ environmentId, input: { clerkToken } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          reportFailure(
            kind === "link" ? "Could not link to T3 Connect" : "Could not unlink from T3 Connect",
            squashAtomCommandFailure(result),
          );
        }
        return;
      }
      toastManager.add({
        type: "success",
        title: kind === "link" ? "T3 Connect linked" : "T3 Connect unlinked",
        description:
          kind === "link"
            ? `${label} is available to your other devices through T3 Connect.`
            : `${label} is no longer available through T3 Connect.`,
      });
      void refreshRelayEnvironments();
    } finally {
      refreshState();
      setBusy(null);
    }
  };

  const onAction = () => {
    if (action === "sign-in") openAuthPrompt();
    else if (action !== null) void run(action);
  };

  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        T3 Connect:{" "}
        <span className={status.kind === "linked" && status.unreachable ? "text-destructive" : ""}>
          {busy === "link"
            ? "Linking…"
            : busy === "unlink"
              ? "Unlinking…"
              : remoteCloudLinkStatusText(status)}
        </span>
      </span>
      {action !== null && busy === null ? (
        <>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <button
            type="button"
            onClick={onAction}
            aria-label={`${ACTION_LABELS[action]}: ${label}`}
            className="shrink-0 rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {ACTION_LABELS[action]}
          </button>
        </>
      ) : null}
      {status.kind === "not-linked" && !linkable ? (
        <span className="min-w-0 truncate">· run `t3 connect link` on the host</span>
      ) : null}
    </div>
  );
}
