/**
 * `macos_click`：按文本或坐标点击。
 *
 * 点击是全局副作用（会让窗口失去/获得焦点），因此不参与并发。
 * 必须始终成立：`query` 与 `x/y` 二选一——两个都给时 CLI 会静默优先坐标，模型会以为按文本点了。
 * @module dsh-macos-automation/tools/click
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { formatPoint, normalizeAppName } from '../args.ts';
import { MacosToolError } from '../errors.ts';
import { asRecord, compact } from '../parse.ts';
import type { ClickValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_click`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerClickTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_click',
    description:
      '点击屏幕坐标或按文本查找元素后点击其中心。坐标取自 macos_see 返回的 `→ cx,cy`，' +
      '不要自己算中心点。文本查找只看当前可见元素，命中失败时改用坐标。',
    parameters: {
      x: { type: 'number', description: '点击点 X（与 y 成对，和 query 互斥）' },
      y: { type: 'number', description: '点击点 Y' },
      query: { type: 'string', description: '按文本内容查找元素并点击其中心（与 x/y 互斥）' },
      app: { type: 'string', description: '限定 query 的搜索范围' },
      double: { type: 'boolean', description: '双击' },
      right: { type: 'boolean', description: '右键点击' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clicked: { type: 'boolean', required: true },
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          button: { type: 'string', required: true, enum: ['left', 'right'] },
          clickCount: { type: 'number', required: true },
        },
      },
      render: (args, value) => {
        const how = args.query === undefined ? '' : `「${args.query}」`;
        const button = value.button === 'right' ? '右键' : '左键';
        return [{ type: 'text', text: `已点击${how} ${button}×${value.clickCount} @ ${value.x},${value.y}` }];
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const hasCoords = args.x !== undefined || args.y !== undefined;
      if (args.query !== undefined && hasCoords) {
        throw new MacosToolError('invalid-argument', 'query 与 x/y 只能给一个', '按文本点就只给 query，按坐标点就只给 x 和 y。');
      }
      if (args.query === undefined && !hasCoords) {
        throw new MacosToolError('invalid-argument', '必须提供 query 或 x/y', '坐标来自 macos_see 的 `→ cx,cy`。');
      }
      if (hasCoords && (args.x === undefined || args.y === undefined)) {
        throw new MacosToolError('invalid-argument', 'x 与 y 必须成对出现');
      }

      const coords = formatPoint(args.x === undefined || args.y === undefined ? undefined : { x: args.x, y: args.y }, '坐标');
      const app = normalizeAppName(args.app);
      const cliArgs = ['click'];
      if (args.query !== undefined) cliArgs.push('--query', args.query);
      if (coords !== undefined) cliArgs.push('--coords', coords);
      if (app !== undefined) cliArgs.push('--app', app);
      if (args.double === true) cliArgs.push('--double');
      if (args.right === true) cliArgs.push('--right');

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'click');
      return compact({
        clicked: raw.clicked === true,
        x: typeof raw.x === 'number' ? raw.x : 0,
        y: typeof raw.y === 'number' ? raw.y : 0,
        button: raw.button === 'right' ? ('right' as const) : ('left' as const),
        clickCount: typeof raw.click_count === 'number' ? raw.click_count : 1,
      }) as ClickValue;
    },
  }));
}
