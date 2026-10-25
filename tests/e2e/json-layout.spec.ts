import { test, expect } from "@playwright/test";
import { mockSettings } from "./settings-fixture";

for (const width of [1200, 520]) {
  test(`JSON tree toggle gives editor full width and retains folds at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 650 });
    const source = '{\n  "data": [\n    1,\n    2\n  ]\n}';
    await mockSettings(page, { jsonSource: source });
    await page.goto("/");
    await page.getByTitle("导入剪贴板（支持大 JSON）", { exact: true }).click();
    const editor = page.locator(".cm-editor");
    const originalEditor = await editor.elementHandle();
    const tree = page.locator("#json-node-tree");
    const originalTree = await tree.elementHandle();
    await expect(tree).toBeVisible();
    await expect(
      page.locator(".json-fold-toggle").filter({ visible: true }).first(),
    ).toBeVisible();
    await page
      .locator(".json-fold-toggle")
      .filter({ visible: true })
      .first()
      .click();
    const folded = page.getByRole("button", {
      name: "展开已折叠的 JSON 节点",
      exact: true,
    });
    await expect(folded).toBeVisible();
    await page.getByRole("button", { name: "隐藏节点树", exact: true }).click();
    const show = page.getByRole("button", { name: "显示节点树", exact: true });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(tree).toBeHidden();
    await expect
      .poll(async () => {
        const pane = (await page.locator(".editor-pane").boundingBox())!;
        const container = (await page.locator(".json-panes").boundingBox())!;
        return Math.abs(pane.width - container.width);
      })
      .toBeLessThanOrEqual(1);
    await expect(folded).toBeVisible();
    await page.locator("nav").getByTitle("时间戳转换", { exact: true }).click();
    await page.locator("nav").getByTitle("JSON 工具", { exact: true }).click();
    await expect(show).toBeVisible();
    await show.click();
    await expect(tree).toBeVisible();
    expect(
      await editor.evaluate(
        (node, original) => node === original,
        originalEditor,
      ),
    ).toBe(true);
    expect(
      await tree.evaluate((node, original) => node === original, originalTree),
    ).toBe(true);
    await expect(folded).toBeVisible();
    await folded.click();
    expect(
      await page.locator(".cm-content .cm-line").allTextContents(),
    ).toEqual(source.split("\n"));
    await expect(page.locator(".editor-pane .pane-footer")).toContainText(
      "已校验",
    );
    await originalEditor?.dispose();
    await originalTree?.dispose();
  });
}
