import type { EnvironmentId, VcsRepository } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";

const NO_REPOSITORIES: ReadonlyArray<VcsRepository> = [];

/**
 * Repositories a multi-repo workspace folder holds, including a repository root that holds
 * others. Asked once Git status has answered for `cwd`; the server only reads the filesystem.
 */
export function useWorkspaceRepositories(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly isRepo: boolean | undefined;
}): ReadonlyArray<VcsRepository> {
  const query = useEnvironmentQuery(
    input.environmentId !== null && input.cwd !== null && input.isRepo !== undefined
      ? vcsEnvironment.listRepositories({
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        })
      : null,
  );
  return query.data?.repositories ?? NO_REPOSITORIES;
}
