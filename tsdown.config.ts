/**
 * 构建配置：单入口 ESM 产物 + 类型声明。
 *
 * 只打包本包源码，`@deepseek-ai/*` 全部外部化——它们由宿主提供，打进来会造成两份 Cordis。
 * @module dsh-macos-automation/tsdown.config
 */
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'lib',
  dts: true,
  clean: true,
  external: [/^@deepseek-ai\//, /^node:/],
});
