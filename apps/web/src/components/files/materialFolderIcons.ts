import { type RefObject, useEffect, useState } from "react";

/**
 * Fork: Material Icon Theme folder icons for the project file tree, as in VS
 * Code and Monocode. @pierre/trees draws only an arrow for a folder, so a
 * stylesheet put into the tree's shadow root adds the icon after the arrow,
 * picked by folder name. Only names the tree holds get a rule.
 */

type IconData = typeof import("./materialFolderIcons.generated");

let iconData: IconData | null = null;
let loadingIconData: Promise<IconData> | null = null;

/** The icon set is about 350 KB, so it loads only when a file tree opens. */
function loadIconData(): Promise<IconData> {
  loadingIconData ??= import("./materialFolderIcons.generated").then((module) => {
    iconData = module;
    return module;
  });
  return loadingIconData;
}

/** The theme names ".github", "_github" and "__github__" alike; match on the base name. */
export function baseFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^[._-]+/, "")
    .replace(/_+$/, "");
}

/** The icon id for a folder name; "" is the plain folder. */
export function folderIconId(data: Pick<IconData, "MATERIAL_FOLDER_ICON_NAMES">, name: string) {
  return data.MATERIAL_FOLDER_ICON_NAMES[baseFolderName(name)] ?? "";
}

function svgUrl(data: IconData, id: string): string | null {
  const svg = data.MATERIAL_FOLDER_ICON_SVGS[id];
  return svg === undefined ? null : `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function cssString(value: string): string {
  return `'${value.replace(/['\\]/g, "\\$&").replace(/\n/g, "\\a ")}'`;
}

const ROW = "button[data-item-type='folder']";
// Sticky folder headers carry no aria-expanded; they are always open folders.
const CLOSED = "[aria-expanded='false']";
const ICON = "> [data-item-section='icon']";
const STYLE_ATTRIBUTE = "data-t3-folder-icons";

/**
 * Indent: one level is half an icon plus 6px, instead of the tree's ~21px,
 * so the guide line sits close to the arrow it leads to. File rows keep an
 * empty arrow column, so their icons line up with folder icons.
 */
const LAYOUT_CSS = `
  :host {
    --trees-level-gap-override: 2px;
    --trees-item-row-gap-override: 4px;
  }
  ${ROW} ${ICON} {
    width: auto;
    gap: 2px;
  }
  ${ROW} ${ICON}::after {
    content: "";
    flex: none;
    width: var(--trees-icon-width);
    height: var(--trees-icon-width);
    background: var(--t3-folder-icon) center / 100% no-repeat;
  }
  button[data-item-type='file'] ${ICON} {
    width: auto;
    gap: 2px;
  }
  button[data-item-type='file'] ${ICON}::before {
    content: "";
    flex: none;
    width: var(--trees-icon-width);
  }
`;

/** The stylesheet for the folder names in `directoryPaths` (with or without a trailing slash). */
export function folderIconCss(data: IconData, directoryPaths: Iterable<string>): string {
  const rules = [LAYOUT_CSS];
  const plainOpen = svgUrl(data, "-open");
  const plainClosed = svgUrl(data, "");
  if (plainOpen) rules.push(`${ROW} { --t3-folder-icon: ${plainOpen}; }`);
  if (plainClosed) rules.push(`${ROW}${CLOSED} { --t3-folder-icon: ${plainClosed}; }`);
  const namesById = new Map<string, Set<string>>();
  for (const path of directoryPaths) {
    const trimmed = path.replace(/\/+$/, "");
    const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    const id = folderIconId(data, name);
    if (name === "" || id === "") continue;
    const names = namesById.get(id) ?? new Set<string>();
    names.add(name);
    namesById.set(id, names);
  }
  const openRules: string[] = [];
  const closedRules: string[] = [];
  for (const [id, names] of namesById) {
    const open = svgUrl(data, `${id}-open`) ?? svgUrl(data, id);
    const closed = svgUrl(data, id);
    const match = [...names]
      .flatMap((name) => [
        `[data-item-path=${cssString(`${name}/`)} i]`,
        `[data-item-path$=${cssString(`/${name}/`)} i]`,
      ])
      .join(", ");
    if (open) openRules.push(`${ROW}:is(${match}) { --t3-folder-icon: ${open}; }`);
    if (closed) closedRules.push(`${ROW}${CLOSED}:is(${match}) { --t3-folder-icon: ${closed}; }`);
  }
  // Open rules first: a closed rule matches one more attribute, so it wins for closed folders.
  return [...rules, ...openRules, ...closedRules].join("\n");
}

/**
 * Puts the folder icon stylesheet into the tree's shadow root under `containerRef`
 * and keeps it in step with the folders the tree holds.
 */
export function useMaterialFolderIcons(
  containerRef: RefObject<HTMLElement | null>,
  directoryPaths: readonly string[],
): void {
  const [data, setData] = useState<IconData | null>(iconData);
  useEffect(() => {
    if (data !== null) return;
    let cancelled = false;
    void loadIconData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data]);

  // The panel rebuilds its path list on each render; react to its content only.
  const folderKey = directoryPaths.join("\n");
  useEffect(() => {
    if (data === null) return;
    const css = folderIconCss(data, folderKey === "" ? [] : folderKey.split("\n"));
    let frame = 0;
    let attempts = 0;
    const apply = () => {
      const shadowRoot = containerRef.current?.querySelector("file-tree-container")?.shadowRoot;
      if (!shadowRoot) {
        // The tree makes its shadow root after its first render.
        if (attempts++ < 30) frame = requestAnimationFrame(apply);
        return;
      }
      let style = shadowRoot.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`);
      if (!style) {
        style = document.createElement("style");
        style.setAttribute(STYLE_ATTRIBUTE, "");
        shadowRoot.append(style);
      }
      if (style.textContent !== css) style.textContent = css;
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [containerRef, data, folderKey]);
}
