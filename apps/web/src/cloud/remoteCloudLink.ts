/**
 * Fork: T3 Connect for a saved remote environment (e.g. an SSH host), run from this
 * client: its T3 Connect sign-in gets the relay link, its session there signs and
 * applies it. The server starts its tunnel on apply, so no restart is needed.
 */
import { EnvironmentSupervisor, type PreparedConnection } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

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

function remoteCloudLinkTarget(prepared: PreparedConnection): CloudLinkTarget {
  const origin = new URL(prepared.httpBaseUrl).origin;
  return {
    environmentId: prepared.environmentId,
    label: prepared.label,
    httpBaseUrl: origin,
    wsBaseUrl: origin.replace(/^http/, "ws"),
  };
}

/** Runs `run` against the environment in context with this client's bearer session there. */
export const withPreparedBearerSession = Effect.fn("remoteCloudLink.withPreparedBearerSession")(
  function* <A, E, R>(run: (target: CloudLinkTarget) => Effect.Effect<A, E, R>) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = Option.getOrNull(yield* SubscriptionRef.get(supervisor.prepared));
    const authorization = prepared?.httpAuthorization;
    if (prepared === null || authorization?._tag !== "Bearer") {
      return yield* new CloudEnvironmentLinkError({
        message: "Connect to this environment over SSH or a pairing link to manage T3 Connect.",
      });
    }
    return yield* run(remoteCloudLinkTarget(prepared)).pipe(
      Effect.updateService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(HttpClientRequest.bearerToken(authorization.token)),
      ),
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "omit" }),
    );
  },
);
