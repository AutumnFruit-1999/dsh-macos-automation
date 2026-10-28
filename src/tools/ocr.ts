/**
 * `macos_ocr`：识别屏幕/窗口里的文字并给出屏幕坐标。
 *
 * 这是 AX 树看不见的地方的唯一出路——Electron 的 Web 浮层、Canvas 渲染的界面、纯图片按钮。
 * 必须始终成立：返回的坐标必须是**屏幕绝对坐标**，调用方才能直接拿它去点击；
 * CLI 在 `--app` + `--region` 组合下已做窗口坐标 → 屏幕坐标的换算，本层不再二次换算。
 * @module dsh-macos-automation/tools/ocr
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
import { formatRegion, normalizeAppName, normalizeLimit } from '../args.ts';
import { MacosToolError } from '../errors.ts';
import { asRecord, compact, parseOcrTexts } from '../parse.ts';
import { limitItems, ocrLine } from '../result.ts';
import type { OcrValue } from '../types.ts';
import { runCli, type ToolEnv } from './env.ts';

/**
 * 注册 `macos_ocr`。
 * @param ctx - 宿主上下文。
 * @param env - CLI 与配置。
 */
export function registerOcrTool(ctx: Context, env: ToolEnv): void {
  ctx.tools.register(defineTool({
    name: 'macos_ocr',
    description:
      'OCR 识别应用窗口或屏幕区域的文字，返回每段文字的屏幕坐标与中心点。' +
      '用于 AX 树里看不到的界面（Electron 浮层/下拉/模态框、图片按钮）。' +
      '拿到坐标后用 macos_click 点它。需要屏幕录制权限与 macOS 14+。',
    parameters: {
      app: { type: 'string', description: '目标应用名；省略=前台应用。配合区域时区域按窗口相对坐标解释' },
      x: { type: 'number', description: '识别区域的左上 X（与 y/w/h 成组使用）' },
      y: { type: 'number', description: '识别区域的左上 Y' },
      width: { type: 'number', description: '识别区域宽度' },
      height: { type: 'number', description: '识别区域高度' },
      query: { type: 'string', description: '按文字内容过滤（包含匹配）' },
      limit: { type: 'number', description: '本次最多返回多少条文字，默认取插件配置 maxElements' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          app: { type: 'string' },
          total: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          texts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', required: true },
                confidence: { type: 'number', required: true },
                frame: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    x: { type: 'number', required: true },
                    y: { type: 'number', required: true },
                    w: { type: 'number', required: true },
                    h: { type: 'number', required: true },
                    cx: { type: 'number', required: true },
                    cy: { type: 'number', required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const head = `${value.app ?? '前台应用'} · OCR ${value.texts.length}/${value.total} 段文字`;
        const lines = value.texts.map((text) => ocrLine(text));
        if (value.truncated) lines.push(`…（已截断：共 ${value.total} 段，只返回前 ${value.texts.length} 段。用 query 或缩小区域。）`);
        return [{ type: 'text', text: `${head}\n${lines.join('\n')}` }];
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const app = normalizeAppName(args.app);
      const limit = normalizeLimit(args.limit, env.maxElements);
      const hasAnyRegionField = [args.x, args.y, args.width, args.height].some((value) => value !== undefined);
      let region: string | undefined;
      if (hasAnyRegionField) {
        if (args.x === undefined || args.y === undefined || args.width === undefined || args.height === undefined) {
          throw new MacosToolError(
            'invalid-argument',
            '区域需要 x/y/width/height 四项齐全',
            '只识别整个窗口就省略全部区域参数；局部识别请给全四值。',
          );
        }
        region = formatRegion({ x: args.x, y: args.y, w: args.width, h: args.height }, '区域');
      }

      const cliArgs = ['ocr'];
      if (app !== undefined) cliArgs.push('--app', app);
      if (region !== undefined) cliArgs.push('--region', region);
      if (args.query !== undefined) cliArgs.push('--query', args.query);

      const raw = asRecord(await runCli(env, cliArgs, exec.signal), 'ocr');
      const limited = limitItems(parseOcrTexts(raw.elements), limit);
      return compact({
        app: typeof raw.app === 'string' ? raw.app : app,
        total: limited.total,
        truncated: limited.truncated,
        texts: [...limited.items],
      }) satisfies OcrValue;
    },
  }));
}
