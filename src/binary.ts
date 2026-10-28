/**
 * 定位 `macos` 可执行文件。
 *
 * 存在的理由：DSH 桌面端由 launchd 启动，`PATH` 只有系统默认的几个目录，
 * 用户装的 `macos` 通常落在 `~/.local/bin` 或 Homebrew 前缀下，裸命令名找不到。
 * 这里在配置值只是裸命令名时，额外探测常见安装目录，命中就返回绝对路径。
 *
 * 找不到不抛错：原样返回，让第一次调用的 `binary-missing` 分支带上可读提示，
 * 比在 apply 阶段静默不注册工具更容易排查。
 * @module dsh-macos-automation/binary
 */
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 裸命令名时额外探测的目录（按优先级）。 */
export const FALLBACK_DIRS: string[] = [
  join(homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), 'bin'),
];

/** @param path - 待检查的文件路径。 @returns 是否是可执行文件。 */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 解析选项；测试用注入替代真实环境。 */
export interface ResolveOptions {
  /** 冒号分隔的 PATH，默认取 `process.env.PATH`。 */
  path?: string;
  /** 裸命令名的兜底目录，默认 {@link FALLBACK_DIRS}。 */
  fallbackDirs?: string[];
}

/**
 * 把配置里的 `binaryPath` 解析成可 `spawn` 的路径。
 *
 * 已含 `/` 的值视为显式路径，原样返回（用户写错就让他看到 spawn 的真实报错）；
 * 裸命令名先查 `PATH`，再查兜底目录；都没找到返回原值。
 * @param configured - 配置里的命令名或路径。
 * @param options - 解析选项。
 * @returns 命中时是绝对路径，否则是原始值。
 */
export function resolveBinaryPath(configured: string, options: ResolveOptions = {}): string {
  if (configured.includes('/')) return configured;

  const fromPath = (options.path ?? process.env.PATH ?? '').split(':').filter(Boolean);
  const dirs = [...fromPath, ...(options.fallbackDirs ?? FALLBACK_DIRS)];

  for (const dir of dirs) {
    const candidate = join(dir, configured);
    if (isExecutable(candidate)) return candidate;
  }
  return configured;
}
