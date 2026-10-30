import { XIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./chat/threadDetailsPanelStyles";

// Fork: Cancel for a running PR action, at the end of the git row's progress split.
export function GitActionCancelButton({
  cancelling,
  onCancel,
}: {
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              aria-label={cancelling ? "Cancelling" : "Cancel"}
              part="secondary"
              panel
              size="sm"
              variant="ghost"
              disabled={cancelling}
              onClick={onCancel}
            />
          }
        >
          <XIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{cancelling ? "Cancelling..." : "Cancel"}</TooltipPopup>
      </Tooltip>
    </>
  );
}
