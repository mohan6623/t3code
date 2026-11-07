import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";

export interface FileCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  startLine: number;
  endLine: number;
  text: string;
}

export interface FileCommentAnnotationGroup {
  entries: FileCommentAnnotationEntry[];
}

export type FileCommentLineAnnotation = LineAnnotation<FileCommentAnnotationGroup>;

let fileCommentSequence = 0;

export function nextFileCommentId(): string {
  fileCommentSequence += 1;
  return `file-comment-${Date.now()}-${fileCommentSequence}`;
}

export function normalizeFileCommentRange(range: SelectedLineRange): {
  startLine: number;
  endLine: number;
} {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

export function formatFileCommentRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`;
}

export function remapFileCommentAnnotations(
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
): FileCommentLineAnnotation[] {
  return annotations.map((annotation) => ({
    ...annotation,
    metadata: {
      entries: annotation.metadata.entries.map((entry) => {
        const lineCount = entry.endLine - entry.startLine;
        return {
          ...entry,
          endLine: annotation.lineNumber,
          startLine: Math.max(1, annotation.lineNumber - lineCount),
        };
      }),
    },
  }));
}

const normalizeSelectionWords = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

/**
 * Fork: rendered markdown hides its syntax and rewraps lines, so a selection is matched to
 * source lines by the words at its start and end. Null when the words are not found.
 */
export function findSelectionSourceLines(
  contents: string,
  selected: string,
): { startLine: number; endLine: number } | null {
  const sourceLines = contents.split("\n").map(normalizeSelectionWords);
  const selectedLines = selected.split("\n").map(normalizeSelectionWords).filter(Boolean);
  const first = selectedLines[0]?.split(" ");
  const last = selectedLines.at(-1)?.split(" ");
  if (!first || !last) return null;
  const find = (needles: string[], from: number) => {
    for (const needle of needles) {
      const index = sourceLines.findIndex((line, i) => i >= from && line.includes(needle));
      if (index >= 0) return index;
    }
    return -1;
  };
  const start = find(
    [first.join(" "), first.slice(0, 6).join(" "), first.slice(0, 3).join(" ")],
    0,
  );
  if (start < 0) return null;
  const end = find(
    [last.join(" "), last.slice(-6).join(" "), last.slice(-3).join(" "), last.at(-1) ?? ""],
    start,
  );
  return { startLine: start + 1, endLine: (end < 0 ? start : end) + 1 };
}
