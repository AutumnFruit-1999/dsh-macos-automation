/**
 * 插件入口：把 macOS 桌面控制能力注册成一组模型可调用的工具。
 *
 * 只做装配——判断平台、构建 CLI 适配器、交给 tools 聚合注册；不含业务规则（校验在 args.ts，
 * 错误分类在 errors.ts，输出收敛在 result.ts）。
 * 依赖 `tools` 服务；非 macOS 平台只记一条日志并不注册工具，避免模型拿到永远失败的工具面。
 * 必须始终成立：`Config` 是配置的唯一真源，`apply` 内不再兜底任何默认值。
 * @module dsh-macos-automation
 */
import type { Context } from '@deepseek-ai/cordis';
import { resolveBinaryPath } from './binary.ts';
import { createCli } from './cli.ts';
import { Config } from './config.ts';
import type { ResolvedConfig } from './config.ts';
import { registerTools } from './tools/index.ts';

/** Cordis 插件名（kebab-case）。 */
export const name = 'tool-macos';

/** 需要的宿主服务：工具注册表。 */
export const inject = ['tools'];

/**
 * 注册全部工具。
 * @param ctx - 挂载上下文。
 * @param config - 已按 schema 填好默认值的配置。
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  const log = ctx.logger(name);

  if (process.platform !== 'darwin') {
    log.warn('仅在 macOS 可用，当前平台 %s，不注册任何工具', process.platform);
    return;
  }

  const binaryPath = resolveBinaryPath(config.binaryPath);
  const cli = createCli({ binaryPath });
  const registered = registerTools(
    ctx,
    { cli, timeoutMs: config.timeoutMs, maxElements: config.maxElements },
    { readOnly: config.readOnly },
  );

  log.info(
    '已注册 %d 个工具（binary=%s, timeout=%dms, maxElements=%d%s）',
    registered.length,
    binaryPath,
    config.timeoutMs,
    config.maxElements,
    config.readOnly ? ', 只读模式' : '',
  );
}

export { Config };
