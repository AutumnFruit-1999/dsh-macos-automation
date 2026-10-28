/**
 * 工具装配环境：把 CLI 适配器与本次生效的配置收成一个只读对象交给每个工具。
 *
 * 只持有依赖，不含逻辑（唯一的 `runCli` 只是把超时与信号一次性填好，省掉十处重复）。
 * 必须始终成立：env 在 `apply` 里创建一次、之后不再变——工具不得读 `process.env` 或全局配置。
 * @module dsh-macos-automation/tools/env
 */
import type { Cli } from '../cli.ts';

/** 每个工具注册时拿到的依赖。 */
export interface ToolEnv {
  /** CLI 适配器（已绑定 binaryPath）。 */
  readonly cli: Cli;
  /** 单次调用超时（ms）。 */
  readonly timeoutMs: number;
  /** 单次返回元素条数上限。 */
  readonly maxElements: number;
}

/**
 * 按本次生效的超时执行一次 CLI。
 * @param env - 工具环境。
 * @param args - 子命令与参数。
 * @param signal - 调用方取消信号。
 * @returns 解析后的 JSON。
 */
export function runCli(env: ToolEnv, args: readonly string[], signal: AbortSignal | undefined): Promise<unknown> {
  return env.cli.run(args, { timeoutMs: env.timeoutMs, signal });
}
