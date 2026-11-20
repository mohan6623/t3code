import type { ContextMenuItem, ProviderAuthResponse } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useEffect, useRef, useState } from "react";
import { GhosttyTerminalSurface } from "../../terminal/ghostty/surface";
import { ensureLocalApi } from "../../localApi";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  type ClipboardTarget,
  readTextFromClipboard,
  writeTextToClipboard,
} from "../../hooks/useCopyToClipboard";
import { terminalThemeFromApp } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { findTerminalSignInUrl } from "./ProviderAuthenticationSection.logic";

/** Fork: the terminal shows its own error, so both clipboard failures read the same. */
function clipboardTarget(target: string, message: string): ClipboardTarget {
  return { target, unavailableMessage: message, failureMessage: message };
}

type SignInMenuAction = "copy" | "paste" | "select-all" | "copy-link" | "open-link";

export default function ProviderAuthTerminal({
  output,
  outputOffset,
  onResponse,
}: {
  readonly output: string;
  readonly outputOffset?: number | undefined;
  readonly onResponse: (response: Extract<ProviderAuthResponse, { type: "terminal" }>) => void;
}) {
  const gt = useGT();
  const [surface, setSurface] = useState<GhosttyTerminalSurface | null>(null);
  const written = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // The surface captures its callbacks once at creation.
  const respond = useStableCallback(onResponse);
  const offset = outputOffset ?? output.length;
  // Fork: the sign-in link, for the menu and buttons when clicking it in the terminal fails.
  const signInUrl = findTerminalSignInUrl(output);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes new auth output into the imperative Ghostty terminal surface
  useEffect(() => {
    if (!surface) return;
    const delta = offset - written.current;
    if (delta > 0 && delta <= output.length) surface.write(output.slice(-delta));
    else if (delta !== 0) surface.resetAndWrite(output);
    written.current = offset;
  }, [surface, output, offset]);

  const openLink = () => {
    if (!signInUrl) return;
    void ensureLocalApi()
      .shell.openExternal(signInUrl)
      .catch(() =>
        setError(gt("Could not open the sign-in link. Copy it and open it in your browser.")),
      );
  };
  const copyLink = () => {
    if (!signInUrl) return;
    void writeTextToClipboard(
      signInUrl,
      clipboardTarget("provider sign-in link", gt("Could not copy the sign-in link.")),
    ).catch(() => setError(gt("Could not copy the sign-in link.")));
  };
  // Pastes like the keyboard does, so programs that ask for bracketed paste get it.
  const paste = () => {
    const read = () =>
      readTextFromClipboard(
        clipboardTarget("sign-in terminal", gt("Could not paste into the terminal.")),
      );
    const pasted = surface
      ? surface.pasteFromClipboard(read)
      : read().then((data) => {
          if (data) respond({ type: "terminal", data });
        });
    void pasted.catch(() =>
      setError(gt("Could not read the clipboard. Paste the code into the field below.")),
    );
  };
  const sendCode = async () => {
    const value = code.trim();
    if (!value) return;
    setCode("");
    if (surface) await surface.pasteFromClipboard(() => Promise.resolve(value));
    else respond({ type: "terminal", data: value });
    // Enter goes separately: some prompts take a pasted line ending in Enter as text.
    respond({ type: "terminal", data: "\r" });
  };

  const showContextMenu = useStableCallback(async (position: { x: number; y: number }) => {
    const terminal = surface;
    if (!terminal) return;
    const selection = terminal.getSelection();
    const items: ContextMenuItem<SignInMenuAction>[] = [
      ...(selection ? [{ id: "copy" as const, label: gt("Copy") }] : []),
      { id: "paste", label: gt("Paste") },
      { id: "select-all", label: gt("Select all") },
      ...(signInUrl
        ? [
            { id: "copy-link" as const, label: gt("Copy link"), separatorBefore: true },
            { id: "open-link" as const, label: gt("Open link") },
          ]
        : []),
    ];
    let clicked: SignInMenuAction | null;
    try {
      clicked = await ensureLocalApi().contextMenu.show(items, position);
    } catch {
      setError(gt("Could not open the terminal menu."));
      return;
    }
    switch (clicked) {
      case "copy":
        terminal.clearSelection();
        void writeTextToClipboard(
          selection,
          clipboardTarget("sign-in terminal selection", gt("Could not copy the selection.")),
        ).catch(() => setError(gt("Could not copy the selection.")));
        return;
      case "paste":
        paste();
        return;
      case "select-all":
        terminal.selectAll();
        terminal.focus();
        return;
      case "copy-link":
        copyLink();
        return;
      case "open-link":
        openLink();
        return;
    }
  });

  const mountSurface = (element: HTMLDivElement) => {
    let disposed = false;
    let created: GhosttyTerminalSurface | null = null;
    void GhosttyTerminalSurface.create(element, {
      theme: terminalThemeFromApp(element),
      font: { size: 13 },
      onData: (data) => respond({ type: "terminal", data }),
      onBinary: (data) => respond({ type: "terminal", data, binary: true }),
      onReply: (data) => respond({ type: "terminal", data }),
      onResize: (cols, rows) => respond({ type: "terminal", data: "", size: { cols, rows } }),
      onSelectionChange: () => {},
      beforeKey: (event) => event.key !== "Tab",
      // Fork: right-click opens a menu with copy, paste, and the sign-in link.
      onContextMenu: (event) => {
        event.preventDefault();
        void showContextMenu({ x: event.clientX, y: event.clientY });
      },
      onLinkActivate: (url) => {
        if (/^https?:\/\//i.test(url))
          void ensureLocalApi()
            .shell.openExternal(url)
            .catch(() => setError(gt("Could not open the provider link.")));
      },
    })
      .then((terminal) => {
        if (disposed) {
          terminal.dispose();
          return;
        }
        created = terminal;
        written.current = 0;
        setSurface(terminal);
      })
      .catch(() => setError(gt("Could not load the sign-in terminal. Cancel and retry sign-in.")));
    return () => {
      disposed = true;
      created?.dispose();
      setSurface(null);
    };
  };
  return (
    <>
      <div
        ref={mountSurface}
        aria-label={gt("Provider sign-in terminal")}
        className="relative h-64 overflow-hidden rounded-md border border-border"
      />
      {/* Fork: buttons for when the terminal's own link, copy, and paste do not work. */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2">
        <Button size="sm" variant="outline" disabled={!signInUrl} onClick={openLink}>
          <T>Open link</T>
        </Button>
        <Button size="sm" variant="outline" disabled={!signInUrl} onClick={copyLink}>
          <T>Copy link</T>
        </Button>
        <Button size="sm" variant="outline" onClick={paste}>
          <T>Paste</T>
        </Button>
      </div>
      <form
        className="flex items-center gap-1.5 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode().catch(() => setError(gt("Could not send the code to the terminal.")));
        }}
      >
        <Input
          size="sm"
          aria-label={gt("Sign-in code")}
          placeholder={gt("Paste the code here")}
          autoComplete="off"
          spellCheck={false}
          maxLength={4_096}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!code.trim()}>
          <T context="send the sign-in code">Send</T>
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
