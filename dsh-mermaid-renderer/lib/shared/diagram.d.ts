/**
 * 纯函数共享层 —— host 与 client 半边各自编译进自己的产物,
 * 不依赖任何运行时环境,单元测试直接针对本模块。
 */
/** 数值夹取。 */
export declare function clamp(value: number, lo: number, hi: number): number;
/**
 * 适配模式缩放:把自然尺寸 (nw, nh) 的图放进 (boxW, boxH) 的视口,
 * 留 12px 边距,从不放大(上限 1),下限为 minScale。
 * 任何尺寸非法(<=0)返回 0,调用方按"不缩放"处理。
 */
export declare function fitScaleFor(nw: number, nh: number, boxW: number, boxH: number, minScale?: number): number;
/**
 * 深色主题注入:GUI 处于深色且用户没有显式 init 指令时,前置注入
 * mermaid dark theme。返回注入后的源码与"是否注入"标记(卡片据此
 * 决定是否做 SVG 重着色)。
 */
export declare function buildDarkInjection(source: string, dark: boolean, themeAuto: boolean): {
    diagram: string;
    injected: boolean;
};
/**
 * Kroki 渲染返回的 SVG 里 id="container" 会与页面上其他 SVG 冲突,
 * 这里做确定性重命名:同一输入 + 同一新 id 得到同一输出(可重放)。
 */
export declare function uniquifySvgIds(svg: string, id: string): string;
/** 拼接 Kroki 端点 URL(base 末尾斜杠与 path 开头斜杠归一)。 */
export declare function krokiUrlOf(baseUrl: string, krokiPath: string): string;
/** 渲染错误文本归一:折叠空白并去首尾、截断到 400 字符。 */
export declare function summarizeError(text: string): string;
export type RenderBodyLimits = {
    maxBodyBytes: number;
    maxDiagramBytes: number;
};
export type ParseRenderBodyResult = {
    ok: true;
    source: string;
} | {
    ok: false;
    status: number;
    message: string;
};
/**
 * 解析渲染请求体:超限 → 413;非法 JSON → 400;diagram_source 缺失/
 * 非字符串/为空/超限 → 400。全部失败路径带明确的纯文本语义。
 */
export declare function parseRenderBody(raw: string, limits: RenderBodyLimits): ParseRenderBodyResult;
