// Fork: per-viewer Android stream quality, so a slow or relayed link can trade sharpness for a steady picture.
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { EnvironmentId } from "@t3tools/contracts";
import { withDeviceHubQuery } from "@t3tools/client-runtime/state/deviceHubAccess";
import * as Schema from "effect/Schema";
import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "~/components/ui/menu";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { renewDeviceHubAccess } from "~/state/device";

const QUALITY_KEY = "t3code:device-stream-quality";

const PRESETS = {
  high: {
    label: "High",
    detail: "1280 px · 60 fps",
    maxDimension: 1280,
    h264Bitrate: 8_000_000,
    h264Fps: 60,
  },
  balanced: {
    label: "Balanced",
    detail: "960 px · 30 fps",
    maxDimension: 960,
    h264Bitrate: 2_500_000,
    h264Fps: 30,
  },
  low: {
    label: "Low",
    detail: "720 px · 20 fps",
    maxDimension: 720,
    h264Bitrate: 1_000_000,
    h264Fps: 20,
  },
} as const;

type StreamQuality = keyof typeof PRESETS;
const StreamQualitySchema = Schema.NullOr(Schema.Literals(["high", "balanced", "low"]));
const isStreamQuality = (value: unknown): value is StreamQuality =>
  value === "high" || value === "balanced" || value === "low";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// GET reads what the hub streams now; PATCH applies a preset and answers with the result.
const streamSettingsRequest = async (
  access: DeviceHubAccess,
  deviceId: string,
  quality: StreamQuality | null,
): Promise<{ status: number; active: StreamQuality | "custom" | null }> => {
  const response = await fetch(
    withDeviceHubQuery(
      `${access.httpBase}/vendor/serve-emu/api/stream-settings?${new URLSearchParams({ device: deviceId })}`,
      access,
    ),
    {
      method: quality ? "PATCH" : "GET",
      cache: "no-store",
      credentials: access.credentials ? "include" : "same-origin",
      ...(quality
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              maxDimension: PRESETS[quality].maxDimension,
              h264Bitrate: PRESETS[quality].h264Bitrate,
              h264Fps: PRESETS[quality].h264Fps,
            }),
          }
        : {}),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body)) return { status: response.status, active: null };
  const match = (Object.keys(PRESETS) as StreamQuality[]).find(
    (key) =>
      PRESETS[key].maxDimension === body.maxDimension &&
      PRESETS[key].h264Bitrate === body.h264Bitrate &&
      PRESETS[key].h264Fps === body.h264Fps,
  );
  return { status: response.status, active: match ?? "custom" };
};

const syncStreamSettings = async (
  environmentId: EnvironmentId,
  hostId: string,
  access: DeviceHubAccess,
  deviceId: string,
  quality: StreamQuality | null,
) => {
  const failed = { status: 0, active: null };
  let result = await streamSettingsRequest(access, deviceId, quality).catch(() => failed);
  if (result.status === 401) {
    const renewed = await renewDeviceHubAccess(environmentId, hostId);
    if (renewed)
      result = await streamSettingsRequest(renewed, deviceId, quality).catch(() => failed);
  }
  const error = result.active
    ? null
    : result.status === 409
      ? "Stop the screen recording to change quality."
      : "Could not reach the stream settings.";
  return { active: result.active, error };
};

export function DeviceStreamQualityMenu(props: {
  environmentId: EnvironmentId;
  hostId: string;
  access: DeviceHubAccess;
  deviceId: string;
  streaming: boolean;
  popupSide: "left" | "bottom";
}) {
  // null means never chosen here: leave the hub as it is and only read it.
  const [quality, setQuality] = useLocalStorage<StreamQuality | null, StreamQuality | null>(
    QUALITY_KEY,
    null,
    StreamQualitySchema,
  );
  const [active, setActive] = useState<StreamQuality | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { environmentId, hostId, access, deviceId, streaming } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the hub forgets the setting when its stream restarts, so reapply on each (re)connect; an unchanged value is a no-op there.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    void syncStreamSettings(environmentId, hostId, access, deviceId, quality).then((result) => {
      if (cancelled) return;
      setActive(result.active);
      setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, hostId, access, deviceId, streaming, quality]);

  const selected = active && active !== "custom" ? active : "";
  const selectedLabel = selected ? PRESETS[selected].label : active === "custom" ? "Custom" : "…";
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Stream quality: ${selectedLabel}`}
            disabled={!streaming}
          />
        }
      >
        <Gauge />
      </MenuTrigger>
      <MenuPopup side={props.popupSide} className="min-w-48">
        <MenuRadioGroup
          value={selected}
          onValueChange={(value) => {
            if (!isStreamQuality(value)) return;
            setQuality(value);
            // A new value reapplies through the effect; the same one would not fire it.
            if (value === quality)
              void syncStreamSettings(environmentId, hostId, access, deviceId, value).then(
                (result) => {
                  setActive(result.active);
                  setError(result.error);
                },
              );
          }}
        >
          {(Object.keys(PRESETS) as StreamQuality[]).map((key) => (
            <MenuRadioItem key={key} value={key}>
              <span className="flex items-center gap-2">
                <span className="flex-1">{PRESETS[key].label}</span>
                <span className="text-muted-foreground text-xs">{PRESETS[key].detail}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {error ? <p className="px-2 py-1.5 text-destructive text-xs">{error}</p> : null}
      </MenuPopup>
    </Menu>
  );
}
