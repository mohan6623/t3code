import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";
import { observeResize } from "~/lib/observeResize";
import {
  resolveRestingComposerControlsLayout,
  resolveRestingComposerControlsMinimumWidth,
  type RestingComposerControlsLayout,
} from "../composerFooterLayout";
import { useLayoutEffect, useRef, useState } from "react";

function reserveHostMinWidth(host: HTMLElement, width: number) {
  const minWidth = `${String(width)}px`;
  if (host.style.minWidth !== minWidth) host.style.minWidth = minWidth;
}

export function useRestingComposerControlsLayout(
  host: HTMLDivElement | null,
  useControlsAsHost = false,
) {
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const attachControls = (element: HTMLDivElement | null) => {
    controlsRef.current = element;
    setControls(element);
  };
  const [layout, setLayout] = useState<RestingComposerControlsLayout>({ hiddenCount: 0 });

  const measure = () => {
    const currentHost = useControlsAsHost ? controls : host;
    if (currentHost === null || !controls) return;

    const measurement = measureRestingComposerControls(controls);
    if (!measurement) return;
    const style = getComputedStyle(currentHost);
    const padding =
      (Number.parseFloat(style.paddingInlineStart) || 0) +
      (Number.parseFloat(style.paddingInlineEnd) || 0);
    const hostWidth = currentHost.clientWidth - padding;
    // Fork: the strip keeps room for the model logo, a truncated name and the "…" menu, so
    // the controls never vanish. The usage badge beside them clips first.
    if (!useControlsAsHost) {
      reserveHostMinWidth(
        currentHost,
        Math.ceil(resolveRestingComposerControlsMinimumWidth(measurement) + padding),
      );
    }

    setLayout((current) => {
      const next = resolveRestingComposerControlsLayout({
        ...measurement,
        hostWidth,
        previous: current,
      });
      return next.hiddenCount === current.hiddenCount &&
        next.iconOnlyCount === current.iconOnlyCount
        ? current
        : next;
    });
  };

  useLayoutEffect(() => {
    const currentHost = useControlsAsHost ? controls : host;
    if (!currentHost || !controls) return;
    let stopObserving = () => {};
    const observeControls = () => {
      stopObserving();
      stopObserving = observeResize(
        [
          currentHost,
          controls,
          ...controls.querySelectorAll<HTMLElement>(
            "[data-resting-block], [data-composer-control-label], [data-chat-provider-model-picker-label]",
          ),
        ],
        measure,
      );
      measure();
    };
    observeControls();
    const mutations = new MutationObserver(observeControls);
    mutations.observe(controls, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopObserving();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [host, controls, useControlsAsHost, measure]);

  return {
    controlsRef,
    attachControls,
    hiddenBlockCount: layout.hiddenCount,
    iconOnlyBlockCount: layout.iconOnlyCount ?? 0,
  };
}
