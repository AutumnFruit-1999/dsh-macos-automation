/**
 * 输出收敛的行为测试：截断计数、单行渲染、树的深度/行数上限。
 *
 * 关键不变量在这里锚定：`total` 是截断前的真实条数，`truncated` 与返回条数一致。
 * @module dsh-macos-automation/result.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clip, elementLine, limitItems, ocrLine, treeLines, withTruncationNotice } from './result.ts';
import type { OcrText, UiElement } from './types.ts';

/** 造一个带中心点的元素。 */
function element(overrides: Partial<UiElement> = {}): UiElement {
  return { id: 'B1', role: 'AXButton', title: '后退', frame: { x: 10, y: 52, w: 30, h: 30, cx: 25, cy: 67 }, ...overrides };
}

describe('limitItems', () => {
  test('未超限时不标记截断', () => {
    assert.deepEqual(limitItems([1, 2], 5), { items: [1, 2], total: 2, truncated: false });
  });

  test('超限时只留前 N 条，但 total 报真实总数', () => {
    const limited = limitItems([1, 2, 3, 4], 2);
    assert.deepEqual(limited.items, [1, 2]);
    assert.equal(limited.total, 4);
    assert.equal(limited.truncated, true);
  });
});

describe('clip', () => {
  test('超长以省略号结尾', () => {
    assert.equal(clip('abcdef', 3), 'abc…');
  });

  test('不超长原样返回', () => {
    assert.equal(clip('abc', 3), 'abc');
  });
});

describe('elementLine', () => {
  test('带坐标的元素画出 frame 与中心点', () => {
    assert.match(elementLine(element()), /^B1\s+AXButton\s+后退\s+\(10,52 30×30\) → 25,67$/u);
  });

  test('无坐标时写"无坐标"而不是留空', () => {
    assert.match(elementLine(element({ frame: undefined })), /\(无坐标\)$/u);
  });

  test('多行标题被压成一行', () => {
    assert.ok(!elementLine(element({ title: '第一行\n第二行' })).includes('\n'));
  });
});

describe('ocrLine', () => {
  test('包含文本、坐标与置信度', () => {
    const text: OcrText = { text: '登录', confidence: 0.93, frame: { x: 1, y: 2, w: 40, h: 20, cx: 21, cy: 12 } };
    assert.equal(ocrLine(text), '"登录"  (1,2 40×20) → 21,12  conf 0.93');
  });
});

describe('treeLines', () => {
  test('两层树按缩进输出', () => {
    const lines = treeLines({ role: 'AXWindow', children: [{ role: 'AXButton', title: 'OK' }] });
    assert.deepEqual(lines, ['AXWindow', '  AXButton title="OK"']);
  });

  test('超过深度上限的节点不输出', () => {
    const deep = { role: 'A', children: [{ role: 'B', children: [{ role: 'C' }] }] };
    assert.equal(treeLines(deep, 1).length, 2);
  });

  test('超过行数上限时追加截断提示', () => {
    const wide = { role: 'root', children: Array.from({ length: 10 }, (_, index) => ({ role: `N${index}` })) };
    const lines = treeLines(wide, 6, 3);
    assert.equal(lines.length, 4);
    assert.match(lines.at(-1) ?? '', /截断/u);
  });
});

describe('withTruncationNotice', () => {
  test('未截断时只拼首行与正文', () => {
    assert.equal(withTruncationNotice('head', ['a'], { total: 1, truncated: false }), 'head\na');
  });

  test('截断时追加带真实总数的提示', () => {
    const text = withTruncationNotice('head', ['a'], { total: 9, truncated: true });
    assert.ok(text.includes('共 9 条'));
    assert.ok(text.includes('缩小'));
  });
});
