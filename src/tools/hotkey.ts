/**
 * `macos_hotkey`：按下快捷键组合。
 *
 * 组合先经白名单与禁止列表校验（见 args.ts），再交给 CLI 发 CGEvent。
 * 必须始终成立：写工具不并发——两次快捷键交错会落到不可预期的组合上。
 * @module dsh-macos-automation/tools/hotkey
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { normalizeHotkey } from '../args.ts';
import { asRecord } from '../parse.ts';
import type { HotkeyValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_hotkey`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerHotkeyTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_hotkey',
    description:
      '按下快捷键组合，如 "cmd,c"、"cmd,shift,t"、"cmd,v"。修饰键：cmd/shift/alt/ctrl/fn；' +
      '普通键：a-z、0-9、space/return/tab/escape/delete/arrow_up…/f1-f12。' +
      '会改变登录会话的组合（cmd+shift+q 等）被拒绝。',
    parameters: {
      keys: { type: 'string', required: true, description: '逗号分隔的组合，如 "cmd,shift,t"' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { pressed: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `已按下 ${value.pressed}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const keys = normalizeHotkey(args.keys);
      const raw = asRecord(await runCli(env, ['hotkey', '--keys', keys], exec.signal), 'hotkey');
      const value: HotkeyValue = { pressed: typeof raw.pressed === 'string' ? raw.pressed : keys };
      return value;
    },
  }));
}
