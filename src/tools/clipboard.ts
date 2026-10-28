/**
 * `macos_clipboard`：读 / 写 / 清空系统剪贴板，支持文本与文件。
 *
 * 文件模式是给 IM 发文件的推荐姿势：把文件放进剪贴板再 Cmd+V，比点工具栏图标可靠得多
 * （图标按钮通常没有 AX 标签，OCR 也认不出）。
 * 必须始终成立：set 的 text 与 file 二选一——CLI 会拒绝同时给，先在这里挡掉更快。
 * @module dsh-macos-automation/tools/clipboard
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { CLIPBOARD_ACTIONS } from '../constants.ts';
import { MacosToolError } from '../errors.ts';
import { asRecord, compact } from '../parse.ts';
import { clip } from '../result.ts';
import type { ClipboardValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/** 读取文本时给模型的截断长度（字符）：剪贴板可能是一整篇文档。 */
const MAX_CLIPBOARD_CHARS = 2_000;

/** 文件大小的可读化（B/KiB/MiB）。 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * 注册 `macos_clipboard`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerClipboardTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_clipboard',
    description:
      '读写剪贴板：get（读取当前内容，可能是文本或文件路径）、set（写入文本或文件）、clear。' +
      '给 IM 发文件时用它：set 文件 → 聚焦目标应用 → 点输入框 → macos_hotkey("cmd,v")。',
    parameters: {
      action: { type: 'string', required: true, enum: [...CLIPBOARD_ACTIONS], description: '操作' },
      text: { type: 'string', description: 'set 时写入的文本（与 file 互斥）' },
      file: { type: 'string', description: 'set 时放入剪贴板的文件绝对路径（与 text 互斥）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          type: { type: 'string', enum: ['text', 'file'] },
          content: { type: 'string' },
          path: { type: 'string' },
          size: { type: 'number' },
        },
      },
      render: (_args, value) => {
        if (value.action === 'clear') return [{ type: 'text', text: '已清空剪贴板' }];
        if (value.type === 'file') {
          const size = value.size === undefined ? '' : `，${humanSize(value.size)}`;
          return [{ type: 'text', text: `剪贴板是文件：${value.path ?? value.content ?? ''}${size}` }];
        }
        const body = value.content ?? '';
        return [{ type: 'text', text: `剪贴板文本（${body.length} 字符）：\n${clip(body, MAX_CLIPBOARD_CHARS)}` }];
      },
    },
    isConcurrencySafe: (args) => args.action === 'get',
    async execute(args, exec) {
      if (args.action === 'set') {
        const hasText = args.text !== undefined;
        const hasFile = args.file !== undefined;
        if (hasText === hasFile) {
          throw new MacosToolError('invalid-argument', 'set 需要 text 与 file 二选一，且不能同时给');
        }
      }
      const cliArgs = ['clipboard', '--action', args.action];
      if (args.text !== undefined) cliArgs.push('--text', args.text);
      if (args.file !== undefined) cliArgs.push('--file', args.file);

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'clipboard');
      return compact({
        action: typeof raw.action === 'string' ? raw.action : args.action,
        type: raw.type === 'file' ? ('file' as const) : raw.type === 'text' ? ('text' as const) : undefined,
        content: typeof raw.content === 'string' ? raw.content : undefined,
        path: typeof raw.path === 'string' ? raw.path : undefined,
        size: typeof raw.size === 'number' ? raw.size : undefined,
      }) satisfies ClipboardValue;
    },
  }));
}
