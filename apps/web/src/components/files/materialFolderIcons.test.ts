import { describe, expect, it } from "vite-plus/test";

import { baseFolderName, folderIconCss, folderIconId } from "./materialFolderIcons";
import * as icons from "./materialFolderIcons.generated";

describe("material folder icons", () => {
  it("matches a folder by its base name, whatever its prefix or case", () => {
    expect(baseFolderName(".GitHub")).toBe("github");
    expect(baseFolderName("__tests__")).toBe("tests");
    expect(folderIconId(icons, "src")).toBe("src");
    expect(folderIconId(icons, ".vscode")).toBe("vscode");
    expect(folderIconId(icons, "no-such-folder-name")).toBe("");
  });

  it("has an icon for every name and an open icon for every closed one", () => {
    for (const id of new Set(Object.values(icons.MATERIAL_FOLDER_ICON_NAMES))) {
      expect(icons.MATERIAL_FOLDER_ICON_SVGS[id], id).toMatch(/^<svg/);
      expect(icons.MATERIAL_FOLDER_ICON_SVGS[`${id}-open`], `${id}-open`).toMatch(/^<svg/);
    }
  });

  it("writes rules only for the folders the tree holds, closed rules after open ones", () => {
    const css = folderIconCss(icons, [
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

  it("escapes quotes in folder names it matches", () => {
    expect(folderIconCss(icons, ["it's/src/"])).toContain(`[data-item-path$='/src/' i]`);
    const css = folderIconCss({ ...icons, MATERIAL_FOLDER_ICON_NAMES: { "o'brien": "src" } }, [
      "o'brien",
    ]);
    expect(css).toContain(`[data-item-path='o\\'brien/' i]`);
  });
});
