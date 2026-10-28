/**
 * 结果收敛与模型可见文本：截断、补中心点、把规范值画成紧凑的一行一条。
 *
 * 只做纯格式化：不读配置、不碰进程，输入输出都是值。
 * 必须始终成立：规范值里的 `total` 是截断前的真实条数、`truncated` 与实际返回条数一致——
 * 模型靠这两个字段判断"是不是还有没看到的元素"，报错会直接导致它漏点界面。
 * @module dsh-macos-automation/result
 */
import { MAX_RENDER_LINES, MAX_TITLE_CHARS, MAX_TREE_RENDER_DEPTH } from './constants.ts';
import type { OcrText, UiElement } from './types.ts';

/** 截断结果：保留前 `limit` 条，并给出真实总数。 */
export interface Limited<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * 按上限截断列表。
 * @param items - 原始列表。
 * @param limit - 上限条数（正整数）。
 * @returns 截断后的列表与总数信息。
 */
export function limitItems<T>(items: readonly T[], limit: number): Limited<T> {
  if (items.length <= limit) return { items, total: items.length, truncated: false };
  return { items: items.slice(0, limit), total: items.length, truncated: true };
}

/**
 * 截断一段文本用于展示。
 * @param text - 原文。
 * @param max - 最大字符数。
 * @returns 超长时以 `…` 结尾。
 */
export function clip(text: string, max = MAX_TITLE_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** 把字符串压成单行，避免多行文本把一条记录拆成两行。 */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * 画一个元素行：`B1  AXButton  后退  (10,52 30×30) → 25,67`。
 * @param element - 规范化元素。
 * @returns 单行文本。
 */
export function elementLine(element: UiElement): string {
  const label = element.title ?? element.value ?? element.description ?? '';
  const head = `${element.id.padEnd(4)} ${element.role.padEnd(14)} ${clip(oneLine(label))}`.trimEnd();
  if (element.frame === undefined) return `${head}  (无坐标)`;
  const { x, y, w, h, cx, cy } = element.frame;
  return `${head}  (${x},${y} ${w}×${h}) → ${cx},${cy}`;
}

/**
 * 画 OCR 文本行：`"何占争"  (342,812 44×21) → 364,822  conf 0.98`。
 * @param text - 识别结果。
 * @returns 单行文本。
 */
export function ocrLine(text: OcrText): string {
  const { x, y, w, h, cx, cy } = text.frame;
  return `"${clip(oneLine(text.text))}"  (${x},${y} ${w}×${h}) → ${cx},${cy}  conf ${text.confidence.toFixed(2)}`;
}

/**
 * 画 AX 树的缩进文本。
 * @param tree - CLI 的嵌套对象（未知形状，逐层探测）。
 * @param maxDepth - 最大渲染深度。
 * @param maxLines - 最大行数。
 * @returns 行数组；超限时末行为截断提示。
 */
export function treeLines(tree: unknown, maxDepth = MAX_TREE_RENDER_DEPTH, maxLines = MAX_RENDER_LINES): string[] {
  const lines: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (lines.length >= maxLines || depth > maxDepth) return;
    if (typeof node !== 'object' || node === null) return;
    const source = node as Record<string, unknown>;
    const role = typeof source.role === 'string' ? source.role : '?';
    const parts = [role];
    for (const key of ['title', 'value', 'description', 'placeholder', 'subrole', 'domId']) {
      const field = source[key];
      if (typeof field === 'string' && field.length > 0) parts.push(`${key}="${clip(oneLine(field), 24)}"`);
    }
    const frame = source.frame;
    if (typeof frame === 'object' && frame !== null) {
      const values = ['x', 'y', 'w', 'h'].map((key) => {
        const raw = (frame as Record<string, unknown>)[key];
        return typeof raw === 'number' ? String(Math.round(raw)) : '0';
      });
      parts.push(`[${values[0]},${values[1]} ${values[2]}×${values[3]}]`);
    }
    lines.push(`${'  '.repeat(depth)}${parts.join(' ')}`);
    const children = source.children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child, depth + 1);
    }
  };
  walk(tree, 0);
  if (lines.length >= maxLines) lines.push(`…（树已截断到 ${maxLines} 行 / ${maxDepth} 层）`);
  return lines;
}

/**
 * 生成 `see` 的模型可见文本。
 * @param head - 首行摘要。
 * @param lines - 已渲染的条目行。
 * @param limited - 截断信息，用于追加提示。
 * @returns 单块文本内容。
 */
export function withTruncationNotice(head: string, lines: readonly string[], limited: { total: number; truncated: boolean }): string {
  const body = lines.join('\n');
  if (!limited.truncated) return `${head}\n${body}`;
  return `${head}\n${body}\n…（已截断：共 ${limited.total} 条，只返回前 ${lines.length} 条。缩小 app/limit 或改用 query 精确定位。）`;
}
