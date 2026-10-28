/**
 * 解析层的行为测试：CLI JSON → 规范值。
 *
 * 用例直接抄自真实 CLI 输出（`macos app --action list`、`see` 的 elements 形状），
 * 重点验三件事：中心点算对、可选字段缺失不炸、脏数据被丢弃而不是抛错。
 * @module dsh-macos-automation/parse.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MacosToolError } from './errors.ts';
import { asArray, asRecord, compact, optionalString, parseAppList, parseElements, parseFrame, parseOcrTexts, parseWindowList, requiredNumber } from './parse.ts';

describe('asRecord / asArray', () => {
  test('非对象 → command-failed', () => {
    assert.throws(() => asRecord([], 'x'), (error: unknown) => error instanceof MacosToolError && error.code === 'command-failed');
  });

  test('非数组 → command-failed', () => {
    assert.throws(() => asArray({}, 'x'), (error: unknown) => error instanceof MacosToolError && error.code === 'command-failed');
  });
});

describe('compact', () => {
  test('丢弃值为 undefined 的键（规范值不能带 undefined）', () => {
    assert.deepEqual(compact({ a: 1, b: undefined }), { a: 1 });
  });
});

describe('optionalString / requiredNumber', () => {
  test('空字符串视为缺失', () => {
    assert.equal(optionalString({ title: '' }, 'title'), undefined);
  });

  test('缺字段的必填数字 → command-failed', () => {
    assert.throws(() => requiredNumber({}, 'pid', 'app'), (error: unknown) => error instanceof MacosToolError);
  });
});

describe('parseFrame', () => {
  test('补上中心点（四舍五入）', () => {
    assert.deepEqual(parseFrame({ x: 10, y: 52, w: 31, h: 31 }), { x: 10, y: 52, w: 31, h: 31, cx: 26, cy: 68 });
  });

  test('缺一个字段 → undefined（不抛错）', () => {
    assert.equal(parseFrame({ x: 1, y: 2, w: 3 }), undefined);
  });
});

describe('parseElements', () => {
  test('正常元素被保留并带中心点', () => {
    const elements = parseElements([
      { id: 'B1', role: 'AXButton', title: '后退', frame: { x: 10, y: 52, w: 30, h: 30 } },
    ]);
    assert.equal(elements.length, 1);
    assert.deepEqual(elements[0]?.frame, { x: 10, y: 52, w: 30, h: 30, cx: 25, cy: 67 });
  });

  test('缺 id 或 role 的条目被丢弃，其余照常返回', () => {
    const elements = parseElements([
      { role: 'AXButton' },
      { id: 'T1', role: 'AXTextField' },
    ]);
    assert.deepEqual(
      elements.map((element) => element.id),
      ['T1'],
    );
  });

  test('actions 不是数组时省略该字段', () => {
    const elements = parseElements([{ id: 'B1', role: 'AXButton', actions: 'press' }]);
    assert.equal(elements[0]?.actions, undefined);
  });

  test('顶层不是数组 → command-failed', () => {
    assert.throws(() => parseElements({}), (error: unknown) => error instanceof MacosToolError);
  });
});

describe('parseOcrTexts', () => {
  test('保留文本、置信度与坐标', () => {
    const texts = parseOcrTexts([{ text: '何占争', confidence: 0.98, frame: { x: 342, y: 812, w: 44, h: 21 } }]);
    assert.equal(texts.length, 1);
    assert.equal(texts[0]?.text, '何占争');
    assert.equal(texts[0]?.frame.cx, 364);
  });

  test('没有 frame 的条目被丢弃（无法点击）', () => {
    assert.equal(parseOcrTexts([{ text: 'x', confidence: 1 }]).length, 0);
  });
});

describe('parseAppList', () => {
  test('保留 name/pid/active', () => {
    const apps = parseAppList([
      { name: '微信', pid: 7835, active: false },
      { name: '访达', pid: 2686, active: true },
    ]);
    assert.deepEqual(apps, [
      { name: '微信', pid: 7835, active: false },
      { name: '访达', pid: 2686, active: true },
    ]);
  });
});

describe('parseWindowList', () => {
  test('缺 title 时用空字符串，不缺条目', () => {
    const windows = parseWindowList([{ index: 0, app: '访达' }]);
    assert.deepEqual(windows, [{ index: 0, title: '', app: '访达' }]);
  });
});
