/**
 * 本包共享常量：工具名、枚举取值、超时与输出上限。
 *
 * 只放常量，不放规则：所有校验规则住在 args.ts，错误分类住在 errors.ts。
 * 必须始终成立：枚举值必须与 macos CLI 的字面量逐字一致（CLI 解析的是 lowercased 字符串）。
 * @module dsh-macos-automation/constants
 */

/** 工具名统一前缀：避免与宿主内置工具或其它插件重名。 */
export const TOOL_PREFIX = 'macos_';

/** 单个 CLI 调用的默认超时（ms）：点击/输入类命令毫秒级返回，10s 足够覆盖进程冷启动。 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** `see` 的超时（ms）：遍历 AX 树 + 可选窗口截图，50 万元素的极端应用会慢。 */
export const SEE_TIMEOUT_MS = 20_000;

/** `ocr` 的超时（ms）：ScreenCaptureKit 抓帧 + Vision 逐行识别，明显慢于 AX 遍历。 */
export const OCR_TIMEOUT_MS = 30_000;

/** 信号取消后等待进程自行退出的宽限（ms），超时则 SIGKILL。 */
export const KILL_GRACE_MS = 2_000;

/** 单次返回给模型的元素条数上限：`see --all` 能吐 883 条，不截断会撑爆上下文。 */
export const DEFAULT_MAX_ELEMENTS = 150;

/** `type` 的文本长度上限（字符）：CLI 逐字符发 CGEvent，超长会占用键盘焦点数分钟。 */
export const MAX_TEXT_LENGTH = 10_000;

/** render 时最多绘制的条目行数：规范值仍完整，只是正文收敛。 */
export const MAX_RENDER_LINES = 60;

/** 元素标题在 render 中的截断长度（字符）。 */
export const MAX_TITLE_CHARS = 40;

/** AX 树 render 的最大深度（层）：`inspect --max-depth 12` 的文本会非常长。 */
export const MAX_TREE_RENDER_DEPTH = 6;

/** `app --action` 的合法取值（与 AppCommand 的 switch 分支一致）。 */
export const APP_ACTIONS = ['launch', 'quit', 'focus', 'list'] as const;

/** `window --action` 的合法取值（与 WindowCommand 的 switch 分支一致）。 */
export const WINDOW_ACTIONS = ['move', 'resize', 'close', 'minimize', 'maximize', 'focus', 'list'] as const;

/** `menu --action` 的合法取值。 */
export const MENU_ACTIONS = ['list', 'click'] as const;

/** `clipboard --action` 的合法取值。 */
export const CLIPBOARD_ACTIONS = ['get', 'set', 'clear'] as const;

/** `scroll --direction` 的合法取值（CLI 用 ScrollDirection(rawValue:) 解析）。 */
export const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** `hotkey --keys` 支持的修饰键：CLI 逐项转 CGEventFlags。 */
export const MODIFIER_KEYS = ['cmd', 'shift', 'alt', 'option', 'ctrl', 'control', 'fn'] as const;

/**
 * `hotkey --keys` 支持的普通键，逐项对应 CLI 的 `EventEngine.keyCodeMap`。
 *
 * 只收录键表里真实存在的名字——多写一个（如 `enter`/`home`）会让 CLI 抛「未知按键」，
 * 校验就失去意义。`enter` 由 args.ts 归一化成 `return`。
 */
export const NAMED_KEYS = [
  'space',
  'return',
  'tab',
  'escape',
  'delete',
  'backspace',
  'arrow_up',
  'arrow_down',
  'arrow_left',
  'arrow_right',
] as const;

/**
 * 拒绝执行的组合：这些快捷键会改变登录会话，误触的代价远大于少一个能力。
 *
 * `cmd+shift+q` 注销、`cmd+ctrl+q` 锁屏、`cmd+alt+escape` 强制退出面板。
 * 这是本插件相对 CLI 的一处**故意收窄**——CLI 本身不拦。
 */
export const BLOCKED_HOTKEYS: ReadonlySet<string> = new Set(['cmd,shift,q', 'cmd,ctrl,q', 'alt,cmd,escape']);

/**
 * `readOnly: true` 时仅注册的工具：只看不动。
 *
 * 只留这两个纯读命令——`app`/`window`/`clipboard` 同时带写操作（launch/quit/resize/set），
 * 无法靠工具名区分，因此不进只读集合；要写就关掉 readOnly。
 */
export const READ_ONLY_TOOLS = ['macos_see', 'macos_ocr'] as const;
