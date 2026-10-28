// Fork: atoms for T3 Connect on a saved remote environment (see remoteCloudLink.ts).
import {
  createEnvironmentCommand,
  createEnvironmentQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import {
  linkEnvironmentToCloud,
  readCloudLinkState,
  unlinkEnvironmentFromCloud,
} from "./linkEnvironment";
import { withPreparedBearerSession } from "./remoteCloudLink";

export const remoteCloudLinkState = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "web:cloud:remote-link-state",
  staleTimeMs: 30_000,
  execute: (_input: null) => withPreparedBearerSession((target) => readCloudLinkState({ target })),
});

export const linkRemoteEnvironment = createEnvironmentCommand(connectionAtomRuntime, {
  label: "web:cloud:link-remote-environment",
  execute: (input: { readonly clerkToken: string }) =>
    withPreparedBearerSession((target) =>
      linkEnvironmentToCloud({ target, clerkToken: input.clerkToken, mode: "managed" }),
    ),
});

export const unlinkRemoteEnvironment = createEnvironmentCommand(connectionAtomRuntime, {
  label: "web:cloud:unlink-remote-environment",
  execute: (input: { readonly clerkToken: string | null }) =>
    withPreparedBearerSession((target) =>
      unlinkEnvironmentFromCloud({ target, clerkToken: input.clerkToken }),
    ),
});
