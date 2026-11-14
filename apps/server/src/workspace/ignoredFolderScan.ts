// @effect-diagnostics nodeBuiltinImport:off -- Needs readdir's Dirent types, which Effect lacks.
/**
 * Fork: `git ls-files --directory` folds a folder git does not track into one `name/` entry,
 * which hides the env files and child repositories inside it. This walks those folders for
 * just those two things, so moving a project to another machine still finds them.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

// Dependency and build output folders can carry a stray `.git` or `.env`; they are never wanted.
export const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
]);

const ENV_FILE_NAME = /^(?:\.env(?:\..+)?|\.envrc|\.dev\.vars)$/;
const MAX_DEPTH = 6;
// Bounds the walk when an unexpected folder (say, a data dump) is huge.
const MAX_DIRECTORIES = 2_000;

export interface IgnoredFolderScan {
  /** Env files outside any child repository, relative to the root. */
  readonly envFiles: ReadonlyArray<string>;
  /** Folders holding a `.git` entry, relative to the root. The walk stops at each. */
  readonly repositories: ReadonlyArray<string>;
}

function isWalkable(name: string): boolean {
  return !name.startsWith(".") && !SKIPPED_FOLDER_NAMES.has(name);
}

/** `entries` is raw `git ls-files --directory -z` output split on NUL; only `name/` folders count. */
export async function scanFoldedFolders(
  root: string,
  entries: ReadonlyArray<string>,
): Promise<IgnoredFolderScan> {
  const envFiles: Array<string> = [];
  const repositories: Array<string> = [];
  const queue = entries
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => entry.slice(0, -1))
    .filter((folder) => folder.length > 0 && folder.split("/").every(isWalkable))
    .map((folder) => ({ folder, depth: 0 }));
  let visited = 0;
  while (queue.length > 0 && visited < MAX_DIRECTORIES) {
    const { folder, depth } = queue.shift()!;
    visited += 1;
    const children = await NodeFSP.readdir(NodePath.join(root, ...folder.split("/")), {
      withFileTypes: true,
    }).catch(() => []);
    if (children.some((child) => child.name === ".git")) {
      repositories.push(folder);
      continue;
    }
    for (const child of children) {
      const relativePath = `${folder}/${child.name}`;
      // Dirent types come from lstat, so symlinks are neither followed nor listed.
      if (child.isFile() && ENV_FILE_NAME.test(child.name)) envFiles.push(relativePath);
      else if (child.isDirectory() && depth < MAX_DEPTH && isWalkable(child.name)) {
        queue.push({ folder: relativePath, depth: depth + 1 });
      }
    }
  }
  return { envFiles, repositories };
}
