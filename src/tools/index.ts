/**
 * 工具注册聚合：决定注册哪些工具、按什么顺序注册，并把结果回报给入口。
 *
 * 只做装配，不含业务逻辑；`readOnly` 的过滤规则也在这里（它决定的是"注册面"，不是工具行为）。
 * 必须始终成立：注册顺序 = 模型看到的顺序，按"看 → 点 → 输入 → 应用/窗口 → 剪贴板"排，
 * 让模型按工作流顺序读到说明。
 * @module dsh-macos-automation/tools/index
 */
import type { Context } from '@deepseek-ai/cordis';
import { READ_ONLY_TOOLS } from '../constants.ts';
import { registerAppTool } from './app.ts';
import { registerClickTool } from './click.ts';
import { registerClipboardTool } from './clipboard.ts';
import type { ToolEnv } from './env.ts';
import { registerHotkeyTool } from './hotkey.ts';
import { registerMenuTool } from './menu.ts';
import { registerOcrTool } from './ocr.ts';
import { registerScrollTool } from './scroll.ts';
import { registerSeeTool } from './see.ts';
import { registerTypeTool } from './type.ts';
import { registerWindowTool } from './window.ts';

/** 注册项：工具名 + 注册函数，名字用于日志与只读过滤。 */
const REGISTRARS: readonly { readonly toolName: string; readonly register: (ctx: Context, env: ToolEnv) => void }[] = [
  { toolName: 'macos_see', register: registerSeeTool },
  { toolName: 'macos_ocr', register: registerOcrTool },
  { toolName: 'macos_click', register: registerClickTool },
  { toolName: 'macos_type', register: registerTypeTool },
  { toolName: 'macos_hotkey', register: registerHotkeyTool },
  { toolName: 'macos_scroll', register: registerScrollTool },
  { toolName: 'macos_app', register: registerAppTool },
  { toolName: 'macos_window', register: registerWindowTool },
  { toolName: 'macos_menu', register: registerMenuTool },
  { toolName: 'macos_clipboard', register: registerClipboardTool },
];

/**
 * 注册全部（或只读模式下的部分）工具。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 * @param options - `readOnly` 为 true 时只注册 {@link READ_ONLY_TOOLS}。
 * @returns 实际注册的工具名，供入口打日志。
 */
export function registerTools(ctx: Context, env: ToolEnv, options: { readonly readOnly: boolean }): string[] {
  const allowed: ReadonlySet<string> = options.readOnly ? new Set(READ_ONLY_TOOLS) : new Set(REGISTRARS.map((item) => item.toolName));
  const registered: string[] = [];
  for (const item of REGISTRARS) {
    if (!allowed.has(item.toolName)) continue;
    item.register(ctx, env);
    registered.push(item.toolName);
  }
  return registered;
}
