/**
 * 客户端渲染配置契约 —— host 与 client 半边共享的单一事实源。
 *
 * 本模块不 import schemastery:client bundle 的平台模块表里没有它,
 * 浏览器半边只消费纯 JSON(config 由 host 的 client-config 端点下发,
 * 合并前的编译期默认值与 host schema 默认值一致,由单测守护不漂移)。
 */
/**
 * 编译期默认值。必须与 src/config.ts 中 Schemastery schema 的默认值
 * 完全一致(由 test/client-config.test.js 断言守护)。
 */
export const CLIENT_DEFAULTS = {
    fitMaxHeight: 360,
    zoomBoxHeight: 560,
    zoomMinScale: 0.15,
    zoomMaxScale: 6,
    renderTimeoutMs: 30000,
    themeAuto: true,
    darkColors: {
        shape: '#21262d',
        stroke: '#6e7681',
        cluster: '#161b22',
        edge: '#8b949e',
        text: '#e6edf3',
        canvas: '#0d1117',
    },
};
/** 从完整 host 配置投影出客户端子集(host 的 client-config 端点使用)。 */
export function clientConfigOf(config) {
    return {
        fitMaxHeight: config.fitMaxHeight,
        zoomBoxHeight: config.zoomBoxHeight,
        zoomMinScale: config.zoomMinScale,
        zoomMaxScale: config.zoomMaxScale,
        renderTimeoutMs: config.renderTimeoutMs,
        themeAuto: config.themeAuto,
        darkColors: { ...config.darkColors },
    };
}
/**
 * 清洗网络下发的未知 JSON:字段缺失或类型不对时逐项回退到编译期默认值,
 * 保证浏览器半边拿到的一定是结构完好的 ClientConfig。
 */
export function sanitizeClientConfig(data) {
    const num = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
    const str = (value, fallback) => typeof value === 'string' ? value : fallback;
    if (data === null || typeof data !== 'object')
        return CLIENT_DEFAULTS;
    const src = data;
    const dc = src.darkColors !== null && typeof src.darkColors === 'object'
        ? src.darkColors
        : {};
    return {
        fitMaxHeight: num(src.fitMaxHeight, CLIENT_DEFAULTS.fitMaxHeight),
        zoomBoxHeight: num(src.zoomBoxHeight, CLIENT_DEFAULTS.zoomBoxHeight),
        zoomMinScale: num(src.zoomMinScale, CLIENT_DEFAULTS.zoomMinScale),
        zoomMaxScale: num(src.zoomMaxScale, CLIENT_DEFAULTS.zoomMaxScale),
        renderTimeoutMs: num(src.renderTimeoutMs, CLIENT_DEFAULTS.renderTimeoutMs),
        themeAuto: bool(src.themeAuto, CLIENT_DEFAULTS.themeAuto),
        darkColors: {
            shape: str(dc.shape, CLIENT_DEFAULTS.darkColors.shape),
            stroke: str(dc.stroke, CLIENT_DEFAULTS.darkColors.stroke),
            cluster: str(dc.cluster, CLIENT_DEFAULTS.darkColors.cluster),
            edge: str(dc.edge, CLIENT_DEFAULTS.darkColors.edge),
            text: str(dc.text, CLIENT_DEFAULTS.darkColors.text),
            canvas: str(dc.canvas, CLIENT_DEFAULTS.darkColors.canvas),
        },
    };
}
//# sourceMappingURL=client-config.js.map