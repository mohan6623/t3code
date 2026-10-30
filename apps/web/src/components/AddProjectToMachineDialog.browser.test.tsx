import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

const project = vi.hoisted(() => {
  let value: unknown = null;
  const listeners = new Set<() => void>();
  return {
    // Each test starts from no project and no listeners left by an earlier test.
    setup: (initial: unknown) => {
      value = initial;
      listeners.clear();
    },
    get: () => value,
    set: (next: unknown) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock(import("../state/entities"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    readProject: (() => project.get()) as never,
    subscribeProject: ((_ref: unknown, listener: (value: unknown) => void) =>
      project.subscribe(() => listener(project.get()))) as never,
    useProject: (() => useSyncExternalStore(project.subscribe, project.get)) as never,
  };
});
// Fork: a test can give the source machine an ignored-file listing to show.
const sourceListing = vi.hoisted(() => ({
  environments: [] as unknown[],
  data: null as unknown,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: sourceListing.environments })) as never,
}));
vi.mock(import("../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((atom: unknown) => ({
    data: atom === null ? null : sourceListing.data,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: atom !== null && sourceListing.data !== null,
    refresh: () => undefined,
  })) as never,
}));
vi.mock(import("../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => () => undefined) as never,
}));
vi.mock(import("../hooks/useAddProjectTargets"), async (original) => ({
  ...(await original()),
  useAddProjectTargets: (() => []) as never,
}));
vi.mock(import("../hooks/useLogicalProjectEnvironments"), async (original) => ({
  ...(await original()),
  useLogicalProjectEnvironments: (() => []) as never,
}));

import {
  AddProjectToMachineDialogHost,
  openAddProjectToMachine,
} from "./AddProjectToMachineDialog";

const environmentId = EnvironmentId.make("environment-1");
const projectRef = scopeProjectRef(environmentId, ProjectId.make("project-1"));
const PROJECT = {
  environmentId,
  id: projectRef.projectId,
  title: "Repo",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
};

describe("AddProjectToMachineDialog", () => {
  it("lists nested repositories and their ignored files", async () => {
    project.setup(PROJECT);
    sourceListing.environments = [
      {
        environmentId,
        label: "Laptop",
        serverConfig: {
          environment: {
            platform: { machine: "laptop" },
            capabilities: { ignoredFileListing: true },
          },
        },
      },
    ];
    sourceListing.data = {
      files: [{ path: ".env", byteLength: 6 }],
      truncated: false,
      nestedRepositories: [
        {
          relativePath: "backend",
          name: "backend",
          remoteUrl: null,
          branch: "main",
          branchPushed: false,
          unpushedCommits: 0,
          files: [],
          truncated: false,
        },
        {
          relativePath: "frontend",
          name: "frontend",
          remoteUrl: "https://example.com/frontend.git",
          branch: "feature",
          branchPushed: true,
          unpushedCommits: 0,
          files: [{ path: ".env", byteLength: 8 }],
          truncated: false,
        },
      ],
    };
    try {
      await using screen = await render(<AddProjectToMachineDialogHost />);
      await act(() => openAddProjectToMachine({ projectRef, targetEnvironmentId: null }));

      await expect.element(screen.getByText("Nested repositories")).toBeInTheDocument();
      await expect.element(screen.getByText("3 git clones")).toBeInTheDocument();
      await expect.element(screen.getByText("No remote, skipped")).toBeInTheDocument();
      await expect.element(screen.getByText("feature", { exact: true })).toBeInTheDocument();
      await expect.element(screen.getByText("frontend/.env")).toBeInTheDocument();
      // Env files are picked by default, the nested repository's included.
      await expect.element(screen.getByText("+ 2 files")).toBeInTheDocument();
    } finally {
      sourceListing.environments = [];
      sourceListing.data = null;
    }
  });

  it("closes when its project goes away", async () => {
    project.setup(PROJECT);
    await using screen = await render(<AddProjectToMachineDialogHost />);

    await act(() => openAddProjectToMachine({ projectRef, targetEnvironmentId: null }));
    await expect.element(screen.getByText("Add to another machine")).toBeInTheDocument();

    await act(() => project.set(null));
    await act(() => project.set(PROJECT));
    await expect.element(screen.getByText("Add to another machine")).not.toBeInTheDocument();
  });

  it("does not reopen for a project that vanished before the dialog showed", async () => {
    project.setup(PROJECT);
    await using screen = await render(<AddProjectToMachineDialogHost />);

    await act(() => {
      openAddProjectToMachine({ projectRef, targetEnvironmentId: null });
      project.set(null);
    });
    await act(() => project.set(PROJECT));

    await expect.element(screen.getByText("Add to another machine")).not.toBeInTheDocument();
  });
});
