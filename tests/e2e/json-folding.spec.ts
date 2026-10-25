import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockSettings } from "./settings-fixture";

async function toggleLine(page: Page, line: number, expanded: boolean) {
  const number = page
    .locator(".cm-lineNumbers .cm-gutterElement")
    .filter({ hasText: new RegExp(`^${line}$`) });
  await expect(number).toBeVisible();
  const buttons = page
    .locator(".cm-foldGutter .json-fold-toggle")
    .filter({ visible: true });
  const find = async () => {
    const box = (await number.boundingBox())!;
    return buttons.evaluateAll(
      (nodes, y) =>
        nodes.findIndex((node) => {
          const box = node.getBoundingClientRect();
          return box.top <= y && box.bottom >= y;
        }),
      box.y + box.height / 2,
    );
  };
  await expect.poll(find).toBeGreaterThanOrEqual(0);
  const button = buttons.nth(await find());
  await expect(button).toHaveAttribute("aria-expanded", String(expanded));
  await button.click();
}
async function goToLine(page: Page, line: number) {
  await page.getByLabel("JSON 输入 / 输出", { exact: true }).click();
  await page.keyboard.press("Meta+Alt+g");
  const input = page.locator('.cm-goto-line input[name="line"]');
  await expect(input).toBeVisible();
  await input.fill(String(line));
  await input.press("Enter");
}
function largeJson() {
  const item =
    '    {\n      "padding": "' +
    "x".repeat(2048) +
    '",\n      "childClassList": [\n        1,\n        2\n      ]\n    }';
  return (
    '{\n  "code": "100",\n  "data": [\n' +
    Array.from({ length: 2500 }, () => item).join(",\n") +
    '\n  ],\n  "tail": true\n}'
  );
}

test("large arrays, enclosing objects and distant nodes can all fold and unfold", async ({
  page,
}) => {
  const source = largeJson();
  await mockSettings(page, { jsonSource: source });
  await page.goto("/");
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await toggleLine(page, 3, true); // multi-megabyte outer data array
  await expect(
    page.locator(".cm-line").filter({ hasText: '"tail": true' }),
  ).toBeVisible();
  await toggleLine(page, 3, false);
  await toggleLine(page, 4, true); // first object
  await toggleLine(page, 1, true); // root, retaining the nested fold
  await page
    .getByRole("button", { name: "展开已折叠的 JSON 节点", exact: true })
    .click();
  await toggleLine(page, 4, false);
  await toggleLine(page, 6, true); // nested array
  await toggleLine(page, 6, false);
  const line = source
    .slice(0, source.lastIndexOf("\n    {") + 1)
    .split("\n").length;
  await goToLine(page, line);
  await toggleLine(page, line, true); // object beyond the initial parse budget
  await toggleLine(page, line, false);
});

test("folding remains available when Worker creation fails", async ({
  page,
}) => {
  await mockSettings(page, {
    jsonSource: largeJson(),
    workerUnavailable: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await toggleLine(page, 3, true);
  await toggleLine(page, 3, false);
});

test("editing replaces stale folding offsets and undo retains editor behavior", async ({
  page,
}) => {
  await mockSettings(page, { jsonSource: largeJson() });
  await page.goto("/");
  const editor = page.getByLabel("JSON 输入 / 输出", { exact: true });
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  await expect(page.locator(".operation-status")).toContainText(
    "JSON 已载入并校验",
  );
  await editor.fill('{\n  "short": [\n    1\n  ]\n}');
  await toggleLine(page, 2, true);
  await toggleLine(page, 2, false);
  await editor.press("Meta+End");
  await editor.press("Enter");
  await editor.press("Meta+z");
  await expect(page.locator(".editor-pane .pane-footer")).toContainText("5 行");
  await toggleLine(page, 2, true);
});

test("supplied JSON file folds data and a nested childClassList array", async ({
  page,
}) => {
  test.skip(
    !process.env.DEVKIT_JSON_FIXTURE,
    "Optional local reproduction file",
  );
  const source = JSON.stringify(
    JSON.parse(readFileSync(process.env.DEVKIT_JSON_FIXTURE!, "utf8")),
    null,
    2,
  );
  await mockSettings(page, { jsonSource: source });
  await page.goto("/");
  await page.getByRole("button", { name: "粘贴", exact: true }).click();
  const dataAt = source.indexOf('"data": [');
  const dataLine = source.slice(0, dataAt).split("\n").length;
  await toggleLine(page, dataLine, true);
  await toggleLine(page, dataLine, false);
  const childAt = source.indexOf('"childClassList": [\n', source.length / 2);
  expect(childAt).toBeGreaterThan(0);
  const childLine = source.slice(0, childAt).split("\n").length;
  await goToLine(page, childLine);
  await toggleLine(page, childLine, true);
  await toggleLine(page, childLine, false);
});
