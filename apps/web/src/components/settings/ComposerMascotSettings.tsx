import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

import { MascotPreview } from "../chat/ComposerRunner";
import {
  NO_MASCOT_CHOICE,
  PROJECT_MASCOT_CHOICE,
  RUNNER_SPRITES,
  defaultMascotId,
} from "../chat/composerRunnerSprites";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const DEFAULT_CHOICE = "default";

function choiceLabel(driver: string, choice: string): string {
  if (choice === DEFAULT_CHOICE) {
    const own = defaultMascotId(driver);
    return `${own ? RUNNER_SPRITES.get(own)!.label : "Project's pick"} (default)`;
  }
  if (choice === PROJECT_MASCOT_CHOICE) return "Project's pick";
  if (choice === NO_MASCOT_CHOICE) return "Off";
  return RUNNER_SPRITES.get(choice)?.label ?? choice;
}

function choicePreview(driver: string, choice: string) {
  const id = choice === DEFAULT_CHOICE ? defaultMascotId(driver) : choice;
  const sprite = id ? RUNNER_SPRITES.get(id) : undefined;
  return sprite ? <MascotPreview sprite={sprite} /> : <span aria-hidden className="w-5 shrink-0" />;
}

/** One mascot picker per provider; choosing the default clears the provider's entry. */
export function ComposerMascotPickers(props: {
  readonly mascots: Readonly<Record<string, string>>;
  readonly onChange: (mascots: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {Object.entries(PROVIDER_DISPLAY_NAMES).map(([driver, name]) => {
        const stored = props.mascots[driver];
        const value =
          stored === undefined ||
          stored === defaultMascotId(driver) ||
          (stored !== PROJECT_MASCOT_CHOICE &&
            stored !== NO_MASCOT_CHOICE &&
            !RUNNER_SPRITES.has(stored))
            ? DEFAULT_CHOICE
            : stored;
        const own = defaultMascotId(driver);
        const choices = [
          DEFAULT_CHOICE,
          ...(own ? [PROJECT_MASCOT_CHOICE] : []),
          ...[...RUNNER_SPRITES.keys()].filter((id) => id !== own),
          NO_MASCOT_CHOICE,
        ];
        return (
          <div key={driver} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">{name}</span>
            <div className="w-60 shrink-0">
              <Select
                value={value}
                onValueChange={(next) => {
                  if (typeof next !== "string") return;
                  const { [driver]: _previous, ...rest } = props.mascots;
                  props.onChange(next === DEFAULT_CHOICE ? rest : { ...rest, [driver]: next });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label={`${name} mascot`}>
                  {choicePreview(driver, value)}
                  <SelectValue>{choiceLabel(driver, value)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {choices.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      <span className="flex items-center gap-2">
                        {choicePreview(driver, choice)}
                        {choiceLabel(driver, choice)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
