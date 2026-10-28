import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { afterEach, beforeEach, vi } from "vite-plus/test";
import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  type PreparedConnection,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { type RpcSession, layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { ManagedRelay } from "@t3tools/client-runtime/relay";

import { linkEnvironmentToCloud, unlinkEnvironmentFromCloud } from "./linkEnvironment";
import { canLinkFromThisClient, withPreparedBearerSession } from "./remoteCloudLink";

vi.mock("./relayClientInstallDialog", () => ({
  requestRelayClientInstallConfirmation: vi.fn().mockResolvedValue(true),
  reportRelayClientInstallProgress: vi.fn(),
  finishRelayClientInstall: vi.fn(),
}));

const ENVIRONMENT_ID = EnvironmentId.make("remote-1");
const FORWARDED_BASE_URL = "http://127.0.0.1:41234";

function preparedConnection(overrides?: Partial<PreparedConnection>): PreparedConnection {
  return {
    environmentId: ENVIRONMENT_ID,
    label: "cursor-vm",
    httpBaseUrl: `${FORWARDED_BASE_URL}/`,
    socketUrl: `${FORWARDED_BASE_URL.replace("http", "ws")}/ws`,
    httpAuthorization: { _tag: "Bearer", token: "remote-bearer" },
    target: new SshConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "cursor-vm",
      connectionId: "ssh-1",
    }),
    ...overrides,
  };
}

const relay = {
  createEnvironmentLinkChallenge: vi.fn(),
  linkEnvironment: vi.fn(),
  unlinkEnvironment: vi.fn(),
};

function layerServices(prepared: PreparedConnection | null) {
  const layerSupervisor = Layer.effect(
    EnvironmentSupervisor.EnvironmentSupervisor,
    Effect.gen(function* () {
      const client = {
        [WS_METHODS.cloudGetRelayClientStatus]: () =>
          Effect.succeed({ status: "available", version: "2026.6.0" }),
      } as unknown as RpcSession["client"];
      return EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: prepared?.target ?? preparedConnection().target,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some({ client } as unknown as RpcSession)),
        prepared: yield* SubscriptionRef.make(Option.fromNullishOr(prepared)),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    }),
  );
  const layerRegistry = Layer.effect(
    EnvironmentRegistry.EnvironmentRegistry,
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      return EnvironmentRegistry.EnvironmentRegistry.of({
        run: <A, E, R>(_environmentId: EnvironmentId, effect: Effect.Effect<A, E, R>) =>
          Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        runStream: <A, E, R>(_environmentId: EnvironmentId, stream: Stream.Stream<A, E, R>) =>
          Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
    }),
  );
  return Layer.mergeAll(
    layerRemoteHttpClient((input, init) => globalThis.fetch(input, init)),
    Layer.succeed(
      ManagedRelay.ManagedRelayClient,
      relay as unknown as ManagedRelay.ManagedRelayClient["Service"],
    ),
    layerRegistry,
  ).pipe(Layer.provideMerge(layerSupervisor));
}

function respond(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = routes[new URL(request.url).pathname];
    return body === undefined ? new Response(null, { status: 404 }) : Response.json(body);
  });
}

async function requestAt(fetchMock: ReturnType<typeof respond>, index: number) {
  const [input, init] = fetchMock.mock.calls[index] ?? [];
  const request = new Request(input as RequestInfo, init);
  const text = await request.text();
  return {
    url: request.url,
    authorization: request.headers.get("authorization"),
    credentials: request.credentials,
    body: text === "" ? null : (JSON.parse(text) as unknown),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
  relay.createEnvironmentLinkChallenge.mockReturnValue(
    Effect.succeed({ challenge: "challenge-1", expiresAt: "2026-10-28T00:05:00.000Z" }),
  );
  relay.linkEnvironment.mockReturnValue(
    Effect.succeed({
      ok: true,
      cloudUserId: "user-1",
      environmentId: ENVIRONMENT_ID,
      endpoint: { providerKind: "cloudflare_tunnel" },
      endpointRuntime: { providerKind: "cloudflare_tunnel", connectorToken: "connector-token" },
      relayIssuer: "https://relay.example.test",
      environmentCredential: "environment-credential",
      cloudMintPublicKey: "mint-public-key",
    }),
  );
  relay.unlinkEnvironment.mockReturnValue(Effect.void);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("remote environment T3 Connect link", () => {
  it("links only over a loopback route with a bearer session", () => {
    expect(canLinkFromThisClient(preparedConnection())).toBe(true);
    expect(
      canLinkFromThisClient(preparedConnection({ httpBaseUrl: "http://100.64.0.7:3773/" })),
    ).toBe(false);
    expect(
      canLinkFromThisClient(
        preparedConnection({
          httpAuthorization: { _tag: "Dpop", accessToken: "token", expiresAtEpochMs: 0 },
        }),
      ),
    ).toBe(false);
    expect(canLinkFromThisClient(preparedConnection({ httpAuthorization: null }))).toBe(false);
  });

  it.effect("signs and applies the link on that server with its own session", () =>
    Effect.gen(function* () {
      const fetchMock = respond({
        "/api/connect/link-proof": "link-proof-jwt",
        "/api/connect/relay-config": { ok: true, endpointRuntimeStatus: { status: "running" } },
      });
      vi.stubGlobal("fetch", fetchMock);

      yield* withPreparedBearerSession((target) =>
        linkEnvironmentToCloud({ target, clerkToken: "clerk-token", mode: "managed" }),
      ).pipe(Effect.provide(layerServices(preparedConnection())));

      expect(relay.createEnvironmentLinkChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ clerkToken: "clerk-token" }),
      );
      expect(relay.linkEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkToken: "clerk-token",
          payload: expect.objectContaining({ proof: "link-proof-jwt" }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const proof = yield* Effect.promise(() => requestAt(fetchMock, 0));
      expect(proof).toMatchObject({
        url: `${FORWARDED_BASE_URL}/api/connect/link-proof`,
        authorization: "Bearer remote-bearer",
        body: {
          challenge: "challenge-1",
          endpoint: { httpBaseUrl: FORWARDED_BASE_URL, providerKind: "cloudflare_tunnel" },
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 41234 },
        },
      });
      expect(proof.credentials).not.toBe("include");
      const config = yield* Effect.promise(() => requestAt(fetchMock, 1));
      expect(config).toMatchObject({
        url: `${FORWARDED_BASE_URL}/api/connect/relay-config`,
        authorization: "Bearer remote-bearer",
        body: { cloudUserId: "user-1", environmentCredential: "environment-credential" },
      });
    }),
  );

  it.effect("unlinks on that server and revokes the relay link", () =>
    Effect.gen(function* () {
      const fetchMock = respond({
        "/api/connect/unlink": { ok: true, endpointRuntimeStatus: { status: "disabled" } },
      });
      vi.stubGlobal("fetch", fetchMock);

      yield* withPreparedBearerSession((target) =>
        unlinkEnvironmentFromCloud({ target, clerkToken: "clerk-token" }),
      ).pipe(Effect.provide(layerServices(preparedConnection())));

      const unlink = yield* Effect.promise(() => requestAt(fetchMock, 0));
      expect(unlink).toMatchObject({
        url: `${FORWARDED_BASE_URL}/api/connect/unlink`,
        authorization: "Bearer remote-bearer",
      });
      expect(relay.unlinkEnvironment).toHaveBeenCalledWith({
        clerkToken: "clerk-token",
        environmentId: ENVIRONMENT_ID,
      });
    }),
  );

  it.effect("fails without a bearer session there", () =>
    Effect.gen(function* () {
      const fetchMock = respond({});
      vi.stubGlobal("fetch", fetchMock);

      const exit = yield* withPreparedBearerSession((target) =>
        unlinkEnvironmentFromCloud({ target, clerkToken: null }),
      ).pipe(Effect.provide(layerServices(null)), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );
});
