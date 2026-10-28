/**
 * `macos_menu`：列出或点击应用菜单栏项。
 *
 * 菜单是 AX 里最稳定的一层：按钮找不到、图标认不出时，走菜单往往能做成同一件事
 * （例如"文件 > 新建"），因此这是点击的可靠兜底。
 * 必须始终成立：click 必须给 path，且路径层级用 ` > ` 分隔、名字与应用当前语言一致。
 * @module dsh-macos-automation/tools/menu
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { normalizeAppName } from '../args.ts';
import { MENU_ACTIONS } from '../constants.ts';
import { MacosToolError } from '../errors.ts';
import { asArray, asRecord } from '../parse.ts';
import type { MenuValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/** 一个菜单分组（CLI 的 MenuItem：菜单名 + 子项标题）。 */
interface MenuGroup {
  readonly menu: string;
  readonly items: string[];
}

/**
 * 解析 `menu --action list` 的返回值。
 * @param raw - CLI 输出。
 * @returns 菜单分组列表。
 */
function parseMenuGroups(raw: unknown): MenuGroup[] {
  const groups: MenuGroup[] = [];
  for (const item of asArray(raw, 'menu.list')) {
    if (typeof item !== 'object' || item === null) continue;
    const source = item as Record<string, unknown>;
    const menu = typeof source.menu === 'string' ? source.menu : '';
    if (menu.length === 0) continue;
    const items = Array.isArray(source.items)
      ? source.items.filter((title): title is string => typeof title === 'string')
      : [];
    groups.push({ menu, items });
  }
  return groups;
}

/**
 * 注册 `macos_menu`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerMenuTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_menu',
    description:
      '操作应用菜单栏：list（列出菜单与子项）或 click（按 "Menu > Item" 路径点击）。' +
      '菜单项走 AX 的 press 动作，比坐标点击稳，适合"新建/保存/导出"这类标准动作。' +
      '路径名字必须与应用当前语言一致（中文界面就是中文菜单名）。',
    parameters: {
      action: { type: 'string', required: true, enum: [...MENU_ACTIONS], description: '操作' },
      app: { type: 'string', required: true, description: '目标应用名' },
      path: { type: 'string', description: 'click 的菜单路径，如 "文件 > 新建"（层级用 " > " 分隔）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          path: { type: 'string' },
          success: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                menu: { type: 'string', required: true },
                items: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.action === 'list') {
          const groups = value.items ?? [];
          const lines = groups.map((group) => `${group.menu}: ${group.items.join(' | ')}`);
          return [{ type: 'text', text: `共 ${groups.length} 个菜单\n${lines.join('\n')}` }];
        }
        return [{ type: 'text', text: `已点击菜单 ${value.path ?? ''}` }];
      },
    },
    isConcurrencySafe: (args) => args.action === 'list',
    async execute(args, exec) {
      const app = normalizeAppName(args.app);
      if (app === undefined) {
        throw new MacosToolError('invalid-argument', 'app 必填', '菜单栏属于具体应用，先用 macos_app 拿到名字。');
      }
      if (args.action === 'click' && (args.path === undefined || args.path.trim().length === 0)) {
        throw new MacosToolError('invalid-argument', 'click 需要 path', '先 action=list 看到确切的菜单名，再按 "菜单 > 子项" 传。');
      }

      const cliArgs = ['menu', '--action', args.action, '--app', app];
      if (args.path !== undefined) cliArgs.push('--path', args.path);

      const raw = await runCli(env, cliArgs, exec.signal);
      if (args.action === 'list') {
        return { action: 'list', items: parseMenuGroups(raw) } satisfies MenuValue;
      }
      const record = asRecord(raw, 'menu');
      return {
        action: 'click',
        path: typeof record.path === 'string' ? record.path : args.path,
        success: record.success === true,
      } satisfies MenuValue;
    },
  }));
}
