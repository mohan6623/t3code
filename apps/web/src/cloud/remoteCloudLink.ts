/**
 * Fork: T3 Connect for a saved remote environment (e.g. an SSH host), run from this
 * client: its T3 Connect sign-in gets the relay link, its session there signs and
 * applies it. The server starts its tunnel on apply, so no restart is needed.
 */
import { EnvironmentSupervisor, type PreparedConnection } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { isLoopbackHostname } from "../environments/primary/target";
import { CloudEnvironmentLinkError, type CloudLinkTarget } from "./linkEnvironment";

/**
 * The server signs a link proof only for a loopback request, which an SSH
 * forward is. A direct LAN or Tailscale route reaches it on another host.
 */
export function canLinkFromThisClient(
  prepared: Pick<PreparedConnection, "httpBaseUrl" | "httpAuthorization">,
): boolean {
  if (prepared.httpAuthorization?._tag !== "Bearer") return false;
  try {
    return isLoopbackHostname(new URL(prepared.httpBaseUrl).hostname);
  } catch {
    return false;
  }
}

/** Runs `run` on the environment in context, which must hold a bearer session from this client. */
export const withPreparedBearerSession = Effect.fn("remoteCloudLink.withPreparedBearerSession")(
  function* <A, E, R>(run: (target: CloudLinkTarget) => Effect.Effect<A, E, R>) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = Option.getOrNull(yield* SubscriptionRef.get(supervisor.prepared));
    if (prepared === null || prepared.httpAuthorization?._tag !== "Bearer") {
      return yield* new CloudEnvironmentLinkError({
        message: "Connect to this environment over SSH or a pairing link to manage T3 Connect.",
      });
    }
    return yield* run({ environmentId: prepared.environmentId });
  },
);
