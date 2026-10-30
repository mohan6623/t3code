"use client";

import { ImagePlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";

/** Logos live in settings, so they stay small. */
const PROVIDER_LOGO_MAX_BYTES = 64 * 1024;

const ACCEPTED_LOGO_TYPES = [
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/jpeg",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Read failed")));
    reader.readAsDataURL(file);
  });
}

/**
 * Fork: lets the user give any provider instance its own logo. The image is
 * stored as a data URL on the instance, beside its accent color.
 */
export function ProviderLogoPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly onCommit: (value: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toastManager.add({
        type: "error",
        title: "This file is not a supported image",
        description: "Use a PNG, SVG, WebP, JPEG, or ICO file.",
      });
      return;
    }
    if (file.size > PROVIDER_LOGO_MAX_BYTES) {
      toastManager.add({
        type: "error",
        title: "This image is too large",
        description: "Use an image of 64 KB or less.",
      });
      return;
    }
    try {
      props.onCommit(await readFileAsDataUrl(file));
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not read the image",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            aria-label={`${props.value ? "Change" : "Add"} logo for ${props.displayName}`}
          >
            {props.value ? (
              <img src={props.value} alt="" className="size-4 object-contain" draggable={false} />
            ) : (
              <ImagePlusIcon aria-hidden />
            )}
          </Button>
        }
      />
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="none">
        <div className="grid w-56 gap-1 p-1">
          <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
            PNG, SVG, WebP, JPEG, or ICO. 64 KB at most.
          </p>
          <PopoverClose
            render={
              <Button
                type="button"
                size="compact"
                variant="ghost-muted"
                className="w-full justify-start"
                onClick={() => inputRef.current?.click()}
              >
                <UploadIcon className="size-3.5" aria-hidden />
                Choose image
              </Button>
            }
          />
          {props.value ? (
            <PopoverClose
              render={
                <Button
                  type="button"
                  size="compact"
                  variant="ghost-muted"
                  className="w-full justify-start"
                  onClick={() => props.onCommit(undefined)}
                >
                  <XIcon className="size-3.5" aria-hidden />
                  Remove logo
                </Button>
              }
            />
          ) : null}
        </div>
      </PopoverPopup>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_LOGO_TYPES.join(",")}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void chooseFile(file);
        }}
      />
    </Popover>
  );
}
