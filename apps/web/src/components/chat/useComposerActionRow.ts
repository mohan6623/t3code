import { useLayoutEffect, useState } from "react";

/**
 * Whether the prompt needs the full row width, with the actions on their own
 * row below it. A prompt that fits on one line beside the actions keeps the
 * inline layout. The test uses the inline width in both layouts, so switching
 * layout cannot make the answer flip back and forth.
 */
export function measureComposerActionRow(row: HTMLElement, actionsWidth: number): boolean | null {
  const editor = row.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.clientWidth === 0) return null;

  // A second paragraph is a second line, even when it is still empty.
  if (editor.querySelectorAll("p").length > 1) return true;

  const editorStyle = getComputedStyle(editor);
  const inlineWidth =
    row.clientWidth -
    Number.parseFloat(getComputedStyle(row).paddingLeft) -
    actionsWidth -
    Number.parseFloat(editorStyle.paddingLeft) -
    Number.parseFloat(editorStyle.paddingRight);
  const lineHeight = Number.parseFloat(editorStyle.lineHeight);
  const contentLeft =
    editor.getBoundingClientRect().left + Number.parseFloat(editorStyle.paddingLeft);

  // Measure only the text and inline chips. A range over the whole editor
  // also covers the full-width paragraph boxes.
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let right = contentLeft;
  const range = document.createRange();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.nodeType === Node.TEXT_NODE
        ? NodeFilter.FILTER_ACCEPT
        : (node as Element).getAttribute("contenteditable") === "false"
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNode(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
      right = Math.max(right, rect.right);
    }
  }
  if (bottom < top) return false;

  return bottom - top > lineHeight * 1.5 || right - contentLeft > inlineWidth + 1;
}

export function useComposerActionRow(
  row: HTMLElement | null,
  actionsWidth: number,
  enabled: boolean,
): boolean {
  const [needsActionRow, setNeedsActionRow] = useState(false);

  useLayoutEffect(() => {
    if (!row || !enabled) return;
    const measure = () => {
      const next = measureComposerActionRow(row, actionsWidth);
      if (next !== null) setNeedsActionRow(next);
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(row);
    const editor = row.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    if (editor) resizeObserver.observe(editor);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(row, { childList: true, characterData: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [actionsWidth, enabled, row]);

  return enabled && needsActionRow;
}
