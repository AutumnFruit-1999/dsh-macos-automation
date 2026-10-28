/**
 * `macos_scroll`：在指定位置（或当前指针处）滚动。
 *
 * 滚轮事件发到指针所在位置，所以"滚某个面板"必须先给坐标把指针移过去。
 * 必须始终成立：方向必须先过枚举校验——CLI 的 `ScrollDirection(rawValue:)` 只在完全匹配时成功。
 * @module dsh-macos-automation/tools/scroll
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { formatPoint, normalizeScrollAmount } from '../args.ts';
import { asRecord, compact } from '../parse.ts';
import { SCROLL_DIRECTIONS } from '../constants.ts';
import type { ScrollValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_scroll`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerScrollTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_scroll',
    description:
      '滚动滚轮。滚轮事件落在鼠标指针位置，所以要滚某个列表时先给 x/y 把指针移过去。' +
      'amount 是行数（默认 3），一次滚太多会跳过目标内容，宁可多滚几次。',
    parameters: {
      direction: { type: 'string', required: true, enum: [...SCROLL_DIRECTIONS], description: '滚动方向' },
      amount: { type: 'number', description: '滚动行数，默认 3，上限 100' },
      x: { type: 'number', description: '先把指针移到此 X（与 y 成对）' },
      y: { type: 'number', description: '先把指针移到此 Y' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          direction: { type: 'string', required: true },
          amount: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已向 ${value.direction} 滚动 ${value.amount} 行` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const amount = normalizeScrollAmount(args.amount);
      const coords = formatPoint(args.x === undefined || args.y === undefined ? undefined : { x: args.x, y: args.y }, '指针坐标');
      const cliArgs = ['scroll', '--direction', args.direction, '--amount', String(amount)];
      if (coords !== undefined) cliArgs.push('--coords', coords);

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'scroll');
      return compact({
        direction: typeof raw.direction === 'string' ? raw.direction : args.direction,
        amount: typeof raw.amount === 'number' ? raw.amount : amount,
      }) as ScrollValue;
    },
  }));
}
