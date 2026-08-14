/**
 * Host HTTP 处理:同源 Kroki 代理 + 客户端配置下发端点。
 * 两个 route 都在 apply 的 effect 里注册(可随 fiber 清理),
 * handler 拥有完整响应生命周期(见 dsh-host-webserver 的 WebRoute 契约)。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
export declare const RENDER_PATH = "/plugins/dsh-mermaid-renderer/render";
export declare const CONFIG_PATH = "/plugins/dsh-mermaid-renderer/client-config";
/** 纯文本收尾,幂等(已发送过 header 则只 end)。 */
export declare function endText(res: ServerResponse, status: number, message: string, headers?: Record<string, string>): void;
/** 流式读请求体,超过上限提前截断(之后直接回 413,不再消费)。 */
export declare function readBody(req: IncomingMessage, cap: number): Promise<string>;
/**
 * POST 渲染代理:diagram JSON 进 → SVG 出。
 * 失败语义:405 非 POST / 413 体积超限 / 400 非法 JSON 或非法图源 /
 * 502 上游不可达或超时;上游非 2xx 时透传状态与正文。
 */
export declare function handleRender(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void>;
/**
 * 客户端配置下发:浏览器半边启动时拉取,返回 Config 的客户端可见子集。
 * 实时快照,禁止缓存。
 */
export declare function handleClientConfig(req: IncomingMessage, res: ServerResponse, config: Config): void;
