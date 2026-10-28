/**
 * 运行时配置 schema：唯一真源（类型、默认值、校验都由它派生）。
 *
 * `apply` 收到的 config 已按此填好默认值，工具里不再兜底。
 * 必须始终成立：字段改名必须同时改 README 的配置表与迁移说明——config 会随 profile 落盘。
 * @module dsh-macos-automation/config
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_MAX_ELEMENTS, DEFAULT_TIMEOUT_MS } from './constants.ts';

/** 插件配置。 */
export const Config = z.object({
  /** macos 可执行文件：命令名走 PATH，也可给绝对路径。 */
  binaryPath: z.string().default('macos').description('macos CLI 的命令名或绝对路径'),
  /** 单次 CLI 调用超时（ms），超出即终止子进程。 */
  timeoutMs: z.number().min(1000).max(120_000).default(DEFAULT_TIMEOUT_MS).description('单次调用超时（毫秒）'),
  /** 单次返回元素条数上限，防止 `see --all` 撑爆上下文。 */
  maxElements: z.number().min(1).max(2000).default(DEFAULT_MAX_ELEMENTS).description('单次返回的元素条数上限'),
  /** 只注册只读工具（see/ocr），适合"只让模型看屏幕"的场景。 */
  readOnly: z.boolean().default(false).description('只注册只读工具'),
});

/** 解析后的配置类型：由 schema 推导，不手写第二份。 */
export type ResolvedConfig = Schemastery.TypeT<typeof Config>;
