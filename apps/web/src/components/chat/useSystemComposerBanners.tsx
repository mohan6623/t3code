import { useStableCallback } from "../../hooks/useStableCallback";
import { type EnvironmentId } from "@t3tools/contracts";
import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { InfoIcon, RotateCwIcon, WifiOffIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { environmentCatalog } from "../../connection/catalog";
import { ConnectionDiagnosisHeadline } from "../settings/ConnectionDiagnosisDetails";
import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import {
  useEnvironmentDisconnectDelay,
  useEnvironmentStateHeldFor,
} from "../../hooks/useEnvironmentDisconnectDelay";
import { serverEnvironment } from "../../state/server";
import { type EnvironmentPresentation } from "../../state/environments";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ENVIRONMENT_RECONNECT_WARNING_GRACE_MS } from "../ChatView.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ServerUpdateAction, serverUpdateStageLabel } from "../ServerUpdateAction";
import { useAutoBalanceUpdateBanner } from "./useAutoBalanceUpdateBanner";
import { ComposerServerUpdateIcon } from "./ComposerServerUpdateStatus";
import {
  dismissServerUpdateFailure,
  isServerUpdateFailureDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "../../versionSkew";

export type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: EnvironmentConnectionPresentation;
};

interface SystemComposerBannersInput {
  readonly activeEnvironment: EnvironmentPresentation | null;
  readonly activeEnvironmentUnavailable: boolean;
  readonly activeEnvironmentUnavailableState: EnvironmentUnavailableState | null;
  readonly activeThreadEnvironmentId: EnvironmentId | null;
  readonly serverConfig: EnvironmentPresentation["serverConfig"] | null;
  readonly hasMultipleRegisteredEnvironments: boolean;
  readonly automaticEnvironment: boolean;
  readonly autoUpdateEnvironments: ReadonlyArray<EnvironmentPresentation>;
}

/**
 * The composer banners about the machine itself: offline or reconnecting,
 * a server update, and auto-balanced machines that need one.
 */
export function useSystemComposerBanners(input: SystemComposerBannersInput) {
  const {
    activeEnvironment,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableState,
    activeThreadEnvironmentId,
    serverConfig,
    hasMultipleRegisteredEnvironments,
    automaticEnvironment,
    autoUpdateEnvironments,
  } = input;
  const navigate = useNavigate();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const setEnvironmentEnabled = useAtomCommand(environmentCatalog.setEnabled, {
    reportFailure: false,
  });
  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" ||
    activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  // Each reconnect attempt gets its own grace period, including a later one to
  // the same environment.
  const reconnectWarningGraceElapsed = useEnvironmentStateHeldFor(
    activeReconnectingEnvironmentId,
    ENVIRONMENT_RECONNECT_WARNING_GRACE_MS,
  );
  // Fork: spins the retry icon briefly so a click is visibly taken.
  const [reconnectRequested, setReconnectRequested] = useState(false);
  const handleReconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    setReconnectRequested(true);
    setTimeout(() => setReconnectRequested(false), 1_200);
    const result = await retryEnvironment(environmentId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not reconnect environment",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        }),
      );
    }
  };
  const handleReconnectActiveEnvironmentStable = useStableCallback(
    handleReconnectActiveEnvironment,
  );
  const disconnectDelayElapsed = useEnvironmentDisconnectDelay(
    activeEnvironmentUnavailable && activeEnvironment ? activeEnvironment.environmentId : null,
  );
  const canDisconnectActiveEnvironment =
    disconnectDelayElapsed &&
    activeEnvironment !== null &&
    activeEnvironment.entry.target._tag !== "PrimaryConnectionTarget" &&
    !isDesktopLocalConnectionTarget(activeEnvironment.entry.target);
  const [disconnectingEnvironment, setDisconnectingEnvironment] = useState(false);
  const handleDisconnectActiveEnvironment = async (environmentId: EnvironmentId) => {
    setDisconnectingEnvironment(true);
    const result = await setEnvironmentEnabled({ environmentId, enabled: false });
    setDisconnectingEnvironment(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not disconnect server",
            description: error instanceof Error ? error.message : "Failed to disconnect.",
          }),
        );
      }
      return;
    }
    void navigate({ to: "/", replace: true });
  };
  const handleDisconnectActiveEnvironmentStable = useStableCallback(
    handleDisconnectActiveEnvironment,
  );
  const autoBalanceUpdateBanner = useAutoBalanceUpdateBanner(autoUpdateEnvironments);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchServerLabel =
    hasMultipleRegisteredEnvironments && activeThreadEnvironmentId !== null
      ? `${activeEnvironment?.label ?? serverConfig?.environment.label ?? activeThreadEnvironmentId} server`
      : "server";
  const serverUpdateEnvironmentId = activeThreadEnvironmentId;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchInstallation = serverConfig?.environment.capabilities.serverInstallation;
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const versionMismatchThreadContinuation = supportsServerUpdateThreadContinuation(serverConfig);
  const serverUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(serverUpdateEnvironmentId),
  );
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<
    typeof serverUpdateState | null
  >(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState ||
    isServerUpdateFailureDismissed(serverUpdateState);
  return (() => {
    const items: ComposerBannerStackItem[] = [];
    const updateRunning = serverUpdateState.status === "running";
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const disconnectAction =
      canDisconnectActiveEnvironment && activeEnvironmentUnavailableState ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={disconnectingEnvironment}
          title="Hide this server's threads. Switch it on again in Environments."
          onClick={() =>
            void handleDisconnectActiveEnvironmentStable(
              activeEnvironmentUnavailableState.environmentId,
            )
          }
        >
          Disconnect server
        </Button>
      ) : undefined;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner =
      environmentReconnecting && (updateRunning || !reconnectWarningGraceElapsed);
    const showUnavailableBanner =
      activeEnvironmentUnavailableState !== null &&
      unavailableConnection !== null &&
      !suppressUnavailableBanner;
    if (showUnavailableBanner) {
      items.push({
        id: `environment-unavailable:${activeEnvironmentUnavailableState.environmentId}`,
        variant: unavailableConnection.phase === "error" ? "error" : "warning",
        group: "environment",
        icon: <WifiOffIcon />,
        // Fork: the last failure sits behind a small info icon beside the title.
        title: (
          <span className="inline-flex max-w-full items-center gap-1 align-top">
            <span className="truncate">
              {`${activeEnvironmentUnavailableState.label} is ${environmentReconnecting ? "reconnecting" : "offline"}`}
            </span>
            {unavailableConnection.error ? (
              <Popover>
                <PopoverTrigger
                  openOnHover
                  render={
                    <Button
                      size="icon-micro"
                      variant="ghost-muted"
                      aria-label="Show the connection error"
                      className="flex-none"
                    />
                  }
                >
                  <InfoIcon />
                </PopoverTrigger>
                <PopoverPopup
                  aria-label="Connection error"
                  tooltipStyle
                  side="top"
                  align="start"
                  alignOffset={-6}
                  className="max-w-[min(30rem,calc(100vw-2rem))] whitespace-normal wrap-anywhere"
                >
                  {unavailableConnection.error}
                </PopoverPopup>
              </Popover>
            ) : null}
          </span>
        ),
        description: activeEnvironment ? (
          <ConnectionDiagnosisHeadline environment={activeEnvironment} />
        ) : undefined,
        // Fork: retry now, also while a reconnect is waiting for its next try.
        actions: (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Retry now"
                    onClick={() =>
                      void handleReconnectActiveEnvironmentStable(
                        activeEnvironmentUnavailableState.environmentId,
                      )
                    }
                  />
                }
              >
                <RotateCwIcon className={cn(reconnectRequested && "animate-spin")} />
              </TooltipTrigger>
              <TooltipPopup side="top">Retry now</TooltipPopup>
            </Tooltip>
            {disconnectAction}
          </>
        ),
      });
    }
    // An available update is offered by the sidebar's update pill; the composer only shows one
    // that is running or failed, since either explains what this thread's server is doing.
    if (
      !automaticEnvironment &&
      serverUpdateEnvironmentId &&
      serverUpdateState.status !== "idle" &&
      !serverUpdateFailureDismissed
    ) {
      const updateFailed = serverUpdateState.status === "failed";
      items.push({
        id: `server-version:${serverUpdateEnvironmentId}`,
        variant: updateFailed ? "error" : "default",
        group: "environment",
        icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
        title: `${updateFailed ? "Could not update" : "Updating"} ${versionMismatchServerLabel}`,
        description:
          serverUpdateState.status === "failed"
            ? serverUpdateState.message
            : serverUpdateStageLabel(serverUpdateState.stage),
        actions: !updateFailed ? (
          disconnectAction
        ) : !versionMismatch ||
          (versionMismatchSelfUpdate === "desktop-managed" &&
            !versionMismatchDesktopAppUpdate) ? undefined : (
          <ServerUpdateAction
            environmentId={serverUpdateEnvironmentId}
            serverLabel={versionMismatchServerLabel}
            selfUpdate={versionMismatchSelfUpdate}
            installation={versionMismatchInstallation}
            desktopAppUpdate={versionMismatchDesktopAppUpdate}
            threadContinuation={versionMismatchThreadContinuation}
            targetVersion={versionMismatch.clientVersion}
            label="Retry"
            variant="ghost"
          />
        ),
        ...(updateFailed
          ? {
              dismissLabel: "Dismiss update notice",
              onDismiss: () => {
                dismissServerUpdateFailure(serverUpdateState);
                setDismissedServerUpdateState(serverUpdateState);
              },
            }
          : {}),
      });
    }
    if (autoBalanceUpdateBanner) items.push(autoBalanceUpdateBanner);
    return items;
  })() as ComposerBannerStackItem[];
}
