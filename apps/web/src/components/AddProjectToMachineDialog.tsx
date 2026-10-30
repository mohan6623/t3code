import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getAddProjectInitialQuery,
  getCloneDestinationPath,
  getCloneDirectoryName,
} from "@t3tools/client-runtime/operations/projects";
import {
  type EnvironmentId,
  type ProjectIgnoredFile,
  type ProjectNestedRepository,
  type ScopedProjectRef,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  type CloneProtocol,
  cloneUrlForProtocol,
  cloneUrlProtocol,
} from "@t3tools/shared/cloneUrl";
import { ArrowRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { create } from "zustand";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useAddProjectTargets } from "../hooks/useAddProjectTargets";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useLogicalProjectEnvironments } from "../hooks/useLogicalProjectEnvironments";
import {
  COPYABLE_FILE_MAX_BYTES,
  addProjectToMachine,
  isDefaultCopiedFile,
} from "../lib/addProjectToMachine";
import { formatBytes } from "../lib/formatBytes";
import { newProjectId } from "../lib/utils";
import { readProject, subscribeProject, useProject } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { MiddleTruncate } from "./ui/middle-truncate";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

interface AddProjectToMachineRequest {
  readonly projectRef: ScopedProjectRef;
  readonly targetEnvironmentId: EnvironmentId | null;
}

const useRequest = create<{ request: AddProjectToMachineRequest | null; session: number }>(() => ({
  request: null,
  session: 0,
}));

let endRequestWithProject: (() => void) | null = null;

/** Opens the dialog that clones a project onto another connected machine. */
export function openAddProjectToMachine(request: AddProjectToMachineRequest) {
  if (readProject(request.projectRef) === null) return;
  endRequestWithProject?.();
  // The request ends when its project goes away, so a project that comes back
  // later cannot reopen a dialog nobody asked for.
  endRequestWithProject = subscribeProject(request.projectRef, (project) => {
    if (project === null) close();
  });
  useRequest.setState((state) => ({ request, session: state.session + 1 }));
}

function close() {
  endRequestWithProject?.();
  endRequestWithProject = null;
  useRequest.setState({ request: null });
}

export function AddProjectToMachineDialogHost() {
  const request = useRequest((state) => state.request);
  const session = useRequest((state) => state.session);
  return request ? <AddProjectToMachineDialog key={session} request={request} /> : null;
}

function AddProjectToMachineDialog({ request }: { request: AddProjectToMachineRequest }) {
  const id = useId();
  const project = useProject(request.projectRef);
  const handleNewThread = useNewThreadHandler();
  const { draftId: routeDraftId } = useParams({ strict: false });
  const { environments } = useEnvironments();
  const targets = useAddProjectTargets(project, useLogicalProjectEnvironments(project, false));
  const [targetId, setTargetId] = useState(request.targetEnvironmentId);
  const target = targets.find((t) => t.environmentId === targetId) ?? targets[0] ?? null;
  const source = environments.find((env) => env.environmentId === request.projectRef.environmentId);
  const sourceUrl =
    project?.repositoryIdentity?.origin?.remoteUrl ??
    project?.repositoryIdentity?.locator.remoteUrl ??
    "";
  const [protocol, setProtocol] = useState<CloneProtocol | null>(() => cloneUrlProtocol(sourceUrl));
  const sshUrl = cloneUrlForProtocol(sourceUrl, "ssh");
  const httpsUrl = cloneUrlForProtocol(sourceUrl, "https");
  const remoteUrl =
    (protocol === "ssh" ? sshUrl : protocol === "https" ? httpsUrl : null) ?? sourceUrl;

  const targetEnvironment = environments.find((env) => env.environmentId === target?.environmentId);
  const defaultPath = getCloneDestinationPath(
    getAddProjectInitialQuery(targetEnvironment?.serverConfig?.settings.addProjectBaseDirectory),
    getCloneDirectoryName(sourceUrl),
  );
  const [pathOverride, setPathOverride] = useState<string | null>(null);
  const destinationPath = pathOverride ?? defaultPath;

  const canListFiles = source?.serverConfig?.environment.capabilities.ignoredFileListing === true;
  const ignoredFiles = useEnvironmentQuery(
    project && canListFiles
      ? projectEnvironment.listIgnoredFiles({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot },
        })
      : null,
  );
  // Fork: repositories nested in the project are cloned too; their ignored files list
  // below the root's with the repository's path in front.
  const nestedRepositories = ignoredFiles.data?.nestedRepositories ?? [];
  const files = [
    ...(ignoredFiles.data?.files ?? []),
    ...nestedRepositories.flatMap((repository) =>
      repository.files.map((file) => ({
        ...file,
        path: `${repository.relativePath}/${file.path}`,
      })),
    ),
  ];
  const filesTruncated =
    ignoredFiles.data?.truncated === true ||
    nestedRepositories.some((repository) => repository.truncated);
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const selectedFiles = selected ?? defaultSelection(files);
  const copyable = files.filter((file) => file.byteLength <= COPYABLE_FILE_MAX_BYTES);
  const selectedBytes = files
    .filter((file) => selectedFiles.has(file.path))
    .reduce((total, file) => total + file.byteLength, 0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The project or every target can vanish while the dialog is open. Submitting
  // before the file list loads would silently skip the default .env copies.
  const unavailable =
    project === null ||
    target === null ||
    (canListFiles && ignoredFiles.data === null && ignoredFiles.error === null);
  const toggleFile = (path: string, checked: boolean) => {
    const next = new Set(selectedFiles);
    if (checked) next.add(path);
    else next.delete(path);
    setSelected(next);
  };

  // Lands the user on the new machine right away; its composer shows the clone
  // and holds sends until it finishes. A draft open on the source project moves
  // over with whatever was typed in it.
  const openClonedProject = (targetRef: ScopedProjectRef) => {
    const drafts = useComposerDraftStore.getState();
    const draftId = routeDraftId as DraftId | undefined;
    const draft = draftId ? drafts.getDraftSession(draftId) : null;
    if (
      draftId &&
      draft &&
      !draft.promotedTo &&
      draft.environmentId === request.projectRef.environmentId &&
      draft.projectId === request.projectRef.projectId
    ) {
      drafts.setDraftThreadContext(draftId, {
        projectRef: targetRef,
        environmentSelection: "manual",
        loadBalancedEnvironmentId: null,
      });
      return;
    }
    void handleNewThread(targetRef);
  };

  const submit = async () => {
    if (!project || !target || submitting) return;
    if (destinationPath.trim().length === 0) {
      setError("Choose a folder on the other machine.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const projectId = newProjectId();
    try {
      await addProjectToMachine({
        source: { environmentId: project.environmentId, cwd: project.workspaceRoot },
        subdirectory: projectSubdirectory(
          project.repositoryIdentity?.rootPath,
          project.workspaceRoot,
        ),
        target: { environmentId: target.environmentId, label: target.label },
        projectId,
        title: project.title,
        remoteUrl,
        destinationPath: destinationPath.trim(),
        files: files.filter((file) => selectedFiles.has(file.path)).map((file) => file.path),
        nestedRepositories: nestedRepositories.map((repository) => ({
          relativePath: repository.relativePath,
          remoteUrl: repository.remoteUrl,
          branch: repository.branch,
          branchPushed: repository.branchPushed,
          unpushedCommits: repository.unpushedCommits,
        })),
      });
      close();
      openClonedProject(scopeProjectRef(target.environmentId, projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the clone.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add to another machine</DialogTitle>
            <DialogDescription>
              Clone {project?.repositoryIdentity?.displayName ?? project?.title}
              {nestedRepositories.length > 0
                ? ` with its ${nestedRepositories.length} nested ${nestedRepositories.length === 1 ? "repository" : "repositories"}`
                : ""}{" "}
              and bring the local files git does not track.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-sm">
                  <EnvironmentMachineIcon
                    kind={resolveEnvironmentMachineKind(source?.serverConfig ?? null)}
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate">{source?.label ?? "This machine"}</span>
                </span>
                <span className="flex min-w-0 font-mono text-muted-foreground text-xs">
                  <MiddleTruncate value={project?.workspaceRoot ?? ""} />
                </span>
              </div>
              <div className="flex w-28 flex-col items-center gap-0.5 text-muted-foreground text-xs">
                <span>
                  {nestedRepositories.length > 0
                    ? `${nestedRepositories.length + 1} git clones`
                    : "git clone"}
                </span>
                <span className="flex w-full items-center">
                  <span className="h-px flex-1 bg-border" />
                  <ArrowRightIcon className="-ms-1 size-3.5" aria-hidden />
                </span>
                <span>
                  {selectedFiles.size === 0
                    ? "no files"
                    : `+ ${selectedFiles.size} ${selectedFiles.size === 1 ? "file" : "files"}`}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                {targets.length > 1 ? (
                  <Select
                    value={target?.environmentId ?? null}
                    onValueChange={(value) => {
                      if (value) setTargetId(value);
                    }}
                    items={targets.map((t) => ({ value: t.environmentId, label: t.label }))}
                  >
                    <SelectTrigger size="sm" aria-label="Machine to add the project to">
                      {target ? (
                        <EnvironmentMachineIcon kind={target.machine} className="size-3.5" />
                      ) : null}
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {targets.map((t) => (
                        <SelectItem key={t.environmentId} value={t.environmentId}>
                          <span className="inline-flex items-center gap-1.5">
                            <EnvironmentMachineIcon kind={t.machine} className="size-3" />
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-sm">
                    {target ? (
                      <EnvironmentMachineIcon kind={target.machine} className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="truncate">{target?.label ?? "No machine available"}</span>
                  </span>
                )}
                <span className="flex min-w-0 font-mono text-muted-foreground text-xs">
                  <MiddleTruncate value={destinationPath} />
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Clone over</Label>
              {sshUrl && httpsUrl ? (
                <ToggleGroup
                  aria-label="Clone protocol"
                  value={protocol ? [protocol] : []}
                  onValueChange={(next) => {
                    const value = next[0];
                    if (value === "ssh" || value === "https") setProtocol(value);
                  }}
                >
                  <Toggle value="ssh">SSH</Toggle>
                  <Toggle value="https">HTTPS</Toggle>
                </ToggleGroup>
              ) : null}
              <span className="truncate font-mono text-muted-foreground text-xs">{remoteUrl}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-path`}>Folder on {target?.label ?? "the other machine"}</Label>
              <Input
                id={`${id}-path`}
                value={destinationPath}
                onChange={(event) => setPathOverride(event.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {nestedRepositories.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label>Nested repositories</Label>
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {nestedRepositories.map((repository) => (
                    <NestedRepositoryRow key={repository.relativePath} repository={repository} />
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  Each is cloned at the same path and branch after the main repository. One that
                  cannot be cloned is reported and the rest carry on.
                </p>
              </div>
            ) : null}

            {canListFiles ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Label className="flex-1">Copy ignored files</Label>
                  {copyable.length > 0 ? (
                    <>
                      <span className="text-muted-foreground text-xs">
                        {selectedFiles.size} of {files.length}
                        {selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ""}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setSelected(
                            selectedFiles.size === copyable.length
                              ? new Set()
                              : new Set(copyable.map((file) => file.path)),
                          )
                        }
                      >
                        {selectedFiles.size === copyable.length ? "None" : "All"}
                      </Button>
                    </>
                  ) : null}
                </div>
                {ignoredFiles.error ? (
                  <p className="text-destructive-foreground text-xs">{ignoredFiles.error}</p>
                ) : files.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {ignoredFiles.isSuccess
                      ? "No ignored files to copy."
                      : "Finding ignored files…"}
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto rounded-md border">
                    {files.map((file) => (
                      <IgnoredFileRow
                        key={file.path}
                        file={file}
                        checked={selectedFiles.has(file.path)}
                        onCheckedChange={(checked) => toggleFile(file.path, checked)}
                      />
                    ))}
                  </div>
                )}
                {filesTruncated ? (
                  <p className="text-muted-foreground text-xs">
                    Showing the first {files.length} files.
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  Files are copied after the clone finishes. Folders git ignores whole, like
                  node_modules, are left out.
                </p>
              </div>
            ) : null}

            {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={unavailable || submitting}>
              {submitting ? "Starting…" : `Clone to ${target?.label ?? "machine"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * A project can be rooted below its repository's top folder. The clone lands
 * at the top, so copied files keep the same path below it.
 */
function projectSubdirectory(repositoryRoot: string | undefined, workspaceRoot: string) {
  if (!repositoryRoot) return "";
  const prefix = repositoryRoot.replace(/[\\/]+$/, "");
  const rest = workspaceRoot.slice(prefix.length);
  return workspaceRoot.startsWith(prefix) && /^[\\/]/.test(rest)
    ? rest.slice(1).replaceAll("\\", "/")
    : "";
}

function defaultSelection(files: readonly ProjectIgnoredFile[]): ReadonlySet<string> {
  return new Set(
    files
      .filter(
        (file) => file.byteLength <= COPYABLE_FILE_MAX_BYTES && isDefaultCopiedFile(file.path),
      )
      .map((file) => file.path),
  );
}

/** Fork: what a nested repository's clone will check out, or why it will not. */
function nestedRepositoryNote(repository: ProjectNestedRepository): {
  readonly text: string;
  readonly warning: boolean;
} {
  if (repository.remoteUrl === null) return { text: "No remote, skipped", warning: true };
  if (repository.branch === null) return { text: "Not on a branch, default branch", warning: true };
  if (!repository.branchPushed) {
    return { text: `${repository.branch} not pushed, default branch`, warning: true };
  }
  if (repository.unpushedCommits > 0) {
    const count = repository.unpushedCommits;
    return {
      text: `${repository.branch}, ${count} unpushed ${count === 1 ? "commit" : "commits"} stay behind`,
      warning: true,
    };
  }
  return { text: repository.branch, warning: false };
}

function NestedRepositoryRow({ repository }: { repository: ProjectNestedRepository }) {
  const note = nestedRepositoryNote(repository);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-sm not-last:border-b">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{repository.relativePath}</span>
      <span
        className={
          note.warning
            ? "min-w-0 shrink truncate text-warning-foreground text-xs"
            : "min-w-0 shrink truncate text-muted-foreground text-xs"
        }
      >
        {note.text}
      </span>
    </div>
  );
}

function IgnoredFileRow({
  file,
  checked,
  onCheckedChange,
}: {
  file: ProjectIgnoredFile;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const tooLarge = file.byteLength > COPYABLE_FILE_MAX_BYTES;
  return (
    <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm not-last:border-b has-disabled:cursor-not-allowed has-disabled:opacity-64">
      <Checkbox checked={checked} disabled={tooLarge} onCheckedChange={onCheckedChange} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {tooLarge ? "Over 5 MB" : formatBytes(file.byteLength)}
      </span>
    </label>
  );
}
