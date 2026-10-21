import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { MascotPreview } from "../chat/ComposerRunner";
import {
  NO_MASCOT_CHOICE,
  PROJECT_MASCOT_CHOICE,
  RUNNER_SPRITES,
  defaultMascotId,
} from "../chat/composerRunnerSprites";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

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

function setComposerMascot(instanceId: string, choice: string | null) {
  const { [instanceId]: _previous, ...rest } = getClientSettings().composerMascots;
  void updateClientSettings({
    composerMascots: choice === null ? rest : { ...rest, [instanceId]: choice },
  });
}

/** The composer mascot of one provider setup, saved on this device. */
export function ComposerMascotRow(props: { readonly instanceId: string; readonly driver: string }) {
  const { instanceId, driver } = props;
  const stored = useClientSettings((settings) => settings.composerMascots[instanceId]);
  const own = defaultMascotId(driver);
  const value =
    stored === undefined ||
    stored === own ||
    (stored !== PROJECT_MASCOT_CHOICE && stored !== NO_MASCOT_CHOICE && !RUNNER_SPRITES.has(stored))
      ? DEFAULT_CHOICE
      : stored;
  const choices = [
    DEFAULT_CHOICE,
    ...(own ? [PROJECT_MASCOT_CHOICE] : []),
    ...[...RUNNER_SPRITES.keys()].filter((id) => id !== own),
    NO_MASCOT_CHOICE,
  ];
  return (
    <SettingsRow
      title="Composer mascot"
      description="Walks the composer while this provider works. Saved on this device."
      resetAction={
        value === DEFAULT_CHOICE ? null : (
          <SettingResetButton
            label="composer mascot"
            onClick={() => setComposerMascot(instanceId, null)}
          />
        )
      }
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            setComposerMascot(instanceId, next === DEFAULT_CHOICE ? null : next);
          }}
        >
          <SelectTrigger size="sm" className="w-60 min-w-0" aria-label="Composer mascot">
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
      }
    />
  );
}
