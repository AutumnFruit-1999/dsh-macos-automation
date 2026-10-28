/**
 * `macos_app`：启动 / 退出 / 聚焦 / 列出应用。
 *
 * `list` 是本插件排障的第一入口：中文系统下应用名是 localizedName，模型猜错名字时
 * 唯一可靠的办法就是先 list 一次。
 * 必须始终成立：除 list 外必须给 app，否则 CLI 直接报「需要 --name」。
 * @module dsh-macos-automation/tools/app
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { normalizeAppName } from '../args.ts';
import { APP_ACTIONS } from '../constants.ts';
import { MacosToolError } from '../errors.ts';
import { compact, parseAppList, requiredNumber } from '../parse.ts';
import type { AppValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_app`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerAppTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_app',
    description:
      '管理应用：list（列出运行中的常规应用，含 pid 与是否前台）、launch、quit、focus。' +
      '不确定应用名时先 list——名字必须是系统显示的名字（「访达」而不是「Finder」）。' +
      'focus 会把窗口提到最前并取消最小化；对无窗口的常驻应用（如关窗后的微信）会重新唤起。',
    parameters: {
      action: { type: 'string', required: true, enum: [...APP_ACTIONS], description: '操作' },
      app: { type: 'string', description: '应用名（launch/quit/focus 必填）' },
      force: { type: 'boolean', description: 'quit 时强制退出' },
      wait: { type: 'boolean', description: 'launch 后等待约 2 秒让应用就绪' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          app: { type: 'string' },
          pid: { type: 'number' },
          apps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                pid: { type: 'number', required: true },
                active: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.action === 'list') {
          const apps = value.apps ?? [];
          const lines = apps.map((app) => `${app.active ? '*' : ' '} ${app.name} (pid ${app.pid})`);
          return [{ type: 'text', text: `运行中 ${apps.length} 个应用（* 为前台）\n${lines.join('\n')}` }];
        }
        const pid = value.pid === undefined ? '' : ` (pid ${value.pid})`;
        return [{ type: 'text', text: `已 ${value.action} ${value.app ?? ''}${pid}` }];
      },
    },
    isConcurrencySafe: (args) => args.action === 'list',
    async execute(args, exec) {
      const app = normalizeAppName(args.app);
      if (args.action !== 'list' && app === undefined) {
        throw new MacosToolError('invalid-argument', `${args.action} 需要 app 参数`, '先 macos_app({ action: "list" }) 拿到准确应用名。');
      }
      const cliArgs = ['app', '--action', args.action];
      if (app !== undefined) cliArgs.push('--name', app);
      if (args.force === true) cliArgs.push('--force');
      if (args.wait === true) cliArgs.push('--wait');

      const raw = await runCli(env, cliArgs, exec.signal);
      if (args.action === 'list') {
        return { action: 'list', apps: parseAppList(raw) } satisfies AppValue;
      }
      const record = raw as Record<string, unknown>;
      return compact({
        action: typeof record.action === 'string' ? record.action : args.action,
        app: typeof record.app === 'string' ? record.app : app,
        pid: record.pid === undefined ? undefined : requiredNumber(record, 'pid', 'app'),
      }) satisfies AppValue;
    },
  }));
}
