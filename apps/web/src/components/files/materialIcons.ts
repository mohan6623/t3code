import { type RefObject, useEffect, useState } from "react";

/**
 * Fork: Material Icon Theme file and folder icons for the project file tree,
 * as in VS Code and Monocode. @pierre/trees draws only an arrow for a folder,
 * so a stylesheet put into the tree's shadow root adds the folder icon after
 * the arrow and puts the theme's icon in place of the file icon. Only names
 * the tree holds get a rule.
 */

type IconData = typeof import("./materialIcons.generated");

let iconData: IconData | null = null;
let loadingIconData: Promise<IconData> | null = null;

/** The icon set is about 1 MB, so it loads only when a file tree opens. */
function loadIconData(): Promise<IconData> {
  loadingIconData ??= import("./materialIcons.generated").then((module) => {
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

/** The closed icon id for a folder name. */
export function folderIconId(
  data: Pick<IconData, "MATERIAL_FOLDER_ICON_NAMES" | "MATERIAL_FOLDER_ICON">,
  name: string,
): string {
  return data.MATERIAL_FOLDER_ICON_NAMES[baseFolderName(name)] ?? data.MATERIAL_FOLDER_ICON;
}

/** What picks a file's icon: its full name, or its longest known extension. */
export type FileIconMatch =
  | { readonly kind: "name"; readonly key: string; readonly id: string }
  | { readonly kind: "extension"; readonly key: string; readonly id: string };

/** As VS Code: the file name first, then extensions from longest ("d.ts") to shortest ("ts"). */
export function fileIconMatch(
  data: Pick<IconData, "MATERIAL_FILE_ICON_NAMES" | "MATERIAL_FILE_ICON_EXTENSIONS">,
  name: string,
): FileIconMatch | null {
  const lower = name.toLowerCase();
  const byName = data.MATERIAL_FILE_ICON_NAMES[lower];
  if (byName !== undefined) return { kind: "name", key: lower, id: byName };
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const extension = lower.slice(dot + 1);
    const byExtension = data.MATERIAL_FILE_ICON_EXTENSIONS[extension];
    if (byExtension !== undefined) return { kind: "extension", key: extension, id: byExtension };
  }
  return null;
}

function svgUrl(data: IconData, id: string): string | null {
  const svg = data.MATERIAL_ICON_SVGS[id];
  return svg === undefined ? null : `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function cssString(value: string): string {
  return `'${value.replace(/['\\]/g, "\\$&").replace(/\n/g, "\\a ")}'`;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const FOLDER = "button[data-item-type='folder']";
const FILE = "button[data-item-type='file']";
// Sticky folder headers carry no aria-expanded; they are always open folders.
const CLOSED = "[aria-expanded='false']";
const ICON = "> [data-item-section='icon']";
const STYLE_ATTRIBUTE = "data-t3-material-icons";

/**
 * Indent: one level is half an icon plus 6px, instead of the tree's ~21px,
 * so the guide line sits close to the arrow it leads to. A file has no arrow,
 * so its icon starts right after the indent, near the guide line. The folder
 * icon is 18px: the theme draws folders wide and low, so at 16px they look flat.
 */
const LAYOUT_CSS = `
  :host {
    --trees-level-gap-override: 2px;
    --trees-item-row-gap-override: 4px;
  }
  ${FOLDER} ${ICON} {
    width: auto;
    gap: 1px;
  }
  ${FOLDER} ${ICON}::after {
    content: "";
    flex: none;
    width: 18px;
    height: 18px;
    background: var(--t3-folder-icon) center / 100% no-repeat;
  }
  ${FILE} ${ICON} {
    height: var(--trees-icon-width);
    background: var(--t3-file-icon) center / 100% no-repeat;
  }
  ${FILE} ${ICON} > * {
    display: none;
  }
`;

/**
 * The stylesheet for the tree paths in `treePaths`. A folder path ends with
 * "/"; any other path is a file.
 */
export function materialIconCss(data: IconData, treePaths: Iterable<string>): string {
  const rules = [LAYOUT_CSS];
  const plainOpen = svgUrl(data, `${data.MATERIAL_FOLDER_ICON}-open`);
  const plainClosed = svgUrl(data, data.MATERIAL_FOLDER_ICON);
  const plainFile = svgUrl(data, data.MATERIAL_FILE_ICON);
  if (plainOpen) rules.push(`${FOLDER} { --t3-folder-icon: ${plainOpen}; }`);
  if (plainClosed) rules.push(`${FOLDER}${CLOSED} { --t3-folder-icon: ${plainClosed}; }`);
  if (plainFile) rules.push(`${FILE} { --t3-file-icon: ${plainFile}; }`);

  const folderNamesById = new Map<string, Set<string>>();
  const fileNamesById = new Map<string, Set<string>>();
  const extensionsById = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, id: string, key: string) => {
    const keys = map.get(id) ?? new Set<string>();
    keys.add(key);
    map.set(id, keys);
  };
  for (const path of treePaths) {
    if (path.endsWith("/")) {
      const name = baseName(path.replace(/\/+$/, ""));
      const id = folderIconId(data, name);
      if (name !== "" && id !== data.MATERIAL_FOLDER_ICON) add(folderNamesById, id, name);
      continue;
    }
    const match = fileIconMatch(data, baseName(path));
    if (match === null) continue;
    add(match.kind === "name" ? fileNamesById : extensionsById, match.id, match.key);
  }

  const nameMatch = (names: Iterable<string>, suffix: string) =>
    [...names]
      .flatMap((name) => [
        `[data-item-path=${cssString(`${name}${suffix}`)} i]`,
        `[data-item-path$=${cssString(`/${name}${suffix}`)} i]`,
      ])
      .join(", ");

  const openRules: string[] = [];
  const closedRules: string[] = [];
  for (const [id, names] of folderNamesById) {
    const open = svgUrl(data, `${id}-open`) ?? svgUrl(data, id);
    const closed = svgUrl(data, id);
    const match = nameMatch(names, "/");
    if (open) openRules.push(`${FOLDER}:is(${match}) { --t3-folder-icon: ${open}; }`);
    if (closed)
      closedRules.push(`${FOLDER}${CLOSED}:is(${match}) { --t3-folder-icon: ${closed}; }`);
  }

  // A later rule wins, so ".ts" comes before ".d.ts", and a file name rule
  // ("package.json") comes after every extension rule (".json").
  const extensionRules = [...extensionsById].flatMap(([id, extensions]) => {
    const url = svgUrl(data, id);
    if (url === null) return [];
    return [...extensions].map((extension) => ({
      dots: extension.split(".").length,
      rule: `${FILE}[data-item-path$=${cssString(`.${extension}`)} i] { --t3-file-icon: ${url}; }`,
    }));
  });
  extensionRules.sort((left, right) => left.dots - right.dots);
  const fileNameRules = [...fileNamesById].flatMap(([id, names]) => {
    const url = svgUrl(data, id);
    return url === null ? [] : [`${FILE}:is(${nameMatch(names, "")}) { --t3-file-icon: ${url}; }`];
  });

  // Open rules first: a closed rule matches one more attribute, so it wins for closed folders.
  return [
    ...rules,
    ...openRules,
    ...closedRules,
    ...extensionRules.map((entry) => entry.rule),
    ...fileNameRules,
  ].join("\n");
}

/**
 * Puts the icon stylesheet into the tree's shadow root under `containerRef`
 * and keeps it in step with the paths the tree holds.
 */
export function useMaterialIcons(
  containerRef: RefObject<HTMLElement | null>,
  treePaths: readonly string[],
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
  const pathKey = treePaths.join("\n");
  useEffect(() => {
    if (data === null) return;
    const css = materialIconCss(data, pathKey === "" ? [] : pathKey.split("\n"));
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
  }, [containerRef, data, pathKey]);
}
