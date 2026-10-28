/**
 * `resolveBinaryPath` 的测试：覆盖显式路径、PATH 命中、兜底目录命中、全未命中四种走向。
 *
 * 全程用临时目录造可执行文件，不依赖本机是否真的装了 `macos`。
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { resolveBinaryPath } from './binary.ts';

/** 造一个临时目录，里面放一个可执行假文件。 */
function makeDirWithBinary(binaryName: string, executable = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-macos-bin-'));
  const file = join(dir, binaryName);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, executable ? 0o755 : 0o644);
  return dir;
}

const created: string[] = [];

/** 登记待清理目录。 @param dir - 临时目录。 @returns 同一路径。 */
function track(dir: string): string {
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe('resolveBinaryPath', () => {
  it('含 / 的值视为显式路径，原样返回', () => {
    assert.equal(resolveBinaryPath('/Users/x/.local/bin/macos', { fallbackDirs: [] }), '/Users/x/.local/bin/macos');
  });

  it('裸命令名在 PATH 里命中时返回绝对路径', () => {
    const dir = track(makeDirWithBinary('macos'));
    assert.equal(resolveBinaryPath('macos', { path: `/nonexistent:${dir}`, fallbackDirs: [] }), join(dir, 'macos'));
  });

  it('PATH 未命中时继续探测兜底目录', () => {
    const dir = track(makeDirWithBinary('macos'));
    assert.equal(resolveBinaryPath('macos', { path: '/nonexistent', fallbackDirs: [dir] }), join(dir, 'macos'));
  });

  it('PATH 未命中且兜底目录也没有时，返回原始命令名', () => {
    assert.equal(resolveBinaryPath('macos', { path: '/nonexistent', fallbackDirs: ['/nope'] }), 'macos');
  });

  it('跳过在 PATH 里但没有执行权限的同名文件', () => {
    const noExec = track(makeDirWithBinary('macos', false));
    const good = track(makeDirWithBinary('macos'));
    assert.equal(resolveBinaryPath('macos', { path: `${noExec}:${good}`, fallbackDirs: [] }), join(good, 'macos'));
  });

  it('空的 PATH 段被忽略，不会退化成当前目录', () => {
    const dir = track(makeDirWithBinary('macos'));
    assert.equal(resolveBinaryPath('macos', { path: `::${dir}`, fallbackDirs: [] }), join(dir, 'macos'));
  });
});
