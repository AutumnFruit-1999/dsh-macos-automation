/**
 * 参数归一化与校验：把模型给的结构化参数变成 CLI 能吃的字符串。
 *
 * 只做纯计算，不碰进程与文件系统；失败一律抛 `invalid-argument`，让模型看到"哪一项不对"。
 * 必须始终成立：这里放行的每一组参数都必须能被 CLI 接受——键名白名单与坐标格式都是
 * 按 `Sources/MacOS/Core/EventEngine.swift` 与 `*Command.swift` 的实际解析逐条对齐的。
 * @module dsh-macos-automation/args
 */
import { BLOCKED_HOTKEYS, MAX_TEXT_LENGTH, MODIFIER_KEYS, NAMED_KEYS } from './constants.ts';
import { MacosToolError } from './errors.ts';

/** 屏幕坐标点（px，屏幕绝对坐标）。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 屏幕矩形（px）。 */
export interface Region extends Point {
  readonly w: number;
  readonly h: number;
}

/** 修饰键集合（含 CLI 接受的别名）。 */
const MODIFIERS: ReadonlySet<string> = new Set(MODIFIER_KEYS);
/** 命名键集合。 */
const NAMED: ReadonlySet<string> = new Set(NAMED_KEYS);
/** 单字符键：a–z 与 0–9（键表只收录这些）。 */
const SINGLE_KEY = /^[a-z0-9]$/u;
/** 功能键 f1–f12。 */
const FUNCTION_KEY = /^f([1-9]|1[0-2])$/u;

/** 模型最容易写错的别名 → CLI 接受的名字。 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  enter: 'return',
  esc: 'escape',
  command: 'cmd',
  option: 'alt',
  control: 'ctrl',
  del: 'delete',
  up: 'arrow_up',
  down: 'arrow_down',
  left: 'arrow_left',
  right: 'arrow_right',
};

/**
 * 校验并格式化坐标点。
 * @param point - 模型给的坐标；两张参数都省略时返回 undefined。
 * @param label - 出错时用于定位的参数名。
 * @returns CLI 需要的 `"x,y"` 字符串。
 * @throws {MacosToolError} 坐标不是有限数。
 */
export function formatPoint(point: Point | undefined, label: string): string | undefined {
  if (point === undefined) return undefined;
  const { x, y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new MacosToolError('invalid-argument', `${label} 必须是有限数字坐标，收到 x=${String(x)} y=${String(y)}`);
  }
  return `${Math.round(x)},${Math.round(y)}`;
}

/**
 * 校验并格式化矩形区域。
 * @param region - 模型给的区域。
 * @param label - 出错时用于定位的参数名。
 * @returns CLI 需要的 `"x,y,w,h"` 字符串。
 * @throws {MacosToolError} 宽高不为正或坐标不是有限数。
 */
export function formatRegion(region: Region | undefined, label: string): string | undefined {
  if (region === undefined) return undefined;
  const { x, y, w, h } = region;
  if (![x, y, w, h].every((value) => Number.isFinite(value))) {
    throw new MacosToolError('invalid-argument', `${label} 的 x/y/w/h 必须都是有限数字`);
  }
  if (w <= 0 || h <= 0) {
    throw new MacosToolError('invalid-argument', `${label} 的宽高必须为正，收到 w=${w} h=${h}`);
  }
  return `${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`;
}

/**
 * 校验并归一化快捷键组合。
 *
 * 别名先归一化（`enter` → `return`、`command` → `cmd`），再逐项查白名单；
 * 输出按「修饰键排序 + 主键」规范化，便于和 {@link BLOCKED_HOTKEYS} 做集合比对。
 * @param keys - 逗号分隔的组合，如 `cmd,shift,t`。
 * @returns 归一化后的组合字符串。
 * @throws {MacosToolError} 含未知按键、只有修饰键，或命中禁止列表。
 */
export function normalizeHotkey(keys: string): string {
  const parts = keys
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new MacosToolError('invalid-argument', 'keys 不能为空，格式如 "cmd,c"');
  }
  const modifiers = new Set<string>();
  const mainKeys: string[] = [];
  for (const part of parts) {
    const name = KEY_ALIASES[part] ?? part;
    if (MODIFIERS.has(name)) {
      modifiers.add(name);
      continue;
    }
    if (!NAMED.has(name) && !SINGLE_KEY.test(name) && !FUNCTION_KEY.test(name)) {
      throw new MacosToolError(
        'invalid-argument',
        `未知按键 "${part}"`,
        '支持的修饰键：cmd/shift/alt/ctrl/fn；普通键：a-z、0-9、space/return/tab/escape/delete/arrow_up…/f1-f12。',
      );
    }
    mainKeys.push(name);
  }
  if (mainKeys.length === 0) {
    throw new MacosToolError('invalid-argument', `组合 "${keys}" 里只有修饰键，没有主键`, '正确示例："cmd,c"、"cmd,shift,t"。');
  }
  const normalized = [...modifiers].sort().concat(mainKeys).join(',');
  if (BLOCKED_HOTKEYS.has(normalized)) {
    throw new MacosToolError(
      'invalid-argument',
      `拒绝执行 ${normalized}：该组合会注销/锁定当前登录会话或弹出强制退出`,
      '这是本插件的安全限制，不是 CLI 报错。换一个不会影响会话的组合。',
    );
  }
  return normalized;
}

/**
 * 校验输入文本。
 * @param text - 待输入文本。
 * @returns 原文本。
 * @throws {MacosToolError} 为空、超长或含 NUL。
 */
export function assertTypeText(text: string): string {
  if (text.length === 0) {
    throw new MacosToolError('invalid-argument', 'text 不能为空字符串');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new MacosToolError(
      'invalid-argument',
      `text 长度 ${text.length} 超过上限 ${MAX_TEXT_LENGTH}`,
      'CLI 逐字符发送键盘事件，超长文本会长时间占用键盘输入；请分段输入或改用剪贴板粘贴。',
    );
  }
  if (text.includes('\u0000')) {
    throw new MacosToolError('invalid-argument', 'text 含 NUL 字符，CLI 无法输入');
  }
  return text;
}

/**
 * 校验应用名：必须是用户可见的 localizedName。
 * @param app - 应用名，允许省略（省略即前台应用）。
 * @returns 去掉首尾空白的应用名。
 * @throws {MacosToolError} 传了空白字符串。
 */
export function normalizeAppName(app: string | undefined): string | undefined {
  if (app === undefined) return undefined;
  const trimmed = app.trim();
  if (trimmed.length === 0) {
    throw new MacosToolError('invalid-argument', 'app 不能是空白字符串', '省略 app 表示操作前台应用。');
  }
  return trimmed;
}

/**
 * 校验滚动行数。
 * @param amount - 行数，缺省 3（与 CLI 默认值一致）。
 * @returns 合法的行数。
 * @throws {MacosToolError} 不是正整数或超过 100。
 */
export function normalizeScrollAmount(amount: number | undefined): number {
  if (amount === undefined) return 3;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100) {
    throw new MacosToolError('invalid-argument', `amount 必须是 1–100 的整数，收到 ${amount}`);
  }
  return amount;
}

/**
 * 校验结果条数上限：把配置值与调用方请求合并成一个可用值。
 * @param requested - 本次调用请求的条数。
 * @param max - 配置里的硬上限。
 * @returns 两者较小者，至少为 1。
 * @throws {MacosToolError} 请求值不是正整数。
 */
export function normalizeLimit(requested: number | undefined, max: number): number {
  if (requested === undefined) return max;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new MacosToolError('invalid-argument', `limit 必须是正整数，收到 ${requested}`);
  }
  return Math.min(requested, max);
}
