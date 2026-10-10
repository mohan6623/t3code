import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { flushSync } from "react-dom";
import { ChatCanvasContext } from "./ChatCanvasContext";
import { resolveChatCanvasLayout, type ChatCanvasPreview } from "./chatCanvasLayout";
import type { PreviewMiniPlayerObstacles } from "../preview/previewMiniPlayerLayout";

/** The elements whose rules in index.css read the chat lane variables. */
const CHAT_LANE_SELECTOR = ".chat-composer-lane, .messages-timeline-scroll, .chat-scroll-to-bottom";

/**
 * Owns the available conversation space. Cards only report where they sit; the
 * canvas decides when chat moves over to make room for them.
 */
export function ChatCanvas({
  composerOverlayElement,
  detailsCardTopInset = 0,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style" | "ref"> & {
  composerOverlayElement: HTMLElement | null;
  detailsCardTopInset?: number;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const widthProbeRef = useRef<HTMLDivElement | null>(null);
  const [timelineElement, registerTimeline] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<ChatCanvasPreview | null>(null);
  const [detailsCard, setDetailsCard] = useState<PreviewMiniPlayerObstacles["detailsCard"]>(null);
  const reportDetailsCard = useCallback((next: PreviewMiniPlayerObstacles["detailsCard"]) => {
    setDetailsCard((current) =>
      current?.left === next?.left &&
      current?.right === next?.right &&
      current?.bottom === next?.bottom
        ? current
        : next,
    );
  }, []);
  const [measurements, setMeasurements] = useState({
    width: 0,
    height: 0,
    padding: 48,
    maxChatWidth: 768,
    minChatWidth: 640,
    composerHeight: 0,
    timelineGutter: 0,
  });
  const reportPreview = useCallback((next: ChatCanvasPreview) => {
    setPreview((current) =>
      current?.key === next.key &&
      current.width === next.width &&
      current.lastInteraction === next.lastInteraction &&
      current.position?.x === next.position?.x &&
      current.position?.y === next.position?.y &&
      current.source.width === next.source.width &&
      current.source.height === next.source.height
        ? current
        : next,
    );
  }, []);
  const clearPreview = useCallback(
    (key: string) => setPreview((current) => (current?.key === key ? null : current)),
    [],
  );
  useLayoutEffect(() => {
    const element = elementRef.current;
    const probe = widthProbeRef.current;
    if (!element || !probe) return;
    const measure = () => {
      const styles = getComputedStyle(probe);
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        padding: Number.parseFloat(styles.paddingLeft),
        maxChatWidth: Number.parseFloat(styles.width),
        minChatWidth: Number.parseFloat(styles.minWidth),
        composerHeight: composerOverlayElement?.getBoundingClientRect().height ?? 0,
        timelineGutter: timelineElement
          ? (timelineElement.offsetWidth - timelineElement.clientWidth) / 2
          : 0,
      };
      setMeasurements((current) =>
        Object.keys(next).every(
          (key) => current[key as keyof typeof current] === next[key as keyof typeof next],
        )
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(element);
    observer.observe(probe);
    if (composerOverlayElement) observer.observe(composerOverlayElement);
    if (timelineElement) observer.observe(timelineElement);
    return () => observer.disconnect();
  }, [composerOverlayElement, timelineElement]);
  const context = useMemo(() => {
    const container = { width: measurements.width, height: measurements.height };
    return {
      container,
      lane: { padding: measurements.padding, minChatWidth: measurements.minChatWidth },
      layout: resolveChatCanvasLayout({ ...measurements, container, preview, detailsCard }),
      previewKey: preview?.key ?? null,
      reportPreview,
      clearPreview,
      registerTimeline,
      reportDetailsCard,
      detailsCardTopInset,
    };
  }, [
    measurements,
    preview,
    detailsCard,
    reportPreview,
    clearPreview,
    reportDetailsCard,
    detailsCardTopInset,
  ]);
  const { layout } = context;
  // The lane variables are registered as non-inherited (index.css) and written
  // on the elements that read them. On the canvas root, each change restyled
  // every element in the conversation, once per frame of a panel resize.
  // No dependency list: the lane elements mount and unmount with our children.
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const lane = {
      "--chat-timeline-gutter": `${measurements.timelineGutter}px`,
      "--chat-lane-inset-start": `${layout.chat.insetStart}px`,
      "--chat-lane-inset-end": `${layout.chat.insetEnd}px`,
    };
    for (const target of element.querySelectorAll<HTMLElement>(CHAT_LANE_SELECTOR)) {
      for (const [name, value] of Object.entries(lane)) {
        if (target.style.getPropertyValue(name) !== value) target.style.setProperty(name, value);
      }
    }
  });
  return (
    <ChatCanvasContext value={context}>
      <div
        {...props}
        ref={elementRef}
        data-chat-canvas
        data-preview-overlaps-chat={layout.overlapsChat || undefined}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div
          ref={widthProbeRef}
          aria-hidden
          className="pointer-events-none invisible absolute h-0 w-(--chat-content-max-width) min-w-[40rem] box-content ps-3 sm:ps-12"
        />
        {children}
      </div>
    </ChatCanvasContext>
  );
}
