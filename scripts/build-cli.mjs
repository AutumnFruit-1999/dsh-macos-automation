#!/usr/bin/env node
/**
 * 从上游源码编译 macos CLI 到本包 bin/。
 *
 * 不下载、不内联上游代码：上游仓库未声明许可证，因此本包只在用户自己的磁盘上、
 * 用用户 clone 下来的源码编译，产物也只落在本机（不进 npm 包）。
 * @module dsh-macos-automation/scripts/build-cli
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

/** 取 `--flag value` 形式的参数。 */
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const sourceDir = resolve(flag('source', join(ROOT, '..', 'MacOS-Skills')));
const outFile = resolve(flag('out', join(ROOT, 'bin', 'macos')));

if (!existsSync(join(sourceDir, 'Package.swift'))) {
  console.error(`[build-cli] 在 ${sourceDir} 找不到 Package.swift。`);
  console.error('[build-cli] 请先自行 clone 上游，再指定目录：');
  console.error('  git clone https://github.com/AutumnFruit-1999/MacOS-Skills.git');
  console.error('  npm run build:cli -- --source ./MacOS-Skills');
  process.exit(1);
}

const swift = spawnSync('swift', ['--version'], { stdio: 'ignore' });
if (swift.error !== undefined || swift.status !== 0) {
  console.error('[build-cli] 找不到 swift。请先安装 Xcode 16+ 或 Command Line Tools：');
  console.error('  xcode-select --install');
  process.exit(1);
}

console.log(`[build-cli] 编译中：${sourceDir}`);
const build = spawnSync('swift', ['build', '-c', 'release'], { cwd: sourceDir, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('[build-cli] swift build 失败，见上方输出。');
  process.exit(build.status ?? 1);
}

const built = join(sourceDir, '.build', 'release', 'macos');
if (!existsSync(built)) {
  console.error(`[build-cli] 编译完成但找不到产物：${built}`);
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
copyFileSync(built, outFile);
chmodSync(outFile, 0o755);
console.log(`[build-cli] ✓ ${outFile}`);
console.log('[build-cli] 下一步：把 binaryPath 指到它，或在 DSH 里授权辅助功能权限。');
console.log(`[build-cli]   配置示例：{ "binaryPath": "${outFile}" }`);
