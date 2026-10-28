/**
 * `macos_window`：移动 / 缩放 / 关闭 / 最小化 / 全屏 / 聚焦 / 列出窗口。
 *
 * 窗口按 `--title` 部分匹配挑一个，省略则取该应用的第一个窗口。
 * 必须始终成立：move 要 x+y、resize 要 width+height——缺任何一项 CLI 会直接失败，
 * 所以挡在入口并给出该给哪个参数。
 * @module dsh-macos-automation/tools/window
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { normalizeAppName } from '../args.ts';
import { WINDOW_ACTIONS } from '../constants.ts';
import { MacosToolError } from '../errors.ts';
import { asRecord, compact, parseWindowList } from '../parse.ts';
import type { WindowValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_window`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerWindowTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_window',
    description:
      '管理窗口：list、move（要 x/y）、resize（要 width/height）、close、minimize、maximize（进全屏）、focus。' +
      'action=list 时省略 app 列出所有应用的窗口。同一应用多窗口时用 title 部分匹配指定。',
    parameters: {
      action: { type: 'string', required: true, enum: [...WINDOW_ACTIONS], description: '操作' },
      app: { type: 'string', description: '目标应用名（list 时可省略）' },
      title: { type: 'string', description: '窗口标题的部分匹配' },
      x: { type: 'number', description: 'move 的目标 X' },
      y: { type: 'number', description: 'move 的目标 Y' },
      width: { type: 'number', description: 'resize 的宽度' },
      height: { type: 'number', description: 'resize 的高度' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          app: { type: 'string' },
          success: { type: 'boolean' },
          windows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'number', required: true },
                title: { type: 'string', required: true },
                app: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.action === 'list') {
          const windows = value.windows ?? [];
          const lines = windows.map((window) => `[${window.index}] ${window.app} — ${window.title || '(无标题)'}`);
          return [{ type: 'text', text: `共 ${windows.length} 个窗口\n${lines.join('\n')}` }];
        }
        return [{ type: 'text', text: `窗口 ${value.action} 完成：${value.app ?? ''}` }];
      },
    },
    isConcurrencySafe: (args) => args.action === 'list',
    async execute(args, exec) {
      const app = normalizeAppName(args.app);
      if (args.action !== 'list' && app === undefined) {
        throw new MacosToolError('invalid-argument', `${args.action} 需要 app 参数`, '只有 action=list 能省略 app。');
      }
      if (args.action === 'move' && (args.x === undefined || args.y === undefined)) {
        throw new MacosToolError('invalid-argument', 'move 需要 x 与 y');
      }
      if (args.action === 'resize' && (args.width === undefined || args.height === undefined)) {
        throw new MacosToolError('invalid-argument', 'resize 需要 width 与 height');
      }

      const cliArgs = ['window', '--action', args.action];
      if (app !== undefined) cliArgs.push('--app', app);
      if (args.title !== undefined) cliArgs.push('--title', args.title);
      if (args.x !== undefined) cliArgs.push('--x', String(Math.round(args.x)));
      if (args.y !== undefined) cliArgs.push('--y', String(Math.round(args.y)));
      if (args.width !== undefined) cliArgs.push('--width', String(Math.round(args.width)));
      if (args.height !== undefined) cliArgs.push('--height', String(Math.round(args.height)));

      const raw = await runCli(env, cliArgs, exec.signal);
      if (args.action === 'list') {
        return { action: 'list', windows: parseWindowList(raw) } satisfies WindowValue;
      }
      const record = asRecord(raw, 'window');
      return compact({
        action: args.action,
        app,
        success: record.success === true,
      }) satisfies WindowValue;
    },
  }));
}
