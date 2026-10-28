/**
 * CLI 适配器的行为测试：用真实子进程（Node 自己当假 CLI）验证四条终止路径。
 *
 * 不用 mock：这里要验的正是"进程真的被拉起/杀掉/超时"，替身会掩盖这一点。
 * @module dsh-macos-automation/cli.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCli } from './cli.ts';
import { MacosToolError } from './errors.ts';

/** 用当前的 Node 可执行文件当假 CLI：`-e` 让它执行任意脚本。 */
const cli = createCli({ binaryPath: process.execPath });

/** 断言抛出指定 code 的 MacosToolError。 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof MacosToolError && error.code === code);
}

describe('createCli', () => {
  test('正常退出 → 解析 stdout 的 JSON', async () => {
    const value = await cli.run(['-e', 'console.log(JSON.stringify({ app: "访达", n: 2 }))'], {
      timeoutMs: 5_000,
      signal: undefined,
    });
    assert.deepEqual(value, { app: '访达', n: 2 });
  });

  test('stdout 为空 → 返回 null（不是空字符串）', async () => {
    const value = await cli.run(['-e', ''], { timeoutMs: 5_000, signal: undefined });
    assert.equal(value, null);
  });

  test('非零退出 + JSON 错误 → 按 stderr 分类', async () => {
    await expectCode(
      cli.run(['-e', 'console.error(JSON.stringify({ error: "应用未找到: Foo" })); process.exit(1)'], {
        timeoutMs: 5_000,
        signal: undefined,
      }),
      'app-not-found',
    );
  });

  test('非零退出 + 纯文本错误 → 剥掉 Error: 前缀后分类', async () => {
    await expectCode(
      cli.run(['-e', 'console.error("Error: 需要辅助功能权限"); process.exit(1)'], { timeoutMs: 5_000, signal: undefined }),
      'permission-denied',
    );
  });

  test('成功退出但输出不是 JSON → command-failed', async () => {
    await expectCode(cli.run(['-e', 'console.log("not json")'], { timeoutMs: 5_000, signal: undefined }), 'command-failed');
  });

  test('超过超时 → timeout，且不会一直挂着', async () => {
    const started = Date.now();
    await expectCode(cli.run(['-e', 'setTimeout(() => {}, 30_000)'], { timeoutMs: 150, signal: undefined }), 'timeout');
    assert.ok(Date.now() - started < 5_000);
  });

  test('取消信号 → cancelled', async () => {
    const controller = new AbortController();
    const promise = cli.run(['-e', 'setTimeout(() => {}, 30_000)'], { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expectCode(promise, 'cancelled');
  });

  test('启动前已取消 → 直接拒绝，不拉起进程', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectCode(cli.run(['-e', 'console.log("{}")'], { timeoutMs: 1_000, signal: controller.signal }), 'cancelled');
  });

  test('可执行文件不存在 → binary-missing', async () => {
    const missing = createCli({ binaryPath: '/nonexistent/dsh-macos-automation/macos' });
    await expectCode(missing.run(['see'], { timeoutMs: 1_000, signal: undefined }), 'binary-missing');
  });
});
