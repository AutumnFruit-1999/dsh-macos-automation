/**
 * 失败归一化：把 CLI 的 stderr 文本收敛成带稳定 code 与可执行提示的错误。
 *
 * 只做分类，不执行任何 IO，也不决定是否重试（那是调用方的事）。
 * 必须始终成立：分类只依赖 CLI 的错误文本；新增 CLI 错误文案时必须同步 `RULES`，
 * 否则会落到 `command-failed` 兜底——功能仍然可用，只是提示不够准确。
 * @module dsh-macos-automation/errors
 */
import type { MacosErrorCode } from './types.ts';

/** 授权类错误的统一提示：authorize 的对象是**发起进程**，不是本插件包。 */
const AUTHORIZE_HINT =
  '辅助功能权限授予的是「发起进程」：DSH 桌面应用，或启动 `dsh web` 的那个终端/IDE。' +
  '改完授权后需要重启该进程才会生效。';

/** 中文系统下的应用名提示：这是最高频的踩坑点。 */
const APP_NAME_HINT =
  '应用名必须是系统显示的 localizedName（中文系统下是「访达」不是「Finder」、「微信」不是「WeChat」）。' +
  '先调用 macos_app({ action: "list" }) 获取准确名称。';

/**
 * 屏幕录制（TCC）被拒的提示。
 *
 * 和辅助功能是两套独立授权，且 ScreenCaptureKit 的报错文本里**不含**"屏幕录制"字样
 * ——实际形如 `Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801
 * "用户拒绝了应用程序、窗口、显示器捕捉的TCC"`，所以必须按框架名匹配。
 */
const SCREEN_CAPTURE_HINT =
  'ocr 与截图走屏幕捕捉，需要「屏幕录制」权限（与辅助功能是两套独立授权）：' +
  '系统设置 → 隐私与安全性 → 屏幕录制，勾选 DSH 桌面应用或启动 `dsh web` 的终端/IDE，' +
  '然后完全退出并重启该进程。改完仍报错时，先用 macos_see / macos_menu 这类只依赖辅助功能的工具。';

/** 一条分类规则：命中 `match` 即返回对应 code 与提示。 */
interface Rule {
  readonly match: RegExp;
  readonly code: MacosErrorCode;
  readonly hint?: string;
}

/** 规则顺序即优先级：越具体的错误越靠前，兜底在最后。 */
const RULES: readonly Rule[] = [
  { match: /辅助功能权限|Accessibility/i, code: 'permission-denied', hint: AUTHORIZE_HINT },
  {
    match: /屏幕录制权限|Screen Recording|ScreenCaptureKit|SCStreamErrorDomain|屏幕捕捉|SCStream/i,
    code: 'permission-denied',
    hint: SCREEN_CAPTURE_HINT,
  },
  { match: /OCR 需要 macOS 14/, code: 'unsupported-platform', hint: 'OCR 依赖 ScreenCaptureKit，需要 macOS 14 (Sonoma) 及以上。' },
  { match: /应用未找到|应用未运行|Application .* not found/i, code: 'app-not-found', hint: APP_NAME_HINT },
  { match: /无前台应用/, code: 'app-not-found', hint: '没有前台应用可操作；先 macos_app({ action: "focus", app }) 聚焦目标。' },
  { match: /未找到匹配|窗口未找到|菜单项未找到|未找到菜单栏/, code: 'element-not-found', hint: '重新调用 macos_see 取最新元素列表；界面可能已经变化。' },
  { match: /无效菜单路径/, code: 'invalid-argument', hint: "菜单路径格式是 'Menu > Item'，层级用 ' > ' 分隔，名字必须与菜单实际文案（含语言）一致。" },
  { match: /未知按键|未指定主键/, code: 'invalid-argument', hint: '按键名按 CLI 键表：a-z、0-9、space/return/tab/escape/delete/arrow_up…/f1-f12。' },
  { match: /格式错误|需要 --|不能同时使用|无效方向|未知操作|Missing expected argument|Unknown option/i, code: 'invalid-argument' },
  { match: /文件不存在/, code: 'invalid-argument', hint: '剪贴板文件模式要求路径已存在，且需是绝对路径或支持 ~ 展开。' },
];

/** 已归一化的工具失败：`code` 稳定、`message` 是给人看的一句话、`hint` 是下一步动作。 */
export class MacosToolError extends Error {
  readonly code: MacosErrorCode;
  readonly hint: string | undefined;

  /**
   * @param code - 稳定错误码。
   * @param message - 面向模型与人的一句话，写"期望什么、收到什么"。
   * @param hint - 可选的下一步动作。
   * @param options - 透传给 Error（如 cause）。
   */
  constructor(code: MacosErrorCode, message: string, hint?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MacosToolError';
    this.code = code;
    this.hint = hint;
  }
}

/**
 * 从 CLI 的 stderr 提取错误正文。
 *
 * CLI 的正常错误是单行 JSON `{"error": "..."}`；参数解析失败时是 ArgumentParser 的
 * 英文多行文本，带 `Error: ` 前缀。两种都收敛成一句话。
 * @param stderr - 子进程的 stderr 全文。
 * @returns 去掉框架前缀与多余空行的错误正文。
 */
export function extractErrorMessage(stderr: string): string {
  const text = stderr.trim();
  if (text.length === 0) return '';
  const firstLine = text.split('\n', 1)[0] ?? '';
  if (firstLine.trimStart().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        const message = (parsed as { error: unknown }).error;
        if (typeof message === 'string') return message.trim();
      }
    } catch {
      // 不是合法 JSON：落到下面的文本处理
    }
  }
  return text.replace(/^Error:\s*/u, '').split('\n')[0]?.trim() ?? '';
}

/**
 * 把一次失败的 CLI 调用归一化成 {@link MacosToolError}。
 * @param stderr - 子进程 stderr 全文。
 * @param stdout - 子进程 stdout 全文（CLI 偶有把错误打到 stdout 的分支）。
 * @returns 带 code 与 hint 的错误对象，交由 execute 抛出。
 */
export function classifyCliFailure(stderr: string, stdout: string): MacosToolError {
  const message = extractErrorMessage(stderr) || extractErrorMessage(stdout) || 'macos CLI 以非零退出码结束，且没有输出错误信息';
  for (const rule of RULES) {
    if (rule.match.test(message)) {
      return new MacosToolError(rule.code, message, rule.hint);
    }
  }
  return new MacosToolError('command-failed', message);
}

/**
 * 子进程无法启动时的错误：区分"文件不存在"与"不可执行/其它 errno"。
 * @param cause - Node 抛出的原始错误。
 * @param binaryPath - 尝试执行的路径或命令名。
 * @returns 带 `binary-missing` 或 `command-failed` 的错误。
 */
export function classifySpawnFailure(cause: unknown, binaryPath: string): MacosToolError {
  const errno = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : '';
  if (errno === 'ENOENT') {
    return new MacosToolError(
      'binary-missing',
      `找不到 macos 可执行文件：${binaryPath}`,
      '先执行 `npm run build:cli`（需本机已 clone 上游并装上 Swift 6+），或在配置里把 binaryPath 指向已编译好的 macos。',
      { cause },
    );
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new MacosToolError('command-failed', `macos CLI 启动失败：${detail}`, undefined, { cause });
}
