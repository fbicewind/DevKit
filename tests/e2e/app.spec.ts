import { test, expect } from "@playwright/test";
import { mockSettings } from "./settings-fixture";

test("preview explains native capabilities and preserves inputs between tools", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("界面预览 · 本地计算与桌面功能请使用 Tauri 客户端"),
  ).toBeVisible();
  await page.getByRole("button", { name: "时间戳转换 时间与时区" }).click();
  await page.getByRole("textbox").first().fill("-1");
  await page.getByRole("button", { name: "随机字符串 安全随机生成" }).click();
  await page.getByRole("button", { name: "时间戳转换 时间与时区" }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue("-1");
  await page.getByRole("button", { name: "转换", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("桌面应用");
});

test("settings capture and cancel recording without persisting a change", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置与快捷键 你的偏好" }).click();
  await page.getByRole("button", { name: "⌥ 空格" }).click();
  await expect(page.getByRole("button", { name: "请按组合键…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "⌥ 空格" })).toBeVisible();
});

test("random generation validates limits before invoking backend", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "随机字符串 安全随机生成" }).click();
  await page.getByRole("spinbutton").first().fill("4097");
  await page.getByRole("button", { name: "生成随机字符串" }).click();
  await expect(page.getByRole("alert")).toContainText("1–4096");
});

test("signature rejects reserved or non-string variables", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "签名计算 模板与摘要" }).click();
  await page
    .getByRole("textbox", { name: "模板变量（JSON 字符串键值对）" })
    .fill('{"secret":"oops"}');
  await page.getByRole("button", { name: "计算签名", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("不能覆盖");
});

test("small window keeps all tools reachable and no horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 420 });
  await page.goto("/");
  for (const name of [
    "JSON 工具",
    "时间戳转换",
    "随机字符串",
    "签名计算",
    "设置与快捷键",
  ]) {
    await page.locator("nav").getByTitle(name, { exact: true }).click();
    await expect(page.locator("main h1:visible")).toContainText(
      name === "设置与快捷键" ? "设置与快捷键" : name,
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("JSON editor preserves literal digits and displays backend errors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByLabel("JSON 输入 / 输出", { exact: true }),
  ).toContainText("9007199254740993123456789");
  await page.getByRole("button", { name: "校验并刷新树" }).click();
  await expect(page.locator(".operation-status")).toContainText("桌面应用");
});

// Contract test for the frontend's successful IPC path. Rust engine behavior is
// covered independently by cargo tests and the 30 MiB benchmark.
test("JSON IPC completion refreshes the tree without dirtying or rounding output", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
    };
    host.isTauri = true;
    let serial = 0;
    const jobs = new Map<string, unknown>();
    const exact = '{"n":9007199254740993123456789}';
    const root = {
      id: 0,
      type: "object",
      summary: "{ 1 keys }",
      hasChildren: true,
      childCount: 1,
    };
    host.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === "settings_get")
          return {
            settings: {
              version: 1,
              alwaysOnTop: false,
              rememberWindow: true,
              compact: false,
              theme: "dark",
              jsonEditLimitMib: 10,
              templates: [],
              shortcuts: [],
            },
            shortcutErrors: [],
          };
        if (command === "plugin:event|listen") return 0;
        if (command === "json_open" || command === "json_transform") {
          const taskId = String(++serial);
          jobs.set(taskId, {
            taskId,
            phase: "已完成",
            done: true,
            bytesTotal: 40,
            bytesProcessed: 40,
            ...(command === "json_open"
              ? {
                  opened: {
                    sessionId: taskId,
                    sizeBytes: 40,
                    root,
                    mode: "edit",
                    text: args.text,
                    nodeCount: 2,
                    duplicateKeys: false,
                  },
                }
              : { text: exact }),
          });
          return taskId;
        }
        if (command === "json_task_status")
          return jobs.get(args.taskId as string);
        if (command === "json_task_release" || command === "json_close") return;
        if (command === "json_children")
          return [
            {
              id: 1,
              key: "n",
              type: "number",
              summary: "9007199254740993123456789",
              hasChildren: false,
              childCount: 0,
            },
          ];
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "格式化", exact: true }).click();
  await expect(page.getByLabel("JSON 输入 / 输出", { exact: true })).toHaveText(
    '{"n":9007199254740993123456789}',
  );
  await expect(
    page.getByRole("button", { name: "已校验", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开 root", exact: true }).click();
  await expect(page.getByRole("tree")).toContainText(
    "9007199254740993123456789",
  );
  await expect(page.locator(".operation-status")).toContainText("格式化完成");
});

for (const viewport of [
  { width: 900, height: 420 },
  { width: 520, height: 420 },
]) {
  test(`sidebar toggle stays above status bar and expands at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await mockSettings(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    const compact = viewport.width <= 800;
    const toggle = page.getByRole("button", {
      name: compact ? "展开侧边栏" : "收起侧边栏",
      exact: true,
    });
    await expect(toggle).toBeVisible();
    const box = (await toggle.boundingBox())!;
    const status = (await page.locator(".statusbar").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(status.y);
    const width = (await page.locator(".sidebar").boundingBox())!.width;
    await toggle.click();
    const opposite = page.getByRole("button", {
      name: compact ? "收起侧边栏" : "展开侧边栏",
      exact: true,
    });
    await expect(opposite).toHaveAttribute("aria-expanded", String(compact));
    await expect
      .poll(async () => (await page.locator(".sidebar").boundingBox())!.width)
      .toBe(compact ? 185 : 62);
    expect(width).toBe(compact ? 62 : 185);
    await opposite.click();
    await expect(toggle).toHaveAttribute("aria-expanded", String(!compact));
    await page
      .locator("nav")
      .getByTitle("设置与快捷键", { exact: true })
      .click();
    const after = (await page
      .getByRole("button", {
        name: compact ? "展开侧边栏" : "收起侧边栏",
        exact: true,
      })
      .boundingBox())!;
    expect(after.y + after.height).toBeLessThanOrEqual(status.y);
  });
}

test("JSON edit limit defaults to 10 MiB, saves a custom value, and survives reload", async ({
  page,
}) => {
  await mockSettings(page);
  await page.goto("/");
  await page.locator("nav").getByTitle("设置与快捷键", { exact: true }).click();
  const input = page.getByRole("spinbutton", { name: "编辑上限（MiB）" });
  await expect(input).toHaveValue("10");
  await input.fill("24");
  await page.getByRole("button", { name: "保存编辑上限" }).click();
  await expect(page.getByText("JSON 编辑上限已保存为 24 MiB")).toBeVisible();
  await page.reload();
  await page.locator("nav").getByTitle("设置与快捷键", { exact: true }).click();
  await expect(input).toHaveValue("24");
  await input.fill("65");
  await page.getByRole("button", { name: "保存编辑上限" }).click();
  await page.reload();
  await page.locator("nav").getByTitle("设置与快捷键", { exact: true }).click();
  await expect(input).toHaveValue("24");
});

test("editor accepts over 2 MiB by default and applies a reduced UTF-8 byte limit immediately", async ({
  page,
}) => {
  await mockSettings(page);
  await page.goto("/");
  const editor = page.getByLabel("JSON 输入 / 输出", { exact: true });
  const text = `"${"中".repeat(750_000)}"`;
  await editor.fill(text);
  await expect(page.locator(".editor-pane .pane-header small")).toHaveText(
    "2.15 MiB",
  );
  await page.locator("nav").getByTitle("设置与快捷键", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "编辑上限（MiB）" }).fill("1");
  await page.getByRole("button", { name: "保存编辑上限" }).click();
  await expect(page.getByText("JSON 编辑上限已保存为 1 MiB")).toBeVisible();
  await page.locator("nav").getByTitle("JSON 工具", { exact: true }).click();
  // Lowering the limit preserves existing input and still permits deletion.
  await expect(page.locator(".editor-pane .pane-header small")).toHaveText(
    "2.15 MiB",
  );
  await editor.fill("");
  await editor.fill(`"${"中".repeat(400_000)}"`);
  await expect(page.getByRole("alert")).toContainText("当前编辑上限为 1 MiB");
  await expect
    .poll(() => editor.evaluate((element) => element.textContent?.length))
    .toBe(0);
  await editor.fill('{"ok":true}');
  await expect(editor).toHaveText('{"ok":true}');
});
