/**
 * 参数归一化的行为测试：坐标/区域格式化、快捷键白名单与禁止列表、文本上限。
 *
 * 每个用例只验一个行为，全部走公开函数（不测内部实现）。
 * @module dsh-macos-automation/args.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertTypeText,
  formatPoint,
  formatRegion,
  normalizeAppName,
  normalizeHotkey,
  normalizeLimit,
  normalizeScrollAmount,
} from './args.ts';
import { MacosToolError } from './errors.ts';

/** 断言某次调用抛出指定 code 的 MacosToolError。 */
function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof MacosToolError && error.code === code);
}

describe('formatPoint', () => {
  test('缺省坐标 → 返回 undefined，不生成 "--coords"', () => {
    assert.equal(formatPoint(undefined, '坐标'), undefined);
  });

  test('小数坐标 → 四舍五入成整数字符串', () => {
    assert.equal(formatPoint({ x: 10.4, y: 52.6 }, '坐标'), '10,53');
  });

  test('NaN 坐标 → invalid-argument', () => {
    expectCode(() => formatPoint({ x: Number.NaN, y: 1 }, '坐标'), 'invalid-argument');
  });
});

describe('formatRegion', () => {
  test('四值齐全 → "x,y,w,h"', () => {
    assert.equal(formatRegion({ x: 600, y: 80, w: 400, h: 300 }, '区域'), '600,80,400,300');
  });

  test('宽为 0 → invalid-argument', () => {
    expectCode(() => formatRegion({ x: 0, y: 0, w: 0, h: 10 }, '区域'), 'invalid-argument');
  });
});

describe('normalizeHotkey', () => {
  test('别名归一化：command → cmd、enter → return', () => {
    assert.equal(normalizeHotkey('command,enter'), 'cmd,return');
  });

  test('修饰键排序后输出，便于与禁止列表比对', () => {
    assert.equal(normalizeHotkey('shift,cmd,t'), 'cmd,shift,t');
  });

  test('未知按键 → invalid-argument', () => {
    expectCode(() => normalizeHotkey('cmd,hyper'), 'invalid-argument');
  });

  test('只有修饰键 → invalid-argument', () => {
    expectCode(() => normalizeHotkey('cmd,shift'), 'invalid-argument');
  });

  test('注销组合 cmd+shift+q 被拒绝（安全收窄）', () => {
    expectCode(() => normalizeHotkey('shift,cmd,q'), 'invalid-argument');
  });

  test('锁屏组合 cmd+ctrl+q 被拒绝', () => {
    expectCode(() => normalizeHotkey('cmd,ctrl,q'), 'invalid-argument');
  });

  test('功能键 f1–f12 放行，f13 拒绝', () => {
    assert.equal(normalizeHotkey('f12'), 'f12');
    expectCode(() => normalizeHotkey('f13'), 'invalid-argument');
  });
});

describe('assertTypeText', () => {
  test('空字符串 → invalid-argument', () => {
    expectCode(() => assertTypeText(''), 'invalid-argument');
  });

  test('超过长度上限 → invalid-argument 且提示分段', () => {
    assert.throws(
      () => assertTypeText('a'.repeat(10_001)),
      (error: unknown) => error instanceof MacosToolError && error.hint?.includes('分段') === true,
    );
  });

  test('含 NUL → invalid-argument', () => {
    expectCode(() => assertTypeText('a\u0000b'), 'invalid-argument');
  });
});

describe('normalizeAppName', () => {
  test('首尾空白被去掉', () => {
    assert.equal(normalizeAppName('  微信 '), '微信');
  });

  test('纯空白 → invalid-argument', () => {
    expectCode(() => normalizeAppName('   '), 'invalid-argument');
  });

  test('未传 → undefined（表示前台应用）', () => {
    assert.equal(normalizeAppName(undefined), undefined);
  });
});

describe('normalizeScrollAmount', () => {
  test('未传 → 3（与 CLI 默认值一致）', () => {
    assert.equal(normalizeScrollAmount(undefined), 3);
  });

  test('负数与超过 100 都拒绝', () => {
    expectCode(() => normalizeScrollAmount(-1), 'invalid-argument');
    expectCode(() => normalizeScrollAmount(101), 'invalid-argument');
  });
});

describe('normalizeLimit', () => {
  test('未传 → 取配置上限', () => {
    assert.equal(normalizeLimit(undefined, 150), 150);
  });

  test('请求值大于配置上限 → 收敛到上限', () => {
    assert.equal(normalizeLimit(9999, 150), 150);
  });

  test('请求值小于上限 → 保持请求值', () => {
    assert.equal(normalizeLimit(20, 150), 20);
  });

  test('0 与负数 → invalid-argument', () => {
    expectCode(() => normalizeLimit(0, 150), 'invalid-argument');
    expectCode(() => normalizeLimit(-3, 150), 'invalid-argument');
  });
});
