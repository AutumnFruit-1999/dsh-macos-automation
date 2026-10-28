/**
 * `macos_see`：发现 UI 元素（扁平列表）或导出原始 AX 树。
 *
 * 两个 CLI 子命令合成一个工具：`see`（flat）与 `inspect`（tree）。合并的理由是模型只需要
 * 一个"看界面"的入口，选哪个子命令是纯实现细节，不该让它先做一次选择题。
 * 必须始终成立：flat 返回的每个元素都带 `frame.cx/cy`——模型点的是中心点，坐标换算不该外推给模型。
 * @module dsh-macos-automation/tools/see
 */
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { MAX_TREE_RENDER_DEPTH } from '../constants.ts';
import { asRecord, compact, parseElements } from '../parse.ts';
import { elementLine, limitItems, treeLines, withTruncationNotice } from '../result.ts';
import type { UiElement } from '../types.ts';
import { normalizeAppName, normalizeLimit } from '../args.ts';
import { runCli, type ToolEnv } from './env.ts';

/** 元素对象的规范值形状（`see` 与后续工具共用同一字段语义）。 */
const ELEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '本次结果内的短 id' },
    role: { type: 'string', required: true, description: 'AX 角色，如 AXButton' },
    title: { type: 'string' },
    value: { type: 'string' },
    description: { type: 'string' },
    actions: { type: 'array', items: { type: 'string' } },
    frame: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
        w: { type: 'number', required: true },
        h: { type: 'number', required: true },
        cx: { type: 'number', required: true, description: '中心点 X，可直接用于 macos_click' },
        cy: { type: 'number', required: true, description: '中心点 Y' },
      },
    },
  },
} as const;

/**
 * 统计 AX 树节点数（带上限，避免病态输入把栈打穿）。
 * @param tree - 未知形状的树。
 * @param cap - 计数上限。
 * @returns 节点数，最多 `cap`。
 */
function countNodes(tree: unknown, cap = 10_000): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (count >= cap || typeof node !== 'object' || node === null) return;
    count += 1;
    const children = (node as Record<string, unknown>).children;
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  walk(tree);
  return count;
}

/**
 * 注册 `macos_see`。
 * @param ctx - 宿主上下文（提供 tools 服务）。
 * @param env - CLI 与配置。
 */
export function registerSeeTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_see',
    description:
      '读取 macOS 应用的 UI 元素及其屏幕坐标（中心点可直接用于 macos_click）。' +
      '要点击或输入之前先用它定位；元素列表随界面变化，交互后应重新调用。' +
      'Electron 应用（钉钉/飞书/VS Code）的浮层常不在 AX 树里，此时改用 macos_ocr。',
    parameters: {
      app: { type: 'string', description: '应用名，必须是 localizedName（中文系统下是「访达」不是「Finder」）；省略=前台应用' },
      view: { type: 'string', enum: ['flat', 'tree'], description: 'flat=可交互元素列表（默认，带坐标）；tree=原始 AX 层级树（看结构用）' },
      webContent: { type: 'boolean', description: 'flat 专用：包含 Web 视图内元素（Electron 应用用）' },
      all: { type: 'boolean', description: 'flat 专用：不过滤角色，返回全部元素（数量大，通常配合 limit）' },
      maxDepth: { type: 'number', description: 'AX 树遍历深度，flat 默认 10，tree 默认 5' },
      screenshot: { type: 'string', description: 'flat 专用：把目标窗口截图保存到此路径（绝对路径）。只是落盘，不会把图返回给你；要看到内容还得用 read 读该文件，而那需要当前模型声明 image 输入（纯文本路由会报 "does not declare image input"）——这类路由请改用 macos_ocr' },
      annotate: { type: 'boolean', description: 'flat 专用：在截图上标注元素 id（需同时给 screenshot）' },
      limit: { type: 'number', description: '本次最多返回多少条，默认取插件配置 maxElements' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          app: { type: 'string', required: true },
          view: { type: 'string', required: true, enum: ['flat', 'tree'] },
          total: { type: 'number', required: true, description: '截断前的总数（tree 为节点数）' },
          truncated: { type: 'boolean', required: true },
          elements: { type: 'array', required: true, items: ELEMENT_SCHEMA },
          tree: { type: 'json', description: 'view=tree 时的原始 AX 树' },
          screenshot: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const head =
          value.view === 'flat'
            ? `${value.app} · flat · ${value.elements.length}/${value.total} 元素`
            : `${value.app} · tree · ${value.total} 节点（深度上限 ${MAX_TREE_RENDER_DEPTH} 层参与渲染）`;
        if (value.view === 'tree') {
          return [{ type: 'text', text: withTruncationNotice(head, treeLines(value.tree), { total: value.total, truncated: false }) }];
        }
        const lines = value.elements.map((element: UiElement) => elementLine(element));
        return [{ type: 'text', text: withTruncationNotice(head, lines, value) }];
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const app = normalizeAppName(args.app);
      const limit = normalizeLimit(args.limit, env.maxElements);
      const depth = args.maxDepth ?? (args.view === 'tree' ? 5 : 10);

      if (args.view === 'tree') {
        const raw = asRecord(
          await runCli(env, ['inspect', ...(app === undefined ? [] : ['--app', app]), '--max-depth', String(depth), '--detailed'], exec.signal),
          'inspect',
        );
        const tree = raw.tree;
        return {
          app: typeof raw.app === 'string' ? raw.app : (app ?? 'frontmost'),
          view: 'tree' as const,
          total: countNodes(tree),
          truncated: false,
          elements: [] as UiElement[],
          tree: (tree ?? {}) as JsonValue,
        };
      }

      const cliArgs = ['see', ...(app === undefined ? [] : ['--app', app]), '--max-depth', String(depth)];
      if (args.all === true) cliArgs.push('--all');
      else if (args.webContent === true) cliArgs.push('--web-content');
      if (args.screenshot !== undefined) {
        cliArgs.push('--screenshot', args.screenshot);
        if (args.annotate === true) cliArgs.push('--annotate');
      }

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'see');
      const limited = limitItems(parseElements(raw.elements), limit);
      return compact({
        app: typeof raw.app === 'string' ? raw.app : (app ?? 'frontmost'),
        view: 'flat' as const,
        total: limited.total,
        truncated: limited.truncated,
        elements: [...limited.items],
        screenshot: typeof raw.screenshot === 'string' ? raw.screenshot : undefined,
      });
    },
  }));
}
