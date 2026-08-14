/**
 * dsh-mermaid-renderer — host 半边:同源 Kroki 代理 + 客户端配置下发。
 *
 * 唯一职责:把浏览器的渲染请求转发给 Kroki 兼容服务(浏览器永远不直连
 * 外网),并把配置的客户端可见子集下发给 client 半边。
 * 依赖 `webServer` service(dsh-host-webserver 提供);两个 route 都注册在
 * effect 里,随 fiber 卸载自动清理。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export declare const name = "dsh-mermaid-renderer";
export declare const inject: readonly ["webServer"];
export declare function apply(ctx: Context, config: Config): void;
export { Config };
export { CLIENT_DEFAULTS, clientConfigOf } from './config.js';
export type { ClientConfig, DarkColors } from './config.js';
