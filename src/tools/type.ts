/**
 * `macos_type`：把文本输入到当前焦点（或先点一下目标坐标再输入）。
 *
 * 走 CGEvent 逐字符模拟键盘，因此对 AX 不可写的 Electron 搜索框同样有效。
 * 必须始终成立：文本先过长度与 NUL 校验——逐字符发送会长时间占用键盘，超长文本必须挡在入口。
 * @module dsh-macos-automation/tools/type
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { assertTypeText, formatPoint } from '../args.ts';
import { MacosToolError } from '../errors.ts';
import { asRecord, compact } from '../parse.ts';
import type { TypeValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/** 按键间延迟上限（ms）：再高就是肉眼可见的逐字敲，通常意味着该改用剪贴板粘贴。 */
const MAX_DELAY_MS = 500;

/**
 * 注册 `macos_type`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerTypeTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_type',
    description:
      '向当前焦点输入文本（逐字符模拟键盘，支持中文）。输入前请先确保目标已聚焦：' +
      '给 x/y 会先点击该点再输入，或用 macos_click 点一下输入框。' +
      '清空输入框用 clear=true（走 Cmd+A + Delete）。',
    parameters: {
      text: { type: 'string', required: true, description: '要输入的文本（支持中文与换行）' },
      x: { type: 'number', description: '输入前先点击的 X（与 y 成对）' },
      y: { type: 'number', description: '输入前先点击的 Y' },
      clear: { type: 'boolean', description: '输入前清空当前输入框' },
      pressReturn: { type: 'boolean', description: '输入后按回车（提交搜索/发送消息）' },
      delayMs: { type: 'number', description: `按键间隔毫秒（默认 5，上限 ${MAX_DELAY_MS}）` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          typed: { type: 'string', required: true },
          cleared: { type: 'boolean', required: true },
          pressedReturn: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const parts = [`已输入 ${value.typed.length} 字符`];
        if (value.cleared) parts.push('（输入前已清空）');
        if (value.pressedReturn) parts.push('并按下回车');
        return [{ type: 'text', text: parts.join('') }];
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const text = assertTypeText(args.text);
      const coords = formatPoint(args.x === undefined || args.y === undefined ? undefined : { x: args.x, y: args.y }, '点击坐标');
      const delayMs = args.delayMs ?? 5;
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
        throw new MacosToolError('invalid-argument', `delayMs 必须是 0–${MAX_DELAY_MS} 的整数，收到 ${delayMs}`);
      }

      const cliArgs = ['type', '--text', text, '--delay', String(delayMs)];
      if (coords !== undefined) cliArgs.push('--coords', coords);
      if (args.clear === true) cliArgs.push('--clear');
      if (args.pressReturn === true) cliArgs.push('--press-return');

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'type');
      return compact({
        typed: typeof raw.typed === 'string' ? raw.typed : text,
        cleared: raw.cleared === true,
        pressedReturn: raw.pressed_return === true,
      }) as TypeValue;
    },
  }));
}
