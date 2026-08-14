import { clientConfigOf } from '../config.js';
import { krokiUrlOf, parseRenderBody, summarizeError } from '../shared/diagram.js';
export const RENDER_PATH = '/plugins/dsh-mermaid-renderer/render';
export const CONFIG_PATH = '/plugins/dsh-mermaid-renderer/client-config';
/** 纯文本收尾,幂等(已发送过 header 则只 end)。 */
export function endText(res, status, message, headers = {}) {
    if (res.headersSent) {
        res.end();
        return;
    }
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
    res.end(message);
}
/** 流式读请求体,超过上限提前截断(之后直接回 413,不再消费)。 */
export async function readBody(req, cap) {
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
        body += chunk;
        if (body.length > cap)
            break;
    }
    return body;
}
/**
 * POST 渲染代理:diagram JSON 进 → SVG 出。
 * 失败语义:405 非 POST / 413 体积超限 / 400 非法 JSON 或非法图源 /
 * 502 上游不可达或超时;上游非 2xx 时透传状态与正文。
 */
export async function handleRender(req, res, config) {
    if (req.method !== 'POST') {
        endText(res, 405, 'method not allowed', { allow: 'POST' });
        return;
    }
    const raw = await readBody(req, config.maxBodyBytes + 1);
    const parsed = parseRenderBody(raw, {
        maxBodyBytes: config.maxBodyBytes,
        maxDiagramBytes: config.maxDiagramBytes,
    });
    if (!parsed.ok) {
        endText(res, parsed.status, parsed.message);
        return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
    try {
        const upstream = await fetch(krokiUrlOf(config.krokiBaseUrl, config.krokiPath), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                diagram_source: parsed.source,
                diagram_type: 'mermaid',
                output_format: 'svg',
            }),
            signal: controller.signal,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
            'content-type': upstream.ok ? 'image/svg+xml; charset=utf-8' : 'text/plain; charset=utf-8',
            'cache-control': 'no-cache',
        });
        res.end(text);
    }
    catch (error) {
        const message = error instanceof Error && error.name === 'AbortError'
            ? `upstream timed out after ${config.upstreamTimeoutMs}ms`
            : `upstream render failed: ${summarizeError(error instanceof Error ? error.message : String(error))}`;
        endText(res, 502, message);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 客户端配置下发:浏览器半边启动时拉取,返回 Config 的客户端可见子集。
 * 实时快照,禁止缓存。
 */
export function handleClientConfig(req, res, config) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        endText(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
        return;
    }
    const body = JSON.stringify(clientConfigOf(config));
    res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}
//# sourceMappingURL=http.js.map