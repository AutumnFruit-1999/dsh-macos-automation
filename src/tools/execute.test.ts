/**
 * 工具 execute 的行为测试：用假 CLI 验证"拼了哪些参数、解析出什么、渲染成什么"。
 *
 * 这里不碰真实桌面：`Cli.run` 被替换成记录参数并回放固定 JSON 的桩，
 * 因此既能断言传给 `macos` 的 argv，也能断言模型最终看到的一行文本。
 * 真实二进制的联调在 README 的「开发备注」里记录，不进自动化测试。
 * @module dsh-macos-automation/tools/execute.test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Cli } from '../cli.ts';
import { MacosToolError } from '../errors.ts';
import { registerTools } from './index.ts';
import type { ToolEnv } from './env.ts';

/** 一次调用记录。 */
interface Recorded {
  argv: readonly string[];
}

/**
 * 造一个假 CLI：记录 argv，按命令名回放 JSON。
 * @param replies - 命令名（argv[0]）到回放值的映射。
 * @param recorded - 收集 argv 的数组。
 * @returns 注册好 10 个工具的环境与工具表。
 */
function harness(replies: Record<string, unknown>, recorded: Recorded[]): Map<string, ToolDefinition> {
  const cli: Cli = {
    binaryPath: 'macos',
    run: (argv) => {
      recorded.push({ argv });
      const command = argv[0] ?? '';
      if (command in replies) return Promise.resolve(replies[command]);
      return Promise.reject(new MacosToolError('command-failed', `未预置 ${command} 的回放值`));
    },
  };
  const env: ToolEnv = { cli, timeoutMs: 1_000, maxElements: 2 };
  const tools: ToolDefinition[] = [];
  const ctx = { tools: { register: (definition: ToolDefinition) => void tools.push(definition) } } as unknown as Context;
  registerTools(ctx, env, { readOnly: false });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

/** 取一个工具，缺失即失败（避免后续断言变成 undefined 报错难读）。 */
function toolOf(tools: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const tool = tools.get(name);
  assert.ok(tool !== undefined, `未注册 ${name}`);
  return tool;
}

/** 调一次 execute。 */
function run(tools: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<unknown> {
  return toolOf(tools, name).execute(args, { signal: new AbortController().signal } as never);
}

/** 渲染一段规范值成纯文本。 */
function render(tools: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>, value: unknown): string {
  return toolOf(tools, name)
    .output.render(args, value as never)
    .map((block) => ('text' in block ? block.text : ''))
    .join('\n');
}

describe('macos_see', () => {
  test('flat：补 --app/--max-depth，按 maxElements 截断并给中心点', async () => {
    const recorded: Recorded[] = [];
    const tools = harness(
      {
        see: {
          app: '访达',
          elements: [
            { id: 'C2', role: 'AXRadioButton', title: '红色', frame: { x: 0, y: 960, w: 24, h: 22 } },
            { id: 'C3', role: 'AXRadioButton', title: '橙色', frame: { x: 0, y: 960, w: 24, h: 22 } },
            { id: 'C4', role: 'AXRadioButton', title: '黄色', frame: { x: 0, y: 960, w: 24, h: 22 } },
          ],
        },
      },
      recorded,
    );
    const value = (await run(tools, 'macos_see', { app: '访达' })) as { total: number; truncated: boolean; elements: unknown[] };
    assert.deepEqual(recorded[0]?.argv, ['see', '--app', '访达', '--max-depth', '10']);
    assert.equal(value.total, 3);
    assert.equal(value.truncated, true);
    assert.equal(value.elements.length, 2);
    assert.match(render(tools, 'macos_see', { app: '访达' }, value), /→ 12,971/u);
  });

  test('tree：切到 inspect 并带 --detailed', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ inspect: { app: '访达', tree: { role: 'AXWindow', children: [] } } }, recorded);
    const value = (await run(tools, 'macos_see', { app: '访达', view: 'tree' })) as { total: number; tree: unknown };
    assert.deepEqual(recorded[0]?.argv, ['inspect', '--app', '访达', '--max-depth', '5', '--detailed']);
    assert.equal(value.total, 1);
    assert.ok(value.tree !== undefined);
  });
});

describe('macos_click', () => {
  test('query 与坐标互斥时报 invalid-argument，且不拉起 CLI', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ click: { clicked: true, x: 1, y: 2, button: 'left', click_count: 1 } }, recorded);
    await assert.rejects(run(tools, 'macos_click', { query: 'OK', x: 10, y: 20 }), (error: unknown) => {
      return error instanceof MacosToolError && error.code === 'invalid-argument';
    });
    assert.equal(recorded.length, 0);
  });

  test('坐标点击把小数四舍五入后传 --coords', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ click: { clicked: true, x: 10, y: 21, button: 'left', click_count: 1 } }, recorded);
    await run(tools, 'macos_click', { x: 10.4, y: 20.6, double: true });
    assert.deepEqual(recorded[0]?.argv, ['click', '--coords', '10,21', '--double']);
  });

  test('右键与双击同时给出时渲染说明带按钮与次数', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ click: { clicked: true, x: 1, y: 2, button: 'right', click_count: 2 } }, recorded);
    const args = { x: 1, y: 2, right: true, double: true };
    const value = await run(tools, 'macos_click', args);
    assert.equal(render(tools, 'macos_click', args, value), '已点击 右键×2 @ 1,2');
  });
});

describe('macos_type', () => {
  test('清空 + 回车 + 延迟都翻译成 CLI 开关', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ type: { typed: '你好', cleared: true, pressed_return: true } }, recorded);
    const value = await run(tools, 'macos_type', { text: '你好', clear: true, pressReturn: true, delayMs: 20 });
    assert.deepEqual(recorded[0]?.argv, ['type', '--text', '你好', '--delay', '20', '--clear', '--press-return']);
    assert.match(render(tools, 'macos_type', { text: '你好' }, value), /已输入 2 字符（输入前已清空）并按下回车/u);
  });

  test('空文本在入口就被挡下', async () => {
    const tools = harness({}, []);
    await assert.rejects(run(tools, 'macos_type', { text: '' }), (error: unknown) => {
      return error instanceof MacosToolError && error.code === 'invalid-argument';
    });
  });
});

describe('macos_hotkey', () => {
  test('别名归一化后传给 CLI', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ hotkey: { pressed: 'cmd,return' } }, recorded);
    await run(tools, 'macos_hotkey', { keys: 'command,enter' });
    assert.deepEqual(recorded[0]?.argv, ['hotkey', '--keys', 'cmd,return']);
  });

  test('注销组合被拒绝，且不拉起 CLI', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ hotkey: { pressed: '' } }, recorded);
    await assert.rejects(run(tools, 'macos_hotkey', { keys: 'cmd,shift,q' }));
    assert.equal(recorded.length, 0);
  });
});

describe('macos_scroll', () => {
  test('方向/行数/指针坐标都传到 CLI', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ scroll: { direction: 'down', amount: 5 } }, recorded);
    await run(tools, 'macos_scroll', { direction: 'down', amount: 5, x: 100, y: 200 });
    assert.deepEqual(recorded[0]?.argv, ['scroll', '--direction', 'down', '--amount', '5', '--coords', '100,200']);
  });
});

describe('macos_app', () => {
  test('list 解析成应用数组并渲染前台标记', async () => {
    const tools = harness(
      {
        app: [
          { name: '微信', pid: 7835, active: true },
          { name: '访达', pid: 2686, active: false },
        ],
      },
      [],
    );
    const value = await run(tools, 'macos_app', { action: 'list' });
    assert.match(render(tools, 'macos_app', { action: 'list' }, value), /\* 微信 \(pid 7835\)/u);
  });

  test('非 list 缺 app 时报 invalid-argument', async () => {
    const tools = harness({}, []);
    await assert.rejects(run(tools, 'macos_app', { action: 'focus' }), (error: unknown) => {
      return error instanceof MacosToolError && error.code === 'invalid-argument';
    });
  });
});

describe('macos_window', () => {
  test('move 缺 y 时报错，不拉起 CLI', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({}, recorded);
    await assert.rejects(run(tools, 'macos_window', { action: 'move', app: '访达', x: 0 }));
    assert.equal(recorded.length, 0);
  });

  test('resize 把尺寸四舍五入后传参', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ window: { action: 'resize', app: '访达', success: true } }, recorded);
    await run(tools, 'macos_window', { action: 'resize', app: '访达', width: 960.6, height: 1080.2 });
    assert.deepEqual(recorded[0]?.argv, ['window', '--action', 'resize', '--app', '访达', '--width', '961', '--height', '1080']);
  });

  test('list 解析窗口并把同应用的多个窗口都列出', async () => {
    const tools = harness(
      {
        window: [
          { index: 0, title: '收件箱', app: '邮件' },
          { index: 1, title: '', app: '邮件' },
        ],
      },
      [],
    );
    const value = await run(tools, 'macos_window', { action: 'list' });
    const text = render(tools, 'macos_window', { action: 'list' }, value);
    assert.match(text, /共 2 个窗口/u);
    assert.match(text, /\(无标题\)/u);
  });
});

describe('macos_menu', () => {
  test('click 缺 path 时报错', async () => {
    const tools = harness({}, []);
    await assert.rejects(run(tools, 'macos_menu', { action: 'click', app: '访达' }), (error: unknown) => {
      return error instanceof MacosToolError && error.code === 'invalid-argument';
    });
  });

  test('list 渲染成"菜单: 项 | 项"', async () => {
    const tools = harness({ menu: [{ menu: '文件', items: ['新建窗口', '新建文件夹'] }] }, []);
    const value = await run(tools, 'macos_menu', { action: 'list', app: '访达' });
    assert.match(render(tools, 'macos_menu', { action: 'list', app: '访达' }, value), /文件: 新建窗口 \| 新建文件夹/u);
  });
});

describe('macos_clipboard', () => {
  test('set 同时给 text 与 file 时报错', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({}, recorded);
    await assert.rejects(run(tools, 'macos_clipboard', { action: 'set', text: 'a', file: '/tmp/a' }));
    assert.equal(recorded.length, 0);
  });

  test('set 只给 file 时传 --file', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ clipboard: { action: 'set', type: 'file', content: '/tmp/a.xlsx', path: '/tmp/a.xlsx', size: 8192 } }, recorded);
    await run(tools, 'macos_clipboard', { action: 'set', file: '/tmp/a.xlsx' });
    assert.deepEqual(recorded[0]?.argv, ['clipboard', '--action', 'set', '--file', '/tmp/a.xlsx']);
  });

  test('get 文件模式渲染出大小', async () => {
    const tools = harness({ clipboard: { action: 'get', type: 'file', path: '/tmp/a.xlsx', size: 8192 } }, []);
    const value = await run(tools, 'macos_clipboard', { action: 'get' });
    assert.match(render(tools, 'macos_clipboard', { action: 'get' }, value), /8\.0 KiB/u);
  });
});

describe('macos_ocr', () => {
  test('区域四项齐全才传 --region', async () => {
    const recorded: Recorded[] = [];
    const tools = harness({ ocr: { app: '钉钉', count: 1, elements: [{ text: '登录', confidence: 0.9, frame: { x: 1, y: 2, w: 3, h: 4 } }] } }, recorded);
    await run(tools, 'macos_ocr', { app: '钉钉', x: 600, y: 80, width: 400, height: 300 });
    assert.deepEqual(recorded[0]?.argv, ['ocr', '--app', '钉钉', '--region', '600,80,400,300']);
  });

  test('区域只给一半时报 invalid-argument', async () => {
    const tools = harness({}, []);
    await assert.rejects(run(tools, 'macos_ocr', { app: '钉钉', x: 1, y: 2 }), (error: unknown) => {
      return error instanceof MacosToolError && error.code === 'invalid-argument';
    });
  });

  test('识别结果按 maxElements 截断，渲染带中心点与置信度', async () => {
    const tools = harness(
      {
        ocr: {
          app: '钉钉',
          count: 3,
          elements: [
            { text: '登录', confidence: 0.93, frame: { x: 1, y: 2, w: 40, h: 20 } },
            { text: '注册', confidence: 0.8, frame: { x: 50, y: 2, w: 40, h: 20 } },
            { text: '忘记密码', confidence: 0.7, frame: { x: 100, y: 2, w: 60, h: 20 } },
          ],
        },
      },
      [],
    );
    const value = await run(tools, 'macos_ocr', { app: '钉钉' });
    const text = render(tools, 'macos_ocr', { app: '钉钉' }, value);
    assert.match(text, /"登录"  \(1,2 40×20\) → 21,12  conf 0\.93/u);
    assert.match(text, /已截断/u);
  });
});
