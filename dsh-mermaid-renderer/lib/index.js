// 值导入:Config 同时是类型与 Schemastery schema(同名双义导出),
// loader 需要运行时的 schema 值来校验/补默认配置。
import { Config } from './config.js';
import { CONFIG_PATH, handleClientConfig, handleRender, RENDER_PATH } from './host/http.js';
export const name = 'dsh-mermaid-renderer';
export const inject = ['webServer'];
export function apply(ctx, config) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: RENDER_PATH,
        handler: (req, res) => handleRender(req, res, config),
    }), 'dsh-mermaid-renderer: render route');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: CONFIG_PATH,
        handler: (req, res) => handleClientConfig(req, res, config),
    }), 'dsh-mermaid-renderer: client-config route');
}
export { Config };
export { CLIENT_DEFAULTS, clientConfigOf } from './config.js';
//# sourceMappingURL=index.js.map