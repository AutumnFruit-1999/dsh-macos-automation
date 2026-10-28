/**
 * 本包类型唯一归属地：CLI 输出的规范值形状与错误码。
 *
 * 规范值必须是 lossless JSON（`output.schema` 会逐字段校验并冻结），因此这里全部是
 * plain object / interface，不含函数、Date、class 实例。数组用可变形态：schema 推导出的就是
 * `T[]`，写成 `readonly T[]` 会让每个 execute 的返回都要多一次强转，收益为零。
 * 与 CLI 的对应关系写在每个接口的字段注释里，改 CLI 时按字段名反查。
 * @module dsh-macos-automation/types
 */

/** 失败分类：模型据此决定重试还是换策略，值一旦发布即不可改。 */
export type MacosErrorCode =
  /** 缺少辅助功能权限（或屏幕录制权限），用户必须去系统设置手动授权。 */
  | 'permission-denied'
  /** 应用名不存在或未运行；中文系统下必须是 localizedName（"访达" 而非 "Finder"）。 */
  | 'app-not-found'
  /** 按文本或标题找不到目标元素/窗口。 */
  | 'element-not-found'
  /** 参数在 CLI 侧被判非法（坐标格式、缺必填、未知 action）。 */
  | 'invalid-argument'
  /** 找不到 macos 可执行文件。 */
  | 'binary-missing'
  /** 超过 timeoutMs 被终止。 */
  | 'timeout'
  /** 调用方取消（exec.signal 触发），子进程已被终止。 */
  | 'cancelled'
  /** CLI 以非零退出码结束且错误文本无法归类。 */
  | 'command-failed'
  /** 非 macOS 平台。 */
  | 'unsupported-platform'
  /** readOnly 模式下尝试调用写工具（理论上不可达，工具未注册）。 */
  | 'read-only-denied';

/** 一个可点击的矩形区域，坐标是屏幕绝对坐标（AX 的全局坐标系，原点在主屏左上）。 */
export interface ElementFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 中心点 X：直接喂给 `macos_click` 的 x，省掉模型自己算加法。 */
  readonly cx: number;
  /** 中心点 Y。 */
  readonly cy: number;
}

/** `see` 的一个元素（对应 CLI 的 UIElement，已合并 frame 与中心点）。 */
export interface UiElement {
  /** 本次结果内的短 id（B1/T1…），仅在这一次调用内有效，不要跨调用引用。 */
  readonly id: string;
  readonly role: string;
  readonly title?: string;
  readonly value?: string;
  readonly frame?: ElementFrame;
  actions?: string[];
  readonly description?: string;
}

/** `see` 的规范值。 */
export interface SeeValue {
  readonly app: string;
  /** flat = 可交互元素扁平列表；tree = 原始 AX 树。 */
  readonly view: 'flat' | 'tree';
  /** 元素总数（截断前）。 */
  readonly total: number;
  /** 是否因 maxElements 被截断。 */
  readonly truncated: boolean;
  elements: UiElement[];
  /** `view: tree` 时的原始树（CLI 的嵌套对象，形状随应用而异，不在此建模）。 */
  readonly tree?: unknown;
  /** `--screenshot` 落盘路径。 */
  readonly screenshot?: string;
}

/** `ocr` 识别出的一段文字。 */
export interface OcrText {
  readonly text: string;
  /** Vision 的识别置信度，0–1。 */
  readonly confidence: number;
  readonly frame: ElementFrame;
}

/** `ocr` 的规范值。 */
export interface OcrValue {
  readonly app?: string;
  readonly total: number;
  readonly truncated: boolean;
  texts: OcrText[];
}

/** `click` 的规范值。 */
export interface ClickValue {
  readonly clicked: boolean;
  readonly x: number;
  readonly y: number;
  readonly button: 'left' | 'right';
  readonly clickCount: number;
}

/** `type` 的规范值。 */
export interface TypeValue {
  readonly typed: string;
  readonly cleared: boolean;
  readonly pressedReturn: boolean;
}

/** `hotkey` 的规范值。 */
export interface HotkeyValue {
  /** 归一化后的按键组合，如 `cmd,shift,t`。 */
  readonly pressed: string;
}

/** `scroll` 的规范值。 */
export interface ScrollValue {
  readonly direction: string;
  readonly amount: number;
}

/** 运行中的一个常规应用（`app --action list`）。 */
export interface RunningApp {
  readonly name: string;
  readonly pid: number;
  readonly active: boolean;
}

/** `app` 的规范值：list 给 apps，其余给 app/pid。 */
export interface AppValue {
  readonly action: string;
  readonly app?: string;
  readonly pid?: number;
  apps?: RunningApp[];
}

/** 一个窗口（`window --action list`）。 */
export interface WindowInfo {
  readonly index: number;
  readonly title: string;
  readonly app: string;
}

/** `window` 的规范值。 */
export interface WindowValue {
  readonly action: string;
  readonly app?: string;
  readonly success?: boolean;
  windows?: WindowInfo[];
}

/** `menu` 的规范值：list 给 items（CLI 的嵌套菜单结构），click 给 success。 */
export interface MenuValue {
  readonly action: string;
  readonly path?: string;
  readonly success?: boolean;
  readonly items?: unknown;
}

/** `clipboard` 的规范值：type 为 `file` 时 content 是路径、size 是字节数。 */
export interface ClipboardValue {
  readonly action: string;
  readonly type?: 'text' | 'file';
  readonly content?: string;
  readonly path?: string;
  readonly size?: number;
}
