/**
 * 失败分类的行为测试：错误正文提取与 code 映射。
 *
 * 用例全部取自 CLI 真实文案（`Sources/MacOS/**` 里的字面量），改上游文案时这里会先红。
 * @module dsh-macos-automation/errors.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyCliFailure, classifySpawnFailure, extractErrorMessage, MacosToolError } from './errors.ts';

describe('extractErrorMessage', () => {
  test('单行 JSON → 取出 error 字段', () => {
    assert.equal(extractErrorMessage('{"error":"应用未找到: Foo"}'), '应用未找到: Foo');
  });

  test('ArgumentParser 的 "Error: " 前缀被剥掉', () => {
    assert.equal(extractErrorMessage('Error: 需要辅助功能权限'), '需要辅助功能权限');
  });

  test('多行文本 → 只保留首行', () => {
    assert.equal(extractErrorMessage('第一行\n第二行'), '第一行');
  });

  test('空 stderr → 空字符串', () => {
    assert.equal(extractErrorMessage('   \n '), '');
  });
});

describe('classifyCliFailure', () => {
  test('辅助功能权限 → permission-denied，且提示授权对象是发起进程', () => {
    const error = classifyCliFailure('Error: 需要辅助功能权限。请前往：系统设置 > 隐私与安全性 > 辅助功能', '');
    assert.equal(error.code, 'permission-denied');
    assert.ok(error.hint?.includes('发起进程'));
  });

  test('屏幕录制权限同样归为 permission-denied', () => {
    assert.equal(classifyCliFailure('{"error":"需要屏幕录制权限"}', '').code, 'permission-denied');
  });

  test('ScreenCaptureKit 的 TCC 拒绝（实际文案不含"屏幕录制"字样）→ permission-denied', () => {
    // 真实 stderr：Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 "用户拒绝了应用程序、窗口、显示器捕捉的TCC" ...
    const stderr =
      'Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 "用户拒绝了应用程序、窗口、显示器捕捉的TCC" UserInfo={NSLocalizedDescription=用户拒绝了应用程序、窗口、显示器捕捉的TCC}';
    const error = classifyCliFailure(stderr, '');
    assert.equal(error.code, 'permission-denied');
    assert.ok(error.hint?.includes('屏幕录制'));
  });

  test('应用未找到 → app-not-found，提示用 localizedName', () => {
    const error = classifyCliFailure('{"error":"应用未找到: Finder"}', '');
    assert.equal(error.code, 'app-not-found');
    assert.ok(error.hint?.includes('localizedName'));
  });

  test('元素未找到 → element-not-found', () => {
    assert.equal(classifyCliFailure('{"error":"未找到匹配 \'OK\' 的元素"}', '').code, 'element-not-found');
  });

  test('菜单项未找到 → element-not-found', () => {
    assert.equal(classifyCliFailure('{"error":"菜单项未找到: \'保存\'"}', '').code, 'element-not-found');
  });

  test('无效菜单路径 → invalid-argument', () => {
    assert.equal(classifyCliFailure('{"error":"无效菜单路径: \'Save\'"}', '').code, 'invalid-argument');
  });

  test('OCR 版本不足 → unsupported-platform（不是 invalid-argument）', () => {
    assert.equal(classifyCliFailure('{"error":"OCR 需要 macOS 14.0+"}', '').code, 'unsupported-platform');
  });

  test('未知文案 → command-failed 兜底，仍带原文', () => {
    const error = classifyCliFailure('{"error":"某种新错误"}', '');
    assert.equal(error.code, 'command-failed');
    assert.equal(error.message, '某种新错误');
  });

  test('stderr 为空时回退看 stdout', () => {
    assert.equal(classifyCliFailure('', '{"error":"应用未找到: X"}').code, 'app-not-found');
  });

  test('两边都没有输出 → 给出可读兜底文案', () => {
    const error = classifyCliFailure('', '');
    assert.equal(error.code, 'command-failed');
    assert.ok(error.message.includes('没有输出'));
  });
});

describe('classifySpawnFailure', () => {
  test('ENOENT → binary-missing，提示 build:cli 或改 binaryPath', () => {
    const error = classifySpawnFailure(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), 'macos');
    assert.equal(error.code, 'binary-missing');
    assert.ok(error.hint?.includes('binaryPath'));
  });

  test('其它 errno → command-failed', () => {
    const error = classifySpawnFailure(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), '/usr/bin/macos');
    assert.equal(error.code, 'command-failed');
    assert.ok(error instanceof MacosToolError);
  });
});
