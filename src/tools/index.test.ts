/**
 * 注册契约测试：注册面、命名、schema 可编译性、只读过滤。
 *
 * 不需要真实 DSH：只断言"注册了什么"，用最小 ctx 替身捕获定义。
 * schema 用官方编译器验证——它能编译，才说明 `defineTool` 的参数/输出声明合法。
 * @module dsh-macos-automation/tools/index.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { assertObjectJsonSchema, assertSupportedJsonSchema, defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { TOOL_PREFIX } from '../constants.ts';
import { createCli } from '../cli.ts';
import { registerTools } from './index.ts';
import type { ToolEnv } from './env.ts';

/** 捕获注册结果的最小 ctx：只实现 register。 */
function fakeContext(): { ctx: Context; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  const ctx = { tools: { register: (definition: ToolDefinition) => void tools.push(definition) } } as unknown as Context;
  return { ctx, tools };
}

/**
 * 判断编译后的参数 schema 是否声明了某个字段。
 * @param tool - 已注册的工具定义。
 * @param key - 字段名。
 * @returns 声明了即 true。
 */
function hasProperty(tool: ToolDefinition, key: string): boolean {
  const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties;
  return properties !== undefined && key in properties;
}

/** 测试用环境：binaryPath 指哪儿都行，注册阶段不会真的执行。 */
const env: ToolEnv = { cli: createCli({ binaryPath: 'macos' }), timeoutMs: 1_000, maxElements: 10 };

describe('registerTools', () => {
  test('默认注册 10 个工具，全部带 macos_ 前缀', () => {
    const { ctx, tools } = fakeContext();
    const names = registerTools(ctx, env, { readOnly: false });
    assert.equal(tools.length, 10);
    assert.deepEqual(names, tools.map((tool) => tool.name));
    assert.ok(names.every((toolName) => toolName.startsWith(TOOL_PREFIX)));
  });

  test('工具名唯一', () => {
    const { ctx, tools } = fakeContext();
    registerTools(ctx, env, { readOnly: false });
    assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  });

  test('readOnly → 只注册 see 与 ocr', () => {
    const { ctx, tools } = fakeContext();
    const names = registerTools(ctx, env, { readOnly: true });
    assert.deepEqual(names, ['macos_see', 'macos_ocr']);
  });

  test('每个工具都有描述，且参数/输出已编译成受支持的 JSON Schema', () => {
    const { ctx, tools } = fakeContext();
    registerTools(ctx, env, { readOnly: false });
    for (const tool of tools) {
      assert.ok(tool.description.length > 20, `${tool.name} 缺少足够的模型可见描述`);
      assert.doesNotThrow(() => assertObjectJsonSchema(tool.parameters), `${tool.name} 的参数不是合法对象 schema`);
      assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema), `${tool.name} 的输出 schema 不受支持`);
      assert.equal(typeof tool.execute, 'function');
      assert.equal(typeof tool.output.render, 'function');
    }
  });

  test('写工具声明为非并发安全，只读工具声明为并发安全', () => {
    const { ctx, tools } = fakeContext();
    registerTools(ctx, env, { readOnly: false });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get('macos_click')?.isConcurrencySafe?.({} as never), false);
    assert.equal(byName.get('macos_see')?.isConcurrencySafe?.({} as never), true);
  });

  test('编译后的参数名与工具语义一致（see 有 view，click 有 query）', () => {
    const { ctx, tools } = fakeContext();
    registerTools(ctx, env, { readOnly: false });
    const see = tools.find((tool) => tool.name === 'macos_see');
    const click = tools.find((tool) => tool.name === 'macos_click');
    assert.ok(see !== undefined && click !== undefined);
    assert.ok(hasProperty(see, 'view'), 'see 应当暴露 view 参数');
    assert.ok(hasProperty(click, 'query'), 'click 应当暴露 query 参数');
  });

  test('defineTool 在注册阶段就拒绝非法 schema（防止写错枚举）', () => {
    assert.throws(() =>
      defineTool({
        name: 'bad',
        description: '非法 schema 应当在注册期就报错',
        parameters: { mode: { type: 'string', enum: [] } },
        output: { schema: { type: 'string' }, render: () => [] },
        // eslint-disable-next-line @typescript-eslint/require-await
        async execute() {
          return 'x';
        },
      }),
    );
  });
});
