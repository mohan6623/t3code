import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { createContext } from "react";

/**
 * Fork: the live context window, read only by the composer's meter. Token usage updates arrive on
 * each model request; as a ChatComposer prop they re-rendered the whole composer.
 */
export const ComposerContextWindowContext = createContext<ContextWindowSnapshot | null>(null);
