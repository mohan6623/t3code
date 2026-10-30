import { isAbsolutePath, isWindowsAbsolutePath } from "@t3tools/shared/path";

export const WORKSPACE_BASENAME_LOOKUP_LIMIT = 25;

// All callers open one panel; the newest click must win across callers.
let latestLookupSequence = 0;

export function claimWorkspaceBasenameLookup(): () => boolean {
  latestLookupSequence += 1;
  const claimed = latestLookupSequence;
  return () => claimed === latestLookupSequence;
}

export interface WorkspaceEntryCandidate {
  readonly path: string;
  readonly kind: "file" | "directory";
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export function needsWorkspaceBasenameLookup(relativePath: string): boolean {
  const trimmed = relativePath.trim();
  return (
    trimmed !== "." &&
    trimmed !== ".." &&
    trimmed.length > 0 &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  );
}

export function pickWorkspaceBasenameMatch(
  basename: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const target = basename.trim();
  if (!target) return null;
  const files = entries.filter((entry) => entry.kind === "file");
  const exact = files.find((entry) => basenameOfPath(entry.path) === target);
  if (exact) return exact.path;
  const folded = target.toLowerCase();
  const foldedMatches = files.filter(
    (entry) => basenameOfPath(entry.path).toLowerCase() === folded,
  );
  return foldedMatches.length === 1 ? (foldedMatches[0]?.path ?? null) : null;
}

// Repository-relative paths can repeat the project's suffix in subfolder projects.
export function stripRepeatedWorkspacePrefix(relativePath: string, cwd: string): string | null {
  if (isAbsolutePath(relativePath)) return null;
  const pathSegments = relativePath.split(/[\\/]+/);
  const cwdSegments = cwd.split(/[\\/]+/).filter(Boolean);
  const fold = isWindowsAbsolutePath(cwd)
    ? (segment: string | undefined) => segment?.toLowerCase()
    : (segment: string | undefined) => segment;
  for (let count = Math.min(cwdSegments.length, pathSegments.length - 1); count > 0; count--) {
    const prefix = cwdSegments.slice(-count);
    if (prefix.every((segment, index) => fold(segment) === fold(pathSegments[index]))) {
      return pathSegments.slice(count).join("/") || null;
    }
  }
  return null;
}

// Fork: agents often name a file by a short path from inside a subfolder or nested
// repo, e.g. `profile/phone.ts` for `frontend/src/lib/profile/phone.ts`. When the
// literal path is missing, such a path is looked up as a path tail.
export function needsWorkspaceSuffixLookup(relativePath: string): boolean {
  const trimmed = relativePath.trim().replaceAll("\\", "/");
  if (isAbsolutePath(trimmed) || /^(?:~|\.{1,2})\//.test(trimmed)) return false;
  const segments = trimmed.split("/").filter(Boolean);
  return segments.length >= 2 && !segments.includes("..") && !segments.includes(".");
}

// Fork: the one file whose path ends with the whole tail; ambiguous tails open nothing new.
export function pickWorkspaceSuffixMatch(
  tail: string,
  cwd: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const caseInsensitive = isWindowsAbsolutePath(cwd);
  const key = (path: string) => {
    const normalized = `/${path.trim().replaceAll("\\", "/").replace(/^\/+/, "")}`;
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const target = key(tail);
  const matches = entries.filter(
    (entry) => entry.kind === "file" && key(entry.path).endsWith(target),
  );
  return matches.length === 1 ? (matches[0]?.path ?? null) : null;
}

export function pickStrippedWorkspaceMatch(
  strippedPath: string,
  cwd: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const caseInsensitive = isWindowsAbsolutePath(cwd);
  const key = (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const files = entries.filter((entry) => entry.kind === "file");
  return files.find((entry) => key(entry.path) === key(strippedPath))?.path ?? null;
}
