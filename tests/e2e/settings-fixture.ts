import type { Page } from "@playwright/test";

export async function mockSettings(
  page: Page,
  options: { jsonSource?: string; workerUnavailable?: boolean } = {},
) {
  await page.addInitScript((options) => {
    const host = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
    };
    host.isTauri = true;
    if (options.workerUnavailable)
      window.Worker = class {
        constructor() {
          throw new Error("Test worker unavailable");
        }
      } as unknown as typeof Worker;
    let serial = 0;
    const jobs = new Map<string, unknown>();
    const defaults = {
      version: 1,
      alwaysOnTop: false,
      rememberWindow: true,
      compact: false,
      theme: "dark",
      jsonEditLimitMib: 10,
      templates: [],
      shortcuts: [],
    };
    let settings =
      JSON.parse(localStorage.getItem("test-settings") || "null") || defaults;
    host.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (
        command: string,
        args: {
          patch?: Record<string, unknown>;
          text?: string;
          taskId?: string;
        },
      ) => {
        if (command === "settings_get") return { settings, shortcutErrors: [] };
        if (command === "settings_update") {
          settings = { ...settings, ...args.patch };
          localStorage.setItem("test-settings", JSON.stringify(settings));
          return settings;
        }
        if (command === "json_open" && options.jsonSource) {
          const taskId = String(++serial);
          const text = args.text ?? options.jsonSource;
          jobs.set(taskId, {
            taskId,
            done: true,
            phase: "已完成",
            bytesTotal: text.length,
            bytesProcessed: text.length,
            opened: {
              sessionId: taskId,
              text,
              mode: "edit",
              sizeBytes: new TextEncoder().encode(text).length,
              nodeCount: 3,
              duplicateKeys: false,
              root: {
                id: 0,
                type: "object",
                summary: "{ … }",
                hasChildren: true,
                childCount: 3,
              },
            },
          });
          return taskId;
        }
        if (command === "json_task_status") return jobs.get(args.taskId!);
        if (command === "json_task_release" || command === "json_close") return;
        if (command === "plugin:event|listen") return 0;
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  }, options);
}
