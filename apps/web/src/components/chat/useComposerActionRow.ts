import { useLayoutEffect, useRef, useState } from "react";

export interface ComposerActionRowLayout {
  /**
   * Whether the prompt needs the full row width, with the actions on their own
   * row below it. A prompt that fits on one line beside the actions keeps the
   * inline layout.
   */
  readonly needsActionRow: boolean;
  /** The width the inline actions take beside the prompt; null until measured. */
  readonly actionsReserve: number | null;
  /** How far left the attach button moves to reach the start of the action row. */
  readonly attachShift: number;
}

const UNMEASURED_LAYOUT: ComposerActionRowLayout = {
  needsActionRow: false,
  actionsReserve: null,
  attachShift: 0,
};

/** The space between the prompt and the inline actions. */
const ACTIONS_GAP_PX = 8;
/** The attach icon sits this far inside its button; the shift lines it up with the prompt. */
const ATTACH_ICON_INSET_PX = 6;
/**
 * A one-line prompt on the action row returns to the inline layout only when
 * it is this much shorter than the inline width. The inline layout switches
 * back when the prompt wraps, so without the margin a prompt at the boundary
 * makes the two layouts alternate.
 */
const INLINE_RETURN_MARGIN_PX = 12;

export function measureComposerActionRow(
  row: HTMLElement,
  usesActionRow: boolean,
): ComposerActionRowLayout | null {
  const editor = row.querySelector<HTMLElement>('[data-testid="composer-editor"]');
  const surface = row.closest<HTMLElement>('[data-chat-composer-surface="true"]');
  const actions = surface?.querySelector<HTMLElement>('[data-chat-composer-actions="right"]');
  if (!editor || editor.clientWidth === 0 || !actions) return null;

  // Layout sizes, not client rects: the resting transition moves the actions
  // with a transform, and that must not change the reserved width.
  const footer = actions.parentElement;
  const body = row.parentElement;
  const footerPaddingRight = footer ? Number.parseFloat(getComputedStyle(footer).paddingRight) : 0;
  const footerRight = footer ? Number.parseFloat(getComputedStyle(footer).right) || 0 : 0;
  const bodyPaddingRight = body ? Number.parseFloat(getComputedStyle(body).paddingRight) : 0;
  const actionsFromRowEnd = Math.max(
    0,
    actions.offsetWidth + footerPaddingRight + footerRight - bodyPaddingRight,
  );
  const actionsReserve = Math.ceil(actionsFromRowEnd + ACTIONS_GAP_PX);

  const rowPaddingLeft = Number.parseFloat(getComputedStyle(row).paddingLeft);
  const attach = actions.querySelector<HTMLElement>("[data-chat-composer-attach]");
  const attachShift = attach
    ? Math.max(
        0,
        Math.round(
          row.clientWidth -
            rowPaddingLeft -
            actionsFromRowEnd +
            (attach.offsetLeft - actions.offsetLeft) +
            ATTACH_ICON_INSET_PX,
        ),
      )
    : 0;

  const layout = (needsActionRow: boolean): ComposerActionRowLayout => ({
    needsActionRow,
    actionsReserve,
    attachShift,
  });

  // A second paragraph is a second line, even when it is still empty.
  if (editor.querySelectorAll("p").length > 1) return layout(true);

  const editorStyle = getComputedStyle(editor);
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
  if (bottom < top) return layout(false);

  // A prompt that wraps is too long for the inline layout: the inline width
  // is the narrower of the two.
  if (bottom - top > lineHeight * 1.5) return layout(true);
  // One line beside the actions: it fits.
  if (!usesActionRow) return layout(false);

  // One line on the action row. The editor has the full row width here; the
  // inline layout takes the actions and the reserved image previews from it.
  const previews = row.querySelector<HTMLElement>("[data-chat-composer-preview-reserve]");
  const previewsWidth = previews
    ? previews.offsetWidth + (Number.parseFloat(getComputedStyle(row).columnGap) || 0)
    : 0;
  const inlineWidth =
    editor.clientWidth -
    Number.parseFloat(editorStyle.paddingLeft) -
    Number.parseFloat(editorStyle.paddingRight) -
    actionsReserve -
    previewsWidth;
  return layout(right - contentLeft > inlineWidth - INLINE_RETURN_MARGIN_PX);
}

/**
 * Measures the prompt row against the actions that sit on it. `row` is null
 * while the actions are not laid over the prompt row. `enabled` is false while
 * the prompt must stay on one line, as in the resting composer.
 */
export function useComposerActionRow(
  row: HTMLElement | null,
  enabled: boolean,
): ComposerActionRowLayout {
  const [layout, setLayout] = useState(UNMEASURED_LAYOUT);
  const currentRef = useRef(UNMEASURED_LAYOUT);

  useLayoutEffect(() => {
    if (!row) return;
    const measure = () => {
      const current = currentRef.current;
      const next = measureComposerActionRow(row, enabled && current.needsActionRow);
      if (next === null) return;
      const resolved = enabled ? next : { ...next, needsActionRow: false };
      if (
        resolved.needsActionRow === current.needsActionRow &&
        resolved.actionsReserve === current.actionsReserve &&
        resolved.attachShift === current.attachShift
      ) {
        return;
      }
      currentRef.current = resolved;
      setLayout(resolved);
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(row);
    const editor = row.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    if (editor) resizeObserver.observe(editor);
    const actions = row
      .closest('[data-chat-composer-surface="true"]')
      ?.querySelector<HTMLElement>('[data-chat-composer-actions="right"]');
    if (actions) resizeObserver.observe(actions);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(row, { childList: true, characterData: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [enabled, row]);

  if (!row) return UNMEASURED_LAYOUT;
  return enabled ? layout : { ...layout, needsActionRow: false };
}
