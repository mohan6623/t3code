import { describe, expect, it } from "vite-plus/test";

import {
  claimWorkspaceBasenameLookup,
  needsWorkspaceSuffixLookup,
  pickWorkspaceBasenameMatch,
  pickWorkspaceSuffixMatch,
} from "@t3tools/client-runtime/workspace-basename-lookup";

describe("pickWorkspaceBasenameMatch", () => {
  const entries = [
    { path: "apps/web/src/components/ChatView.test.tsx", kind: "file" as const },
    { path: "apps/web/src/components/ChatView.tsx", kind: "file" as const },
  ];

  it("takes the first exact filename match, not the closest fuzzy one", () => {
    expect(pickWorkspaceBasenameMatch("ChatView.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  // regression: #6297 a bare filename resolves to a file, never a same-named directory
  it("ignores directories", () => {
    expect(
      pickWorkspaceBasenameMatch("components", [
        { path: "apps/web/src/components", kind: "directory" },
        { path: "apps/web/src/components/components", kind: "file" },
      ]),
    ).toBe("apps/web/src/components/components");
  });

  it("prefers the exactly-cased file over a case-only twin", () => {
    expect(
      pickWorkspaceBasenameMatch("foo.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBe("src/foo.ts");
  });

  it("falls back to case-insensitive when only the casing differs", () => {
    expect(pickWorkspaceBasenameMatch("chatview.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  it("returns null when the case-insensitive fallback is ambiguous", () => {
    expect(
      pickWorkspaceBasenameMatch("FOO.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBeNull();
  });
});

describe("claimWorkspaceBasenameLookup", () => {
  it("keeps only the newest claim, whatever order the lookups settle in", () => {
    const first = claimWorkspaceBasenameLookup();
    const second = claimWorkspaceBasenameLookup();

    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });
});

describe("pickWorkspaceSuffixMatch", () => {
  const cwd = "/workspace/signet-solutions/IndiaShipments";
  const entries = [
    { path: "frontend/src/lib/profile/phone.ts", kind: "file" as const },
    { path: "frontend/src/lib/ui/phone.ts", kind: "file" as const },
    { path: "frontend/src/lib/profile", kind: "directory" as const },
  ];

  it("finds the one file a short path names from inside a subfolder", () => {
    expect(pickWorkspaceSuffixMatch("profile/phone.ts", cwd, entries)).toBe(
      "frontend/src/lib/profile/phone.ts",
    );
  });

  it("matches whole segments only", () => {
    expect(pickWorkspaceSuffixMatch("file/phone.ts", cwd, entries)).toBeNull();
  });

  it("opens nothing new when the tail is ambiguous", () => {
    expect(pickWorkspaceSuffixMatch("lib/phone.ts", cwd, entries)).toBeNull();
  });

  it("folds case only on Windows workspaces", () => {
    expect(pickWorkspaceSuffixMatch("Profile/phone.ts", cwd, entries)).toBeNull();
    expect(
      pickWorkspaceSuffixMatch("Profile\\phone.ts", "C:\\repo", [
        { path: "src\\profile\\phone.ts", kind: "file" },
      ]),
    ).toBe("src\\profile\\phone.ts");
  });
});

describe("needsWorkspaceSuffixLookup", () => {
  it("takes plain multi-segment relative paths only", () => {
    expect(needsWorkspaceSuffixLookup("profile/phone.ts")).toBe(true);
    expect(needsWorkspaceSuffixLookup("phone.ts")).toBe(false);
    expect(needsWorkspaceSuffixLookup("./profile/phone.ts")).toBe(false);
    expect(needsWorkspaceSuffixLookup("../profile/phone.ts")).toBe(false);
    expect(needsWorkspaceSuffixLookup("/abs/profile/phone.ts")).toBe(false);
  });
});
