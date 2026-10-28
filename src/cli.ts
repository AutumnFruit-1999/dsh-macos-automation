/**
 * CLI 适配器：以子进程方式运行 `macos`，负责超时、取消、输出上限与 JSON 解析。
 *
 * 只做进程与协议层的事：不判断业务语义、不拼命令字符串（参数一律数组传递）。
 * 必须始终成立：任何路径（成功、非零退出、超时、取消、启动失败）返回前子进程都已终结，
 * 不留孤儿——CLI 会发 CGEvent，残留进程可能持续占用键盘/鼠标。
 * @module dsh-macos-automation/cli
 */
import { spawn } from 'node:child_process';
import { KILL_GRACE_MS } from './constants.ts';
import { classifyCliFailure, classifySpawnFailure, MacosToolError } from './errors.ts';

/** stdout/stderr 各自的收集上限（字节）：`see --all` 极端可达数 MB，超出即判定异常并终止。 */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** 一次 CLI 调用的控制参数。 */
export interface CliRunOptions {
  /** 超时（ms）：超时后先 SIGTERM，宽限期后 SIGKILL。 */
  readonly timeoutMs: number;
  /** 调用方取消信号：与超时走同一条终止路径，但报 `cancelled`。 */
  readonly signal: AbortSignal | undefined;
}

/** CLI 适配器。 */
export interface Cli {
  /** 实际执行的命令名或绝对路径，用于错误信息。 */
  readonly binaryPath: string;
  /**
   * 运行一次 CLI 子命令。
   * @param args - 子命令与选项数组，如 `['see', '--app', 'Safari']`。
   * @param options - 超时与取消信号。
   * @returns 解析后的 JSON 值；输出为空时返回 `null`。
   * @throws {MacosToolError} 启动失败、非零退出、超时、取消或输出不是合法 JSON。
   */
  run(args: readonly string[], options: CliRunOptions): Promise<unknown>;
}

/** 一次运行的累积输出。 */
interface RunOutput {
  out: string;
  err: string;
  overflow: boolean;
}

/**
 * 造一个 CLI 适配器。
 * @param options - `binaryPath` 为命令名（走 PATH）或绝对路径。
 * @returns 可复用的适配器；每次 `run` 相互独立。
 */
export function createCli(options: { readonly binaryPath: string }): Cli {
  const { binaryPath } = options;

  return {
    binaryPath,
    run(args, runOptions) {
      return runOnce(binaryPath, args, runOptions);
    },
  };
}

/**
 * 执行一次子进程并解析输出。
 * @param binaryPath - 命令名或路径。
 * @param args - 参数数组。
 * @param options - 超时与取消信号。
 * @returns 解析后的 JSON，或 `null`。
 */
function runOnce(binaryPath: string, args: readonly string[], options: CliRunOptions): Promise<unknown> {
  const { timeoutMs, signal } = options;
  if (signal?.aborted === true) {
    return Promise.reject(new MacosToolError('cancelled', '调用在启动前已被取消'));
  }

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const output: RunOutput = { out: '', err: '', overflow: false };

    const child = spawn(binaryPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    /** 终止子进程：先温和后强杀，宽限期结束仍未退出即 SIGKILL。 */
    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      hardKill.unref();
    };

    const onTimeout = (): void => {
      if (settled) return;
      settled = true;
      terminate();
      cleanup();
      reject(
        new MacosToolError(
          'timeout',
          `macos ${args[0] ?? ''} 超过 ${timeoutMs}ms 未返回`,
          '界面可能无响应，或这次操作范围太大（例如 see 不带 app 遍历整棵树）；缩小范围后重试。',
        ),
      );
    };

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      terminate();
      cleanup();
      reject(new MacosToolError('cancelled', '调用已被取消'));
    };

    const timer = setTimeout(onTimeout, timeoutMs);
    timer.unref();

    /** 摘掉本次运行挂上的所有监听与定时器。 */
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (output.overflow) return;
      output.out += chunk;
      if (output.out.length > MAX_OUTPUT_BYTES) {
        output.overflow = true;
        terminate();
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      if (output.err.length <= MAX_OUTPUT_BYTES) output.err += chunk;
    });

    child.on('error', (cause: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(classifySpawnFailure(cause, binaryPath));
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (output.overflow) {
        reject(
          new MacosToolError(
            'command-failed',
            `macos ${args[0] ?? ''} 的输出超过 ${MAX_OUTPUT_BYTES} 字节上限`,
            '缩小范围：给 see 传 app 或较小的 limit，给 ocr 传 region。',
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(classifyCliFailure(output.err, output.out));
        return;
      }
      try {
        resolve(parseOutput(output.out, args));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * 解析 CLI 的 stdout。
 * @param text - stdout 全文。
 * @param args - 原始参数，仅用于错误信息。
 * @returns 解析后的值；空输出返回 `null`。
 * @throws {MacosToolError} 输出不是合法 JSON。
 */
function parseOutput(text: string, args: readonly string[]): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const snippet = trimmed.slice(0, 120).replace(/\s+/gu, ' ');
    throw new MacosToolError(
      'command-failed',
      `macos ${args[0] ?? ''} 的输出不是合法 JSON，开头是：${snippet}`,
      '通常是 CLI 版本不匹配（本插件按上游 0.1 的命令面编写）；确认 binaryPath 指向的 macos 与插件版本相容。',
    );
  }
}
