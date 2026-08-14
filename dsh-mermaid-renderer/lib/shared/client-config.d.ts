/**
 * 客户端渲染配置契约 —— host 与 client 半边共享的单一事实源。
 *
 * 本模块不 import schemastery:client bundle 的平台模块表里没有它,
 * 浏览器半边只消费纯 JSON(config 由 host 的 client-config 端点下发,
 * 合并前的编译期默认值与 host schema 默认值一致,由单测守护不漂移)。
 */
/** 深色主题下 SVG 重着色用的调色板。 */
export interface DarkColors {
    /** 节点形状填充色 */
    shape: string;
    /** 形状/簇描边色 */
    stroke: string;
    /** 簇与边标签底色 */
    cluster: string;
    /** 连线与箭头色 */
    edge: string;
    /** 文本色 */
    text: string;
    /** 深色卡片画布底色 */
    canvas: string;
}
/** 下发给浏览器的渲染配置(host Config 的客户端可见子集)。 */
export interface ClientConfig {
    /** 适配模式的最大展示高度(px) */
    fitMaxHeight: number;
    /** 缩放模式容器高度(px) */
    zoomBoxHeight: number;
    /** 缩放下限 */
    zoomMinScale: number;
    /** 缩放上限 */
    zoomMaxScale: number;
    /** 单图渲染超时(ms) */
    renderTimeoutMs: number;
    /** 深色 GUI 下自动注入 dark theme(无显式 init 指令时) */
    themeAuto: boolean;
    /** 深色重着色调色板 */
    darkColors: DarkColors;
}
/**
 * 编译期默认值。必须与 src/config.ts 中 Schemastery schema 的默认值
 * 完全一致(由 test/client-config.test.js 断言守护)。
 */
export declare const CLIENT_DEFAULTS: ClientConfig;
/** 从完整 host 配置投影出客户端子集(host 的 client-config 端点使用)。 */
export declare function clientConfigOf(config: ClientConfig): ClientConfig;
/**
 * 清洗网络下发的未知 JSON:字段缺失或类型不对时逐项回退到编译期默认值,
 * 保证浏览器半边拿到的一定是结构完好的 ClientConfig。
 */
export declare function sanitizeClientConfig(data: unknown): ClientConfig;
