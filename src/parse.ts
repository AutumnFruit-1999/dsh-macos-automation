/**
 * CLI JSON → 规范值的解析层。
 *
 * 这是跨进程边界，因此`unknown` 一律在此处逐字段收窄；解析后的值向下传，内部不再校验。
 * 必须始终成立：字段缺失一律降级为省略（`undefined`）而不是抛错——GUI 元素本来就可能没有
 * title/frame，为了一个可选字段失败整次调用不划算；只有结构不对（不是对象/不是数组）才抛。
 * @module dsh-macos-automation/parse
 */
import { MacosToolError } from './errors.ts';
import type { ElementFrame, OcrText, RunningApp, UiElement, WindowInfo } from './types.ts';

/**
 * 丢掉值为 `undefined` 的键。
 *
 * 规范值要过 lossless JSON 校验，`{ title: undefined }` 这种键必须不存在，而不是值为 undefined。
 * @param source - 原始对象。
 * @returns 去掉空值键的新对象。
 */
export function compact<T extends Record<string, unknown>>(source: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}

/**
 * 把未知值断言为对象。
 * @param value - 待检查值。
 * @param label - 出错时的定位信息。
 * @returns 键值对象（可能为空）。
 * @throws {MacosToolError} 不是非数组对象。
 */
export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MacosToolError('command-failed', `${label} 期望对象，收到 ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

/**
 * 把未知值断言为数组。
 * @param value - 待检查值。
 * @param label - 出错时的定位信息。
 * @returns 数组。
 * @throws {MacosToolError} 不是数组。
 */
export function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MacosToolError('command-failed', `${label} 期望数组，收到 ${describe(value)}`);
  }
  return value;
}

/**
 * 读一个可选字符串字段。
 * @param source - 源对象。
 * @param key - 字段名。
 * @returns 字符串，缺失或类型不符时 undefined。
 */
export function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 读一个可选数字字段。
 * @param source - 源对象。
 * @param key - 字段名。
 * @returns 有限数字，缺失或类型不符时 undefined。
 */
export function optionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 读一个必需数字字段。
 * @param source - 源对象。
 * @param key - 字段名。
 * @param label - 出错时的定位信息。
 * @returns 有限数字。
 * @throws {MacosToolError} 缺失或不是有限数字。
 */
export function requiredNumber(source: Record<string, unknown>, key: string, label: string): number {
  const value = optionalNumber(source, key);
  if (value === undefined) {
    throw new MacosToolError('command-failed', `${label}.${key} 缺失或不是数字`);
  }
  return value;
}

/**
 * 解析 `{x,y,w,h}` 并补上中心点。
 * @param value - 未知值。
 * @returns 带 cx/cy 的矩形；值不可用时 undefined。
 */
export function parseFrame(value: unknown): ElementFrame | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const frame = value as Record<string, unknown>;
  const x = optionalNumber(frame, 'x');
  const y = optionalNumber(frame, 'y');
  const w = optionalNumber(frame, 'w');
  const h = optionalNumber(frame, 'h');
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) };
}

/**
 * 解析 `see` 的元素数组。
 * @param value - CLI 的 `elements` 字段。
 * @returns 规范化的元素数组，保持 CLI 原始顺序。
 */
export function parseElements(value: unknown): UiElement[] {
  const raw = asArray(value, 'see.elements');
  const elements: UiElement[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const source = item as Record<string, unknown>;
    const id = optionalString(source, 'id');
    const role = optionalString(source, 'role');
    if (id === undefined || role === undefined) continue;
    const actions = Array.isArray(source.actions)
      ? source.actions.filter((action): action is string => typeof action === 'string')
      : undefined;
    elements.push(
      compact({
        id,
        role,
        title: optionalString(source, 'title'),
        value: optionalString(source, 'value'),
        frame: parseFrame(source.frame),
        actions,
        description: optionalString(source, 'description'),
      }),
    );
  }
  return elements;
}

/**
 * 解析 `ocr` 的文字区域。
 * @param value - CLI 的 `elements` 字段。
 * @returns 规范化数组；没有 frame 的条目被丢弃（无法用于点击）。
 */
export function parseOcrTexts(value: unknown): OcrText[] {
  const raw = asArray(value, 'ocr.elements');
  const texts: OcrText[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const source = item as Record<string, unknown>;
    const text = optionalString(source, 'text');
    const frame = parseFrame(source.frame);
    if (text === undefined || frame === undefined) continue;
    texts.push({ text, confidence: optionalNumber(source, 'confidence') ?? 0, frame });
  }
  return texts;
}

/**
 * 解析 `app --action list` 的数组。
 * @param value - CLI 输出。
 * @returns 运行中的应用列表。
 */
export function parseAppList(value: unknown): RunningApp[] {
  const raw = asArray(value, 'app.list');
  const apps: RunningApp[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const source = item as Record<string, unknown>;
    const name = optionalString(source, 'name');
    const pid = optionalNumber(source, 'pid');
    if (name === undefined || pid === undefined) continue;
    apps.push({ name, pid, active: source.active === true });
  }
  return apps;
}

/**
 * 解析 `window --action list` 的数组。
 * @param value - CLI 输出。
 * @returns 窗口列表。
 */
export function parseWindowList(value: unknown): WindowInfo[] {
  const raw = asArray(value, 'window.list');
  const windows: WindowInfo[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const source = item as Record<string, unknown>;
    const title = typeof source.title === 'string' ? source.title : '';
    const app = optionalString(source, 'app') ?? '';
    windows.push({ index: optionalNumber(source, 'index') ?? windows.length, title, app });
  }
  return windows;
}

/**
 * 描述一个未知值的类型，用于错误信息。
 * @param value - 任意值。
 * @returns 简短的形态描述。
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
