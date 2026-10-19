import { describe, expect, it } from "vite-plus/test";

import { baseFolderName, fileIconMatch, folderIconId, materialIconCss } from "./materialIcons";
import * as icons from "./materialIcons.generated";

describe("material icons", () => {
  it("matches a folder by its base name, whatever its prefix or case", () => {
    expect(baseFolderName(".GitHub")).toBe("github");
    expect(baseFolderName("__tests__")).toBe("tests");
    expect(folderIconId(icons, "src")).toBe("folder-src");
    expect(folderIconId(icons, ".vscode")).toBe("folder-vscode");
    expect(folderIconId(icons, "no-such-folder-name")).toBe(icons.MATERIAL_FOLDER_ICON);
  });

  it("matches a file by its name first, then by its longest extension", () => {
    expect(fileIconMatch(icons, "package.json")).toEqual({
      kind: "name",
      key: "package.json",
      id: "nodejs",
    });
    expect(fileIconMatch(icons, "README.md")?.kind).toBe("name");
    expect(fileIconMatch(icons, "dpop.test.ts")).toEqual({
      kind: "extension",
      key: "test.ts",
      id: "test-ts",
    });
    expect(fileIconMatch(icons, "Thing.TS")).toEqual({
      kind: "extension",
      key: "ts",
      id: "typescript",
    });
    expect(fileIconMatch(icons, "no-extension")).toBeNull();
  });

  it("has an icon for every name and an open icon for every folder", () => {
    for (const id of new Set(Object.values(icons.MATERIAL_FOLDER_ICON_NAMES))) {
      expect(icons.MATERIAL_ICON_SVGS[id], id).toMatch(/^<svg/);
      expect(icons.MATERIAL_ICON_SVGS[`${id}-open`], `${id}-open`).toMatch(/^<svg/);
    }
    for (const id of [
      ...Object.values(icons.MATERIAL_FILE_ICON_NAMES),
      ...Object.values(icons.MATERIAL_FILE_ICON_EXTENSIONS),
      icons.MATERIAL_FILE_ICON,
    ]) {
      expect(icons.MATERIAL_ICON_SVGS[id], id).toMatch(/^<svg/);
    }
  });

  it("writes folder rules only for the folders the tree holds, closed rules after open ones", () => {
    const css = materialIconCss(icons, [
      "src/",
      "apps/web/src/",
      "apps/My Odd 'dir'/",
      "scratchpad/",
    ]);
    expect(css).toContain(`[data-item-path='src/' i]`);
    expect(css).toContain(`[data-item-path$='/src/' i]`);
    expect(css).not.toContain("scratchpad");
    expect(css).not.toContain("My Odd");
    const open = css.indexOf(`button[data-item-type='folder']:is([data-item-path='src/' i]`);
    const closed = css.indexOf(
      `button[data-item-type='folder'][aria-expanded='false']:is([data-item-path='src/' i]`,
    );
    expect(open).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(open);
  });

  it("orders file rules so the longer extension and then the file name win", () => {
    const css = materialIconCss(icons, [
      "apps/package.json",
      "apps/tsconfig.json",
      "src/a.test.ts",
      "src/b.ts",
      "notes",
    ]);
    const ts = css.indexOf(`[data-item-path$='.ts' i]`);
    const testTs = css.indexOf(`[data-item-path$='.test.ts' i]`);
    const json = css.indexOf(`[data-item-path$='.json' i]`);
    const packageJson = css.indexOf(`[data-item-path$='/package.json' i]`);
    expect(ts).toBeGreaterThan(0);
    expect(testTs).toBeGreaterThan(ts);
    expect(json).toBe(-1);
    expect(packageJson).toBeGreaterThan(testTs);
    expect(css).not.toContain("notes");
  });

  it("escapes quotes in names it matches", () => {
    expect(materialIconCss(icons, ["it's/src/"])).toContain(`[data-item-path$='/src/' i]`);
    const css = materialIconCss(
      { ...icons, MATERIAL_FOLDER_ICON_NAMES: { "o'brien": "folder-src" } },
      ["o'brien/"],
    );
    expect(css).toContain(`[data-item-path='o\\'brien/' i]`);
  });
});
