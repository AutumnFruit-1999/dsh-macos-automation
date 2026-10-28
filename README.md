# dsh-macos-automation

把 [MacOS-Skills](https://github.com/AutumnFruit-1999/MacOS-Skills) 的 `macos` 原生 CLI 转成 **DSH 工具插件**（规范里的 C 类）：模型不再需要"自己拼 shell 命令再解析 JSON"，而是直接调用 10 个带强类型参数、结构化返回值、超时与取消、错误分类的工具。

<a id="why"></a>
## 概述

原项目是「Swift CLI + 一份给 Agent 看的 SKILL.md」：靠提示词教模型敲 `macos see --app 钉钉`，再让模型从 JSON/文本里自己读坐标。这种方式可行，但有四个结构性代价，正是本插件要消掉的东西：

| 原样（Skill + shell） | 本插件 |
|---|---|
| 模型拼命令字符串，参数写错只有 CLI 的错误文本 | 参数由 schema 校验，错误带稳定 `code` 与下一步提示 |
| 输出是 JSON 文本，模型要自己数坐标、算中心点 | 规范值里直接给 `frame.cx/cy`，`click` 拿来就用 |
| `see --all` 一次吐 883 条，撑爆上下文 | 按 `maxElements` 截断，并明确告知"共 N 条、只给前 M 条" |
| 卡住的命令会一直挂着，无超时无取消 | `timeoutMs` 到点 SIGTERM→SIGKILL；`exec.signal` 取消同路径 |

插件本体判定：给模型用 → **C 工具**（不是 E 客户端 UI）。所以没有 `client.js`、没有设置页。

分发上额外包了一层 **bundle**（自带的 `cordis.patch.yml` 插入自己的 entry）——这是为了让它出现在「已安装插件」列表里、并能用开关启停；纯 patch `insert` 的做法能加载但列表里看不见。

<a id="install"></a>
## 使用本包

### 1. 准备 `macos` 可执行文件

本包**不分发**上游的 Swift 源码与二进制（上游仓库当前没有 LICENSE，见 [已知限制](#limits)）。两条路：

```sh
# A. 已经有：确认在 PATH 上
macos --help

# B. 自己编译：先 clone 上游，再让本脚本编译到 ./bin/macos
git clone https://github.com/AutumnFruit-1999/MacOS-Skills.git
npm run build:cli -- --source ./MacOS-Skills
```

编译需要 Swift 6+（`xcode-select --install` 或 Xcode 16+）。

### 2. 授权

`see` / `click` / `type` / `hotkey` / `window` / `menu` 走辅助功能 API，`ocr` 还需要屏幕录制。授权对象是**发起进程**——DSH 桌面应用，或启动 `dsh web` 的那个终端/IDE；改完授权要重启该进程。

### 3. 安装插件

本包是 **bundle**（`package.json` 里 `dsh.bundle.patch` 指向自带的 `cordis.patch.yml`，由它插入自己的 entry）。完整三步：

```sh
# 1) 克隆并构建（`npm install` 会自动跑 prepare → tsdown，产出 lib/）
git clone https://github.com/AutumnFruit-1999/dsh-macos-automation.git
cd dsh-macos-automation
npm install

# 2) 装进 profile 的 node_modules
dsh plugin --profile web add file:"$PWD"
```

```jsonc
// 3) ~/.dsh/profiles/<name>/package.json —— 加进 bundles 列表
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
  "dsh-macos-automation"          // ← 加这一行
] } }
```

**第 2 步失败时**（常见于 profile 的 `node_modules` 由旧版 pnpm 创建、与应用内 pnpm 大版本不一致，报 `ERR_PNPM_UNEXPECTED_STORE`）：手工链接等价，效果相同——

```sh
ln -s "$PWD" ~/.dsh/profiles/web/node_modules/dsh-macos-automation
# 并在 profile 的 package.json dependencies 里加：
#   "dsh-macos-automation": "file:/绝对路径/dsh-macos-automation"
```

加进 bundles 之后，设置页「插件」→「已安装插件」里就会多出这一项，右边的开关就是它唯一的启停入口：关掉会把包名从 bundles 摘掉，bundle 层不再贡献 entry，工具随之消失。

不要**同时**在 profile 的 `cordis.patch.yml` 里再写一条 `insert` —— 两个同 id 条目会让工具被注册两遍，`tools.register` 对同层重名会直接抛错。纯 `insert` 虽然也能加载，但不会出现在「已安装插件」列表里（列表读的是 `dsh.profile.bundles`）。

非 macOS 平台上插件只记一条 warn 日志、不注册任何工具——不会给模型一堆永远失败的入口。

### 4. 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `binaryPath` | `"macos"` | 命令名走 PATH，也可给绝对路径（如 `./bin/macos`） |
| `timeoutMs` | `10000` | 单次 CLI 超时；`see`/`ocr` 这类慢命令建议手动调到 20000 以上 |
| `maxElements` | `150` | 单次返回元素/文字条数上限 |
| `readOnly` | `false` | 只注册 `macos_see` 与 `macos_ocr`，适合"只让模型看屏幕"的场景 |

`binaryPath` 只给裸命令名时，插件会在 PATH 之外继续探测 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/bin`。原因是桌面端由 launchd 启动，PATH 往往是系统默认的那四个目录，`~/.local/bin` 不在其中——不探测就会出现"终端里跑得好、应用里全报 binary-missing"。含 `/` 的值视为显式路径，不做任何改写，写错就让你看到 spawn 的真实报错。

<a id="tools"></a>
## 模型体验（10 个工具）

| 工具 | 做什么 | 读/写 |
|---|---|---|
| `macos_see` | 列元素（flat，带中心点）或导出 AX 树（tree） | 读 |
| `macos_ocr` | 识别窗口/区域文字，返回屏幕坐标 | 读 |
| `macos_click` | 按文本或坐标点击（支持双击/右键） | 写 |
| `macos_type` | 逐字符输入（支持中文、清空、回车） | 写 |
| `macos_hotkey` | 快捷键组合 | 写 |
| `macos_scroll` | 滚轮（可先移动指针） | 写 |
| `macos_app` | list / launch / quit / focus | 写（list 读） |
| `macos_window` | list / move / resize / close / minimize / maximize / focus | 写（list 读） |
| `macos_menu` | 列菜单 / 按 `"文件 > 新建"` 点击 | 写（list 读） |
| `macos_clipboard` | get / set（文本或文件）/ clear | 写（get 读） |

典型工作流（工具描述里也写了同一句）：
`macos_see` → 取 `→ cx,cy` → `macos_click` / `macos_type` → 再 `macos_see` 复核。
AX 树看不到的 Electron 浮层：`macos_ocr` → `macos_click`。

写类工具声明 `isConcurrencySafe: false`：两次点击/快捷键交错会落到不可预期的组合上；`see`/`ocr`/`list` 可并发。

<a id="design"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：`name`/`inject`/`Config`/`apply`，平台门禁 |
| `src/config.ts` | 配置 schema（唯一真源，类型由 `Schemastery.TypeT` 推导） |
| `src/types.ts` | 规范值形状与错误码的唯一归属地 |
| `src/constants.ts` | 工具名、枚举白名单、超时与上限 |
| `src/binary.ts` | `macos` 定位：显式路径直通，裸命令名查 PATH + 常见安装目录 |
| `src/cli.ts` | 子进程适配器：超时、取消、输出上限、JSON 解析 |
| `src/errors.ts` | stderr → 稳定 `code` + 可执行 `hint` 的分类表 |
| `src/args.ts` | 坐标/区域/快捷键/文本的归一化与校验（纯函数） |
| `src/parse.ts` | CLI JSON → 规范值的边界收窄（补中心点、丢脏数据） |
| `src/result.ts` | 截断计数与模型可见的单行渲染（纯函数） |
| `src/tools/*.ts` | 每个 CLI 子命令一个工具，只做"拼参数→解析→渲染" |
| `src/tools/env.ts` | 工具装配环境（CLI + 生效配置），唯一持有依赖的地方 |
| `src/tools/index.ts` | 注册聚合与 `readOnly` 过滤 |
| `scripts/build-cli.mjs` | 从用户本地上游源码编译 `macos` 到 `bin/` |
| `cordis.patch.yml` | bundle 层：插入自己的 entry（不含 config，靠 `binary.ts` 自动定位） |

### 导出形状

```ts
export const name = 'tool-macos';
export const inject = ['tools'];
export function apply(ctx, config): void;
export { Config };
```

无 `default` 导出（函数式插件带 default 会让 Loader 丢掉 `inject`）。

### 四个刻意的决定

1. **`see` 与 `inspect` 合成一个工具**：选子命令是纯实现细节，不该让模型先做一次选择题。用 `view: 'flat' | 'tree'` 表达意图。
2. **不写 `presentCall` / `presentResult`**：官方文档明确内置 Web Client 不消费这两个投影，写了也不会多出卡片。要 UI 卡片应走 Client 插件的 `tool.call.toolview` slot，属于另一个包。
3. **`defineTool` 不设 `timeoutMs`**：超时只在 `cli.ts` 一处实现，避免"注册表预算"与"子进程预算"两套时间互相抢先，导致同一次挂起有时报 `timeout`、有时报 `cancelled`。
4. **相对原 CLI 收窄一处**：拒绝 `cmd+shift+q`（注销）、`cmd+ctrl+q`（锁屏）、`cmd+alt+escape`（强制退出）。误触代价远大于少一个能力，这是本插件**故意**不是 CLI bug。

### 规范值示例

```json
{
  "app": "访达",
  "view": "flat",
  "total": 9,
  "truncated": true,
  "elements": [
    { "id": "C2", "role": "AXRadioButton", "title": "添加“红色”标签",
      "frame": { "x": 0, "y": 960, "w": 24, "h": 22, "cx": 12, "cy": 971 } }
  ]
}
```

PTC mode 下 `await tools.macos_see({ app: "访达" })` 直接拿到这个对象，不用解析文本。

<a id="limits"></a>
## 已知限制

- **上游许可证缺失**：`MacOS-Skills` 没有 LICENSE 文件。本包因此不内联其源码与二进制，只调用本机已有的 `macos`。要分发二进制请先取得上游作者授权。
- **与 CLI 命令面强耦合**：参数按上游 `main` 分支（11 个子命令）对齐。CLI 改了选项而插件没跟，表现为 `invalid-argument` 或 `command-failed`，不会是静默错误。
- **`macos_menu({action:"list"})` 输出可能很大**：Finder 的菜单一次性约 200 项（约 2 KB 文本）。菜单项过多时模型容易挑错，建议先看菜单名再 `click`。
- **`see` 只看得到前台应用的完整 AX 树**：非前台窗口只暴露部分元素——这是 macOS 的限制，插件不掩盖：先 `macos_app({action:"focus"})`。
- **`ocr` 需要 macOS 14+ 与屏幕录制权限**：缺权限时报 `permission-denied`，缺系统版本报 `unsupported-platform`。
- **`screenshot` 参数只是落盘，不等于"模型看见了"**：模型要真的看图，得再调 `read` 读那个文件，而这要求当前路由声明 `image` 输入。纯文本适配器（例如 `dsh-kilo-free`，它对所有模型硬编码 `inputModalities: ['text']`）会直接拒绝，报 `model "X" does not declare image input`。这类路由上请用 `macos_ocr`——它返回文字 + 坐标，纯文本，正是文本模型的取图替代方案。
- **不处理中文应用的英文名**：`app` 必须是 localizedName（「访达」而非「Finder」）。错误提示里会建议先 `macos_app({action:"list"})`。

<a id="dev"></a>
## 开发备注

```sh
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test "src/**/*.test.ts"
npm run build       # tsdown → lib/
npm run check       # typecheck + test
```

测试 113 个用例，全部行为断言（无快照、无"读源码找符号"式守卫）：

- `args.test.ts` — 坐标/区域/快捷键/文本校验，含禁止组合
- `binary.test.ts` — 显式路径直通、PATH 命中、兜底目录命中、无执行权限跳过、空 PATH 段
- `errors.test.ts` — 按 CLI 真实文案做分类矩阵
- `parse.test.ts` — CLI JSON → 规范值，脏数据丢弃
- `result.test.ts` — 截断计数、单行渲染、树的深度/行数上限
- `cli.test.ts` — **真实子进程**（用 Node 自己当假 CLI）验成功/非零/超时/取消/ENOENT/坏 JSON
- `tools/index.test.ts` — 注册契约：10 个工具、命名唯一、schema 经官方编译器校验、只读过滤
- `tools/execute.test.ts` — 用假 CLI 验每个工具"拼了哪些 argv、解析出什么、渲染成什么"

真实二进制冒烟（本机 `macos` 已在 PATH、辅助功能已授权）已验过：`clipboard get`、`app list`、`see --app 访达`、`menu list`、`window list`、`click --query`（未命中 → `element-not-found`）、被拒绝的 `cmd+shift+q`。
