import { EnvironmentId, GitCommandError, ThreadId, type VcsRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";

const ROOT = "/work/IndiaShipments";
const CHILD = `${ROOT}/frontend`;

const state = vi.hoisted(() => ({
  run: vi.fn(),
  refs: [] as VcsRef[],
}));

vi.mock(import("../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  readEnvironmentScope: (() => true) as never,
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => (value: unknown) => state.run(command, value)) as never,
}));
vi.mock(import("../state/queries"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePaginatedBranches: (() => ({
    refs: state.refs,
    data: { refs: state.refs, nextCursor: null, totalCount: state.refs.length },
    isPending: false,
    isFetchingNextPage: false,
    refresh: vi.fn(),
    loadNext: vi.fn(),
  })) as never,
}));
// The child repository's status names its own branch; the thread itself is on `main`.
vi.mock(import("../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: ((atom: unknown) => ({
    data: atom === null ? null : { refName: "develop", refs: [], pr: null },
    isPending: false,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShell: (() => ({
    id: "thread",
    environmentId: "environment",
    projectId: "project",
    branch: "main",
    worktreePath: null,
    runtime: null,
    pullRequests: [],
  })) as never,
  useProject: (() => ({ id: "project", workspaceRoot: ROOT })) as never,
}));

import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { toastManager } from "./ui/toast";

const ref = (name: string, extra: Partial<VcsRef> = {}): VcsRef =>
  ({
    name,
    current: false,
    isDefault: false,
    isRemote: false,
    worktreePath: null,
    ...extra,
  }) as VcsRef;

type Run = (command: unknown, value: { input: { refName: string } }) => Promise<unknown>;

function callsTo(command: unknown) {
  return state.run.mock.calls.filter(([called]) => called === command).map(([, value]) => value);
}

const succeedWithRef: Run = async (_command, value) =>
  AsyncResult.success({ refName: value.input.refName.replace(/^origin\//, "") });

async function renderChildSelector(run: Run = succeedWithRef) {
  state.run.mockReset().mockImplementation(run);
  state.refs = [
    ref("develop", { current: true, worktreePath: CHILD }),
    ref("feature/login"),
    ref("origin/release", { isRemote: true }),
  ];
  return render(
    <BranchToolbarBranchSelector
      displayMode="panel"
      environmentId={EnvironmentId.make("environment")}
      threadId={ThreadId.make("thread")}
      envLocked={false}
      startFromOrigin={false}
      onStartFromOriginChange={() => {}}
      repositoryCwd={CHILD}
    />,
  );
}

async function pick(name: string | RegExp) {
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name }).click();
}

describe("BranchToolbarBranchSelector for a child repository", () => {
  it("shows the child's checked-out branch, not the thread's", async () => {
    await using screen = await renderChildSelector();
    await expect.element(screen.getByText("develop")).toBeVisible();
    expect(screen.container.textContent).not.toContain("main");
  });

  it("switches refs in the child's working tree and leaves the thread alone", async () => {
    await using _screen = await renderChildSelector();

    await pick("feature/login");
    await vi.waitFor(() =>
      expect(callsTo(vcsEnvironment.switchRef)).toEqual([
        { environmentId: "environment", input: { cwd: CHILD, refName: "feature/login" } },
      ]),
    );

    await pick(/origin\/release/);
    await vi.waitFor(() => expect(callsTo(vcsEnvironment.switchRef)).toHaveLength(2));
    expect(callsTo(vcsEnvironment.switchRef)[1]).toEqual({
      environmentId: "environment",
      input: { cwd: CHILD, refName: "origin/release" },
    });
    expect(callsTo(threadEnvironment.updateMetadata)).toEqual([]);
    expect(callsTo(threadEnvironment.stopSession)).toEqual([]);
  });

  it("creates a new ref in the child's working tree", async () => {
    await using _screen = await renderChildSelector();

    await page.getByRole("combobox").click();
    await page.getByPlaceholder(/search/i).fill("child work");
    await page.getByRole("option", { name: /Create new ref "child-work"/ }).click();

    await vi.waitFor(() =>
      expect(callsTo(vcsEnvironment.createRef)).toEqual([
        {
          environmentId: "environment",
          input: { cwd: CHILD, refName: "child-work", switchRef: true },
        },
      ]),
    );
    expect(callsTo(threadEnvironment.updateMetadata)).toEqual([]);
  });

  it("reports a checkout that a dirty child working tree blocks, like the root", async () => {
    using addToast = vi.spyOn(toastManager, "add");
    await using screen = await renderChildSelector(async (command, value) =>
      command === vcsEnvironment.switchRef
        ? AsyncResult.failure(
            Cause.fail(
              new GitCommandError({
                operation: "GitVcsDriver.switchRef.checkout",
                command: "git checkout",
                cwd: CHILD,
                detail: "Your local changes would be overwritten by checkout",
              }),
            ),
          )
        : succeedWithRef(command, value),
    );

    await pick("feature/login");

    await vi.waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", title: "Failed to switch ref." }),
      ),
    );
    await expect.element(screen.getByText("develop")).toBeVisible();
  });
});
