// Fork: tag a text selection into the composer with an optional note, from the terminal and
// from rendered files.
import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

function clampToViewport(element: HTMLElement, position: SelectionActionPoint) {
  const rect = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select, button") !== null)
  );
}

/** A floating card that asks for an optional note before the selection goes to the composer. */
export function SelectionNoteCard(props: {
  position: SelectionActionPoint;
  label: string;
  onSubmit: (note: string) => void;
  onCancel: () => void;
  cardRef?: (element: HTMLDivElement | null) => void;
}) {
  const { position, onCancel } = props;
  const [note, setNote] = useState("");
  const localRef = useRef<HTMLDivElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the card DOM node and clamps it inside the window before paint
  useLayoutEffect(() => {
    if (localRef.current) clampToViewport(localRef.current, position);
  }, [position]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a press outside the floating card dismisses it
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (localRef.current?.contains(event.target as Node)) return;
      onCancel();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onCancel]);

  const attach = (element: HTMLDivElement | null) => {
    localRef.current = element;
    props.cardRef?.(element);
  };

  return createPortal(
    <div
      ref={attach}
      role="dialog"
      aria-label="Add selection to chat"
      className="dropdown-glass fixed z-50 flex w-80 max-w-full flex-col gap-2 rounded-lg p-2 shadow-lg"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="truncate px-1 text-muted-foreground text-xs">{props.label}</div>
      <Textarea
        size="sm"
        rows={2}
        autoFocus
        value={note}
        placeholder="Add a note (optional)"
        aria-label="Note for the agent"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          props.onSubmit(note);
        }}
      />
      <div className="flex items-center justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" onClick={() => props.onSubmit(note)}>
          Add to chat
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Watches text selections inside `element`. A selection shows an "Add to chat" button, which
 * opens the note card; `onAdd` receives the selected text and the note.
 */
export function TextSelectionNoteToolbar(props: {
  element: HTMLElement | null;
  label: (text: string) => string;
  onAdd: (text: string, note: string) => void;
}) {
  const { element } = props;
  const [selection, setSelection] = useState<{
    text: string;
    position: SelectionActionPoint;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const actionRef = useRef<HTMLElement | null>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the button DOM node and clamps it inside the window before paint
  useLayoutEffect(() => {
    if (actionRef.current && selection && !expanded) {
      clampToViewport(actionRef.current, selection.position);
    }
  }, [expanded, selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selection changes inside the element
  useEffect(() => {
    if (!element) return;
    const clear = () => {
      setSelection(null);
      setExpanded(false);
    };
    const update = (pointer: SelectionActionPoint | null) => {
      const native = window.getSelection();
      if (!native || native.isCollapsed || native.rangeCount === 0) return clear();
      const range = native.getRangeAt(0);
      if (!element.contains(range.commonAncestorContainer)) return clear();
      const text = native.toString().trim();
      if (!text) return clear();
      const rects = range.getClientRects();
      setExpanded(false);
      setSelection({
        text,
        position: resolveSelectionActionPosition({
          bounds: element.getBoundingClientRect(),
          selectionRect: rects.item(rects.length - 1) ?? range.getBoundingClientRect(),
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element,
      getActionElement: () => actionRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [element]);

  const hasSelectionAction = selection !== null && !expanded;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Enter on a live selection opens the note card, like clicking "Add to chat"
  useEffect(() => {
    if (!hasSelectionAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setExpanded(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [hasSelectionAction]);

  if (!selection) return null;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
    setExpanded(false);
  };
  if (expanded) {
    return (
      <SelectionNoteCard
        cardRef={(node) => {
          actionRef.current = node;
        }}
        position={selection.position}
        label={props.label(selection.text)}
        onCancel={dismiss}
        onSubmit={(note) => {
          props.onAdd(selection.text, note);
          window.getSelection()?.removeAllRanges();
          dismiss();
        }}
      />
    );
  }
  return createPortal(
    <Button
      ref={(node: HTMLButtonElement | null) => {
        actionRef.current = node;
      }}
      type="button"
      size="xs"
      variant="glass"
      aria-label="Add selection to chat"
      className="fixed z-50"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => setExpanded(true)}
    >
      <MessageSquarePlusIcon aria-hidden="true" className="size-3.5" />
      Add to chat
    </Button>,
    document.body,
  );
}
