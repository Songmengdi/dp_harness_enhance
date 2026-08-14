/**
 * 纯函数共享层 —— host 与 client 半边各自编译进自己的产物,
 * 不依赖任何运行时环境,单元测试直接针对本模块。
 */
/** 数值夹取。 */
export function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
}
/**
 * 适配模式缩放:把自然尺寸 (nw, nh) 的图放进 (boxW, boxH) 的视口,
 * 留 12px 边距,从不放大(上限 1),下限为 minScale。
 * 任何尺寸非法(<=0)返回 0,调用方按"不缩放"处理。
 */
export function fitScaleFor(nw, nh, boxW, boxH, minScale = 0.15) {
    if (!(nw > 0) || !(nh > 0) || !(boxW > 0) || !(boxH > 0))
        return 0;
    const s = Math.min(1, (boxW - 12) / nw, (boxH - 12) / nh);
    return clamp(s, minScale, 1);
}
/**
 * 深色主题注入:GUI 处于深色且用户没有显式 init 指令时,前置注入
 * mermaid dark theme。返回注入后的源码与"是否注入"标记(卡片据此
 * 决定是否做 SVG 重着色)。
 */
export function buildDarkInjection(source, dark, themeAuto) {
    const hasInit = source.includes('%%{init');
    const injected = dark && themeAuto && !hasInit;
    return {
        diagram: injected ? '%%{init: {"theme": "dark"}}%%\n' + source : source,
        injected,
    };
}
/**
 * Kroki 渲染返回的 SVG 里 id="container" 会与页面上其他 SVG 冲突,
 * 这里做确定性重命名:同一输入 + 同一新 id 得到同一输出(可重放)。
 */
export function uniquifySvgIds(svg, id) {
    return svg
        .replace(/id="container"/g, `id="${id}"`)
        .replace(/#container/g, `#${id}`);
}
/** 拼接 Kroki 端点 URL(base 末尾斜杠与 path 开头斜杠归一)。 */
export function krokiUrlOf(baseUrl, krokiPath) {
    const base = baseUrl.replace(/\/+$/, '');
    const path = krokiPath.startsWith('/') ? krokiPath : `/${krokiPath}`;
    return base + path;
}
/** 渲染错误文本归一:折叠空白并去首尾、截断到 400 字符。 */
export function summarizeError(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}
/**
 * 解析渲染请求体:超限 → 413;非法 JSON → 400;diagram_source 缺失/
 * 非字符串/为空/超限 → 400。全部失败路径带明确的纯文本语义。
 */
export function parseRenderBody(raw, limits) {
    if (raw.length > limits.maxBodyBytes) {
        return { ok: false, status: 413, message: 'payload too large' };
    }
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { ok: false, status: 400, message: 'invalid json' };
    }
    const source = parsed !== null && typeof parsed === 'object'
        && typeof parsed.diagram_source === 'string'
        ? parsed.diagram_source
        : '';
    if (source.length === 0 || source.length > limits.maxDiagramBytes) {
        return { ok: false, status: 400, message: 'bad diagram source' };
    }
    return { ok: true, source };
}
//# sourceMappingURL=diagram.js.map