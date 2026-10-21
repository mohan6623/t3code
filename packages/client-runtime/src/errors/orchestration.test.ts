import {
  CommandId,
  OrchestrationDispatchCommandError,
  OrchestrationV2DispatchCommandError,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  wasBootstrapThreadDeleted,
  wasBootstrapThreadNotCreated,
  wasDiscardRefused,
} from "./orchestration.ts";

describe("wasDiscardRefused", () => {
  it("accepts only the conditional discard rejections", () => {
    const base = {
      commandId: CommandId.make("delete-side-chat"),
      commandType: "thread.delete",
      message: "Thread thread-1 is no longer empty.",
    };
    expect(
      wasDiscardRefused(
        new OrchestrationV2DispatchCommandError({ ...base, reason: "thread_not_empty" }),
      ),
    ).toBe(true);
    expect(
      wasDiscardRefused(
        new OrchestrationV2DispatchCommandError({ ...base, reason: "thread_not_side_chat" }),
      ),
    ).toBe(true);
    expect(wasDiscardRefused(new OrchestrationV2DispatchCommandError(base))).toBe(false);
    expect(wasDiscardRefused(new Error("connection lost"))).toBe(false);
  });
});

describe("wasBootstrapThreadDeleted", () => {
  it("accepts only a confirmed deleted bootstrap thread", () => {
    expect(
      wasBootstrapThreadDeleted(
        new OrchestrationDispatchCommandError({
          message: "Failed to create worktree.",
          bootstrapThreadDisposition: "deleted",
        }),
      ),
    ).toBe(true);
    expect(
      wasBootstrapThreadDeleted(
        new OrchestrationDispatchCommandError({ message: "Failed to create worktree." }),
      ),
    ).toBe(false);
    expect(wasBootstrapThreadDeleted(new Error("connection lost"))).toBe(false);
  });
});

describe("wasBootstrapThreadNotCreated", () => {
  it("accepts only a confirmed never-created bootstrap thread", () => {
    const notCreated = new OrchestrationDispatchCommandError({
      message: "A separate worktree requires a base commit.",
      bootstrapThreadDisposition: "not-created",
    });
    expect(wasBootstrapThreadNotCreated(notCreated)).toBe(true);
    expect(wasBootstrapThreadDeleted(notCreated)).toBe(false);
    expect(
      wasBootstrapThreadNotCreated(
        new OrchestrationDispatchCommandError({
          message: "Failed to create worktree.",
          bootstrapThreadDisposition: "deleted",
        }),
      ),
    ).toBe(false);
    expect(
      wasBootstrapThreadNotCreated(
        new OrchestrationDispatchCommandError({
          message: "Failed to create worktree.",
        }),
      ),
    ).toBe(false);
    expect(wasBootstrapThreadNotCreated(new Error("connection lost"))).toBe(false);
  });
});
