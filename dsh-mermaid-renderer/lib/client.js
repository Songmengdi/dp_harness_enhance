window.__ModuleLoader__.load({
  id: "dsh-mermaid-renderer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_client = require("react-dom/client");

// src/shared/client-config.ts
var CLIENT_DEFAULTS = {
  fitMaxHeight: 360,
  zoomBoxHeight: 560,
  zoomMinScale: 0.15,
  zoomMaxScale: 6,
  renderTimeoutMs: 3e4,
  themeAuto: true,
  darkColors: {
    shape: "#21262d",
    stroke: "#6e7681",
    cluster: "#161b22",
    edge: "#8b949e",
    text: "#e6edf3",
    canvas: "#0d1117"
  }
};
function sanitizeClientConfig(data) {
  const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const str = (value, fallback) => typeof value === "string" ? value : fallback;
  if (data === null || typeof data !== "object") return CLIENT_DEFAULTS;
  const src = data;
  const dc = src.darkColors !== null && typeof src.darkColors === "object" ? src.darkColors : {};
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
      canvas: str(dc.canvas, CLIENT_DEFAULTS.darkColors.canvas)
    }
  };
}

// src/shared/diagram.ts
function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}
function fitScaleFor(nw, nh, boxW, boxH, minScale = 0.15) {
  if (!(nw > 0) || !(nh > 0) || !(boxW > 0) || !(boxH > 0)) return 0;
  const s = Math.min(1, (boxW - 12) / nw, (boxH - 12) / nh);
  return clamp(s, minScale, 1);
}
function buildDarkInjection(source, dark, themeAuto) {
  const hasInit = source.includes("%%{init");
  const injected = dark && themeAuto && !hasInit;
  return {
    diagram: injected ? '%%{init: {"theme": "dark"}}%%\n' + source : source,
    injected
  };
}
function uniquifySvgIds(svg, id) {
  return svg.replace(/id="container"/g, `id="${id}"`).replace(/#container/g, `#${id}`);
}
function summarizeError(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

// src/client.ts
var MOUNT_CLASS = "tcm-mount";
var CODE_BLOCK_CLASS = "md-code-block";
var SLOT_NAME = "conversation.chat.assistant-actions";
var SLOT_ID = "mermaid-inline";
var SLOT_ORDER = 90;
var RENDER_ENDPOINT = "/plugins/dsh-mermaid-renderer/render";
var CONFIG_ENDPOINT = "/plugins/dsh-mermaid-renderer/client-config";
var CONFIG_FETCH_TIMEOUT_MS = 5e3;
var liveConfig = CLIENT_DEFAULTS;
var configListeners = /* @__PURE__ */ new Set();
function setLiveConfig(cfg) {
  liveConfig = cfg;
  for (const listener of configListeners) listener();
}
function subscribeConfig(listener) {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}
function configNow() {
  return liveConfig;
}
async function loadClientConfig() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return sanitizeClientConfig(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
var ICON_PATHS = {
  code: [
    ["polyline", { points: "16 18 22 12 16 6" }],
    ["polyline", { points: "8 6 2 12 8 18" }]
  ],
  copy: [
    ["rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }],
    ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }]
  ],
  check: [["polyline", { points: "20 6 9 17 4 12" }]],
  zoomIn: [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }],
    ["line", { x1: "11", y1: "8", x2: "11", y2: "14" }],
    ["line", { x1: "8", y1: "11", x2: "14", y2: "11" }]
  ],
  zoomOut: [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }],
    ["line", { x1: "8", y1: "11", x2: "14", y2: "11" }]
  ],
  plus: [
    ["line", { x1: "12", y1: "5", x2: "12", y2: "19" }],
    ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]
  ],
  minus: [["line", { x1: "5", y1: "12", x2: "19", y2: "12" }]],
  maximize: [
    ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }],
    ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }],
    ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }],
    ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]
  ],
  minimize: [
    ["path", { d: "M8 3v3a2 2 0 0 1-2 2H3" }],
    ["path", { d: "M21 8h-3a2 2 0 0 1-2-2V3" }],
    ["path", { d: "M3 16h3a2 2 0 0 1 2 2v3" }],
    ["path", { d: "M16 21v-3a2 2 0 0 1 2-2h3" }]
  ]
};
function Icon(props) {
  const entries = ICON_PATHS[props.name];
  if (entries === void 0) return null;
  const children = entries.map(
    (entry, i) => (0, import_react.createElement)(entry[0], Object.assign({ key: `i${i}` }, entry[1]))
  );
  return (0, import_react.createElement)("svg", {
    viewBox: "0 0 24 24",
    width: props.size || 14,
    height: props.size || 14,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    className: "tcm-icon"
  }, children);
}
function IconBtn(props) {
  return (0, import_react.createElement)("button", {
    type: "button",
    className: props.className || "tcm-btn",
    title: props.title,
    "aria-label": props.title,
    onClick: props.onClick
  }, (0, import_react.createElement)(Icon, { name: props.icon, size: props.size }));
}
function measureSvg(hostEl) {
  if (hostEl === null) return { nw: 0, nh: 0 };
  const svg = hostEl.querySelector("svg");
  if (svg === null) return { nw: 0, nh: 0 };
  let nw = 0;
  let nh = 0;
  const wAttr = svg.getAttribute("width");
  const hAttr = svg.getAttribute("height");
  if (wAttr !== null && !wAttr.includes("%")) nw = parseFloat(wAttr);
  if (hAttr !== null && !hAttr.includes("%")) nh = parseFloat(hAttr);
  if (!(nw > 0)) {
    const vb = svg.viewBox;
    if (vb !== null && vb.baseVal !== void 0) nw = vb.baseVal.width;
  }
  if (!(nh > 0)) {
    const vb = svg.viewBox;
    if (vb !== null && vb.baseVal !== void 0) nh = vb.baseVal.height;
  }
  if (!(nw > 0)) nw = svg.getBoundingClientRect().width;
  if (!(nh > 0)) nh = svg.getBoundingClientRect().height;
  return { nw, nh };
}
function forceStyle(el, props) {
  const style = el.style;
  for (const key of Object.keys(props)) {
    try {
      style.setProperty(key, props[key], "important");
    } catch {
      try {
        el.setAttribute("style", `${String(el.getAttribute("style") || "")};${key}:${props[key]} !important`);
      } catch {
      }
    }
  }
}
function recolorDark(hostEl, colors) {
  if (hostEl === null) return;
  const svg = hostEl.querySelector("svg");
  if (svg === null) return;
  for (const el of Array.from(svg.querySelectorAll("text, tspan"))) {
    forceStyle(el, { fill: colors.text });
  }
  for (const el of Array.from(svg.querySelectorAll(".node > rect, .node > circle, .node > ellipse, .node > polygon, .node > path, .actor > rect, .note > rect, .entityBox > rect, .attributeBox > rect, .task > rect, .section > rect"))) {
    forceStyle(el, { fill: colors.shape, stroke: colors.stroke });
  }
  for (const el of Array.from(svg.querySelectorAll(".cluster > rect, .cluster > polygon, .cluster > path"))) {
    forceStyle(el, { fill: colors.cluster, stroke: colors.stroke });
  }
  for (const el of Array.from(svg.querySelectorAll(".edgePath path, .flowchart-link path, .relation path"))) {
    forceStyle(el, { stroke: colors.edge, fill: "none" });
  }
  for (const el of Array.from(svg.querySelectorAll("marker path"))) {
    forceStyle(el, { fill: colors.edge, stroke: "none" });
  }
  for (const el of Array.from(svg.querySelectorAll(".edgeLabel rect"))) {
    forceStyle(el, { fill: colors.cluster, stroke: "none" });
  }
}
var svgSeq = 0;
var svgSalt = Math.random().toString(36).slice(2, 8);
async function renderOne(source, dark, cfg, signal) {
  const { diagram, injected } = buildDarkInjection(source, dark, cfg.themeAuto);
  try {
    const res = await fetch(RENDER_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        diagram_source: diagram,
        diagram_type: "mermaid",
        output_format: "svg"
      }),
      signal
    });
    const text = await res.text();
    const svgText = text.replace(/^\uFEFF/, "").trimStart();
    if (res.ok && svgText.startsWith("<svg")) {
      svgSeq += 1;
      return { ok: true, svg: uniquifySvgIds(svgText, `tcm-svg-${svgSalt}-${svgSeq.toString(36)}`), darkRendered: injected };
    }
    return { ok: false, error: summarizeError(text || `HTTP ${res.status}`) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "\u6E32\u67D3\u8D85\u65F6" };
    }
    return { ok: false, error: summarizeError(error instanceof Error ? error.message : String(error)) };
  }
}
function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => ({ ok: true, error: "" })).catch((error) => ({ ok: false, error: String(error instanceof Error && error.message || error) }));
  }
  return Promise.resolve({ ok: false, error: "clipboard unavailable" });
}
function DiagramCard(props) {
  const result = props.result;
  const cfg = props.cfg;
  const [showSource, setShowSource] = (0, import_react.useState)(false);
  const [copyNote, setCopyNote] = (0, import_react.useState)("");
  const [mode, setMode] = (0, import_react.useState)("fit");
  const [metrics, setMetrics] = (0, import_react.useState)({ nw: 0, nh: 0 });
  const [fitScale, setFitScale] = (0, import_react.useState)(0);
  const [zoom, setZoom] = (0, import_react.useState)({ s: 1, x: 0, y: 0 });
  const svgHostRef = (0, import_react.useRef)(null);
  const fitBoxRef = (0, import_react.useRef)(null);
  const zoomBoxRef = (0, import_react.useRef)(null);
  const dragRef = (0, import_react.useRef)(null);
  const cardDark = result.ok === true && result.darkRendered === true;
  const svg = result.ok === true ? result.svg : "";
  (0, import_react.useEffect)(() => {
    if (cardDark) recolorDark(svgHostRef.current, cfg.darkColors);
    const m = measureSvg(svgHostRef.current);
    if (m.nw > 0 && m.nh > 0) setMetrics(m);
  }, [svg, showSource, mode, cardDark, cfg]);
  (0, import_react.useEffect)(() => {
    if (!(metrics.nw > 0) || fitBoxRef.current === null) return;
    const r = fitBoxRef.current.getBoundingClientRect();
    setFitScale(fitScaleFor(metrics.nw, metrics.nh, r.width, cfg.fitMaxHeight, cfg.zoomMinScale));
  }, [metrics, showSource, cfg]);
  (0, import_react.useEffect)(() => {
    if (mode !== "zoom") return void 0;
    const box = zoomBoxRef.current;
    if (box === null) return void 0;
    const r = box.getBoundingClientRect();
    const s = fitScaleFor(metrics.nw, metrics.nh, r.width, r.height, cfg.zoomMinScale);
    const rs = s > 0 ? s : 1;
    const centered = metrics.nw > 0;
    setZoom({
      s: rs,
      x: centered ? (r.width - metrics.nw * rs) / 2 : 0,
      y: centered ? (r.height - metrics.nh * rs) / 2 : 0
    });
    const onWheel = (e) => {
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setZoom((z) => {
        const factor = e.deltaY > 0 ? 0.85 : 1.18;
        const ns = clamp(z.s * factor, cfg.zoomMinScale, cfg.zoomMaxScale);
        const k = ns / z.s;
        return { s: ns, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k };
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    const onKey = (e) => {
      if (e.key === "Escape") setMode("fit");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      box.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode, metrics, cfg]);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (target instanceof Element && typeof target.closest === "function" && target.closest(".tcm-toolbar") !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: zoom.x, oy: zoom.y };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (d === null) return;
    setZoom((z) => ({ s: z.s, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const zoomBy = (factor) => {
    const box = zoomBoxRef.current;
    if (box === null) return;
    const r = box.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    setZoom((z) => {
      const ns = clamp(z.s * factor, cfg.zoomMinScale, cfg.zoomMaxScale);
      const k = ns / z.s;
      return { s: ns, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k };
    });
  };
  const zoomReset = () => {
    const box = zoomBoxRef.current;
    if (box === null) return;
    const r = box.getBoundingClientRect();
    const s = fitScaleFor(metrics.nw, metrics.nh, r.width, r.height, cfg.zoomMinScale);
    const rs = s > 0 ? s : 1;
    const centered = metrics.nw > 0;
    setZoom({
      s: rs,
      x: centered ? (r.width - metrics.nw * rs) / 2 : 0,
      y: centered ? (r.height - metrics.nh * rs) / 2 : 0
    });
  };
  const svgHtml = { __html: svg };
  const canZoom = result.ok === true && !showSource;
  const head = (0, import_react.createElement)(
    "div",
    { className: "tcm-card-head" },
    (0, import_react.createElement)("span", { className: "tcm-card-title" }, "Mermaid \u56FE"),
    (0, import_react.createElement)(IconBtn, {
      icon: "code",
      title: showSource ? "\u6536\u8D77\u6E90\u7801" : "\u67E5\u770B\u6E90\u7801",
      onClick: () => setShowSource((s) => !s)
    }),
    (0, import_react.createElement)(IconBtn, {
      icon: copyNote === "done" ? "check" : "copy",
      title: "\u590D\u5236\u6E90\u7801",
      onClick: () => {
        setCopyNote("pending");
        void copyText(props.source).then((r) => setCopyNote(r.ok === true ? "done" : "fail"));
      }
    }),
    canZoom ? (0, import_react.createElement)(IconBtn, {
      icon: mode === "zoom" ? "minimize" : "zoomIn",
      title: mode === "zoom" ? "\u6536\u8D77" : "\u653E\u5927\u67E5\u770B",
      onClick: () => setMode(mode === "zoom" ? "fit" : "zoom")
    }) : null
  );
  let body;
  if (showSource) {
    body = (0, import_react.createElement)("pre", { className: "tcm-source" }, props.source);
  } else if (result.ok === true) {
    if (mode === "zoom") {
      const innerStyle = {
        position: "absolute",
        left: 0,
        top: 0,
        width: metrics.nw > 0 ? metrics.nw : "100%",
        height: metrics.nh > 0 ? metrics.nh : "100%",
        transform: `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`,
        transformOrigin: "0 0"
      };
      body = (0, import_react.createElement)(
        "div",
        {
          className: "tcm-zoom",
          ref: zoomBoxRef,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onDoubleClick: zoomReset,
          role: "region",
          "aria-label": "Mermaid \u56FE\u7F29\u653E\u753B\u5E03(\u62D6\u52A8\u5E73\u79FB\u3001\u6EDA\u8F6E\u7F29\u653E\u3001\u53CC\u51FB\u9002\u914D\u3001Esc \u9000\u51FA)"
        },
        (0, import_react.createElement)("div", { ref: svgHostRef, style: innerStyle, className: "tcm-svg-layer", dangerouslySetInnerHTML: svgHtml }),
        (0, import_react.createElement)(
          "div",
          { className: "tcm-toolbar" },
          (0, import_react.createElement)(IconBtn, { className: "tcm-tool-btn", icon: "plus", size: 15, title: "\u653E\u5927", onClick: () => zoomBy(1.3) }),
          (0, import_react.createElement)(IconBtn, { className: "tcm-tool-btn", icon: "minus", size: 15, title: "\u7F29\u5C0F", onClick: () => zoomBy(0.77) }),
          (0, import_react.createElement)(IconBtn, { className: "tcm-tool-btn", icon: "maximize", size: 15, title: "\u9002\u5E94\u7A97\u53E3", onClick: zoomReset })
        ),
        (0, import_react.createElement)("div", { className: "tcm-hint" }, "\u62D6\u52A8\u5E73\u79FB \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u53CC\u51FB\u9002\u914D \xB7 Esc \u9000\u51FA")
      );
    } else {
      const s = fitScale > 0 ? fitScale : 0;
      const innerStyle = s > 0 ? {
        position: "absolute",
        left: 0,
        top: 0,
        width: metrics.nw,
        height: metrics.nh,
        transform: `scale(${s})`,
        transformOrigin: "0 0"
      } : { width: "100%" };
      const stageStyle = s > 0 ? { width: Math.round(metrics.nw * s), height: Math.round(metrics.nh * s), position: "relative" } : { position: "relative" };
      body = (0, import_react.createElement)(
        "div",
        { className: "tcm-fit", ref: fitBoxRef },
        (0, import_react.createElement)(
          "div",
          { style: stageStyle },
          (0, import_react.createElement)("div", { ref: svgHostRef, style: innerStyle, className: "tcm-svg-layer", dangerouslySetInnerHTML: svgHtml })
        )
      );
    }
  } else {
    body = (0, import_react.createElement)("div", { className: "tcm-error" }, `\u6E32\u67D3\u5931\u8D25: ${result.error || "\u672A\u77E5\u9519\u8BEF"}`);
  }
  return (0, import_react.createElement)("div", { className: `tcm-card${cardDark ? " tcm-card-dark" : ""}` }, head, body);
}
function subscribeTheme(ctx, listener) {
  const emitter = ctx;
  return emitter.on("theme/change", (snap) => listener(snap));
}
function MermaidInline(props) {
  const [state, setState] = (0, import_react.useState)({
    status: "loading",
    result: null,
    error: null
  });
  const [attempt, setAttempt] = (0, import_react.useState)(0);
  const [cfg, setCfg] = (0, import_react.useState)(() => configNow());
  const [themeSnap, setThemeSnap] = (0, import_react.useState)(() => {
    const svc = props.themeSvc;
    if (svc !== void 0 && svc !== null && typeof svc.getTheme === "function") {
      try {
        return svc.getTheme();
      } catch {
        return null;
      }
    }
    return null;
  });
  const dark = themeSnap?.active?.colorScheme === "dark";
  (0, import_react.useEffect)(() => {
    const cordisCtx = props.cordisCtx;
    if (cordisCtx === void 0 || cordisCtx === null) return void 0;
    const off = subscribeTheme(cordisCtx, (snap) => setThemeSnap(snap));
    return () => {
      off();
    };
  }, []);
  (0, import_react.useEffect)(() => subscribeConfig(() => setCfg(configNow())), []);
  (0, import_react.useEffect)(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.renderTimeoutMs);
    setState({ status: "loading", result: null, error: null });
    void renderOne(props.source, dark, cfg, controller.signal).then((result) => {
      if (!alive) return;
      setState({ status: "done", result, error: null });
    }).catch((error) => {
      if (!alive) return;
      setState({ status: "error", result: null, error: summarizeError(error instanceof Error ? error.message : String(error)) });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [props.source, dark, attempt, cfg]);
  if (state.status === "loading") {
    return (0, import_react.createElement)("div", { className: "tcm-note" }, "\u6B63\u5728\u6E32\u67D3 Mermaid \u56FE\u2026");
  }
  if (state.status === "error" || state.result === null) {
    return (0, import_react.createElement)(
      "div",
      { className: "tcm-error" },
      `\u6E32\u67D3\u5931\u8D25: ${state.error || "\u672A\u77E5\u9519\u8BEF"}`,
      (0, import_react.createElement)("button", {
        type: "button",
        className: "tcm-retry",
        onClick: () => setAttempt((a) => a + 1)
      }, "\u91CD\u8BD5")
    );
  }
  return (0, import_react.createElement)(DiagramCard, { source: props.source, result: state.result, cfg });
}
var mountBlocks = /* @__PURE__ */ new WeakMap();
var mountRoots = /* @__PURE__ */ new WeakMap();
function blockLang(block) {
  const wrap = block.firstElementChild;
  const banner = wrap === null ? null : wrap.firstElementChild;
  const info = banner === null ? null : banner.firstElementChild;
  return info === null ? "" : String(info.textContent || "").trim();
}
function readSource(block) {
  const pre = block.querySelector("pre");
  if (pre === null) return "";
  let text = String(pre.textContent || "");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return text;
}
function removeMount(mount) {
  const root = mountRoots.get(mount);
  if (root !== void 0) {
    try {
      root.unmount();
    } catch {
    }
  }
  mount.remove();
}
function unhideBlock(block) {
  ;
  block.style.display = "";
  delete block.dataset.tcmReplaced;
}
function replaceBlock(block, inlineProps) {
  const source = readSource(block);
  if (source.length === 0) return;
  const blockEl = block;
  blockEl.dataset.tcmReplaced = "1";
  blockEl.style.display = "none";
  const mount = document.createElement("div");
  mount.className = MOUNT_CLASS;
  block.parentNode?.insertBefore(mount, block.nextSibling);
  mountBlocks.set(mount, block);
  try {
    const root = (0, import_client.createRoot)(mount);
    mountRoots.set(mount, root);
    root.render((0, import_react.createElement)(MermaidInline, { ...inlineProps, source }));
  } catch {
    mount.textContent = "Mermaid \u6E32\u67D3\u6302\u8F7D\u5931\u8D25";
  }
}
function syncRow(row, inlineProps) {
  const mounts = Array.from(row.querySelectorAll(`.${MOUNT_CLASS}`));
  for (const mount of mounts) {
    const block = mountBlocks.get(mount);
    const healthy = block !== void 0 && block.isConnected && mount.previousElementSibling === block && block.style.display === "none" && block.dataset.tcmReplaced === "1";
    if (!healthy) removeMount(mount);
  }
  const blocks = Array.from(row.querySelectorAll(`.${CODE_BLOCK_CLASS}`));
  for (const block of blocks) {
    if (blockLang(block) !== "mermaid") continue;
    const mark = block.dataset.tcmReplaced === "1";
    const next = block.nextElementSibling;
    const healthy = mark && block.style.display === "none" && next !== null && next.classList.contains(MOUNT_CLASS) && mountBlocks.get(next) === block && mountRoots.has(next);
    if (healthy) continue;
    if (mark) unhideBlock(block);
    if (next !== null && next.classList.contains(MOUNT_CLASS)) removeMount(next);
    replaceBlock(block, inlineProps);
  }
}
function collectTurnRows(tailRow) {
  const rows = [];
  let cur = tailRow;
  while (cur !== null) {
    rows.push(cur);
    cur = cur.previousElementSibling;
    if (cur !== null && cur.getAttribute("data-chat-flow-kind") === "turn-tail") break;
  }
  return rows;
}
function restoreRows(rows) {
  for (const row of rows) {
    if (!row.isConnected) continue;
    for (const mount of Array.from(row.querySelectorAll(`.${MOUNT_CLASS}`))) {
      removeMount(mount);
    }
    for (const block of Array.from(row.querySelectorAll(`.${CODE_BLOCK_CLASS}`))) {
      if (block.dataset.tcmReplaced === "1") unhideBlock(block);
    }
  }
}
function MermaidDriver(props) {
  const anchorRef = (0, import_react.useRef)(null);
  (0, import_react.useLayoutEffect)(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return void 0;
    const tailRow = anchor.closest("[data-chat-flow-kind]");
    if (tailRow === null || tailRow.parentElement === null) return void 0;
    const list = tailRow.parentElement;
    const inlineProps = { themeSvc: props.themeSvc, cordisCtx: props.cordisCtx };
    let rafPending = false;
    const scan = () => {
      const rows = collectTurnRows(tailRow);
      for (const row of rows) {
        if (row.isConnected) syncRow(row, inlineProps);
      }
    };
    scan();
    const observer = new MutationObserver(() => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        scan();
      });
    });
    observer.observe(list, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      restoreRows(collectTurnRows(tailRow));
    };
  }, []);
  return (0, import_react.createElement)("span", { ref: anchorRef, style: { display: "none" } });
}
function buildCss(cfg) {
  const d = cfg.darkColors;
  return [
    `.tcm-mount{display:block;margin:8px 0}`,
    `.tcm-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));overflow:hidden}`,
    `.tcm-card-head{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2))}`,
    `.tcm-card-title{flex:1;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98)}`,
    `.tcm-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px;padding:0;font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary,#8a8f98);background:transparent;border:none;cursor:pointer;border-radius:6px}`,
    `.tcm-btn:hover{color:var(--dsw-alias-brand-primary,#4a7dff);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14))}`,
    `.tcm-btn:focus-visible,.tcm-tool-btn:focus-visible,.tcm-retry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7dff);outline-offset:2px}`,
    `.tcm-icon{display:block}`,
    `.tcm-fit{position:relative;overflow:hidden;background:#ffffff;max-height:${cfg.fitMaxHeight}px;display:flex;justify-content:center}`,
    `.tcm-fit svg{max-width:100%;height:auto;display:block}`,
    `.tcm-zoom{position:relative;overflow:hidden;background:#ffffff;height:clamp(320px,62vh,${cfg.zoomBoxHeight}px);touch-action:none;cursor:grab;user-select:none}`,
    `.tcm-zoom:active{cursor:grabbing}`,
    `.tcm-svg-layer svg{display:block}`,
    `.tcm-toolbar{position:absolute;top:8px;right:8px;display:flex;gap:2px;padding:3px;border-radius:8px;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.94));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));box-shadow:0 2px 10px rgba(0,0,0,.14);z-index:2}`,
    `.tcm-tool-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:0;color:var(--dsw-alias-label-primary,#333);background:transparent;border:none;border-radius:6px;cursor:pointer}`,
    `.tcm-tool-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));color:var(--dsw-alias-brand-primary,#4a7dff)}`,
    `.tcm-hint{position:absolute;left:8px;bottom:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.9));padding:2px 8px;border-radius:6px;pointer-events:none;z-index:2}`,
    `.tcm-source{margin:0;padding:12px 14px;font-size:12px;line-height:1.55;overflow:auto;max-height:340px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,inherit);white-space:pre}`,
    `.tcm-note{font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98);padding:4px 2px}`,
    `.tcm-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#d4380d);padding:10px 12px}`,
    `.tcm-retry{margin-left:10px;font-size:12px;color:var(--dsw-alias-brand-primary,#4a7dff);background:transparent;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.4));border-radius:6px;padding:2px 10px;cursor:pointer}`,
    `.tcm-card-dark .tcm-fit,.tcm-card-dark .tcm-zoom{background:${d.canvas}}`,
    `@media (prefers-reduced-motion: reduce){.tcm-btn,.tcm-tool-btn,.tcm-retry{transition:none}}`
  ].join("\n");
}
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  const styleTag = document.createElement("style");
  styleTag.setAttribute("data-plugin", "dsh-mermaid-renderer");
  styleTag.textContent = buildCss(CLIENT_DEFAULTS);
  ctx.effect(() => {
    document.head.appendChild(styleTag);
    return () => {
      styleTag.remove();
    };
  }, "dsh-mermaid-renderer: base styles");
  void loadClientConfig().then((cfg) => {
    setLiveConfig(cfg);
    if (styleTag.isConnected) styleTag.textContent = buildCss(cfg);
  }).catch(() => {
  });
  const themeSvc = ctx.get("theme");
  const driverProps = { themeSvc, cordisCtx: ctx };
  slots.inject(SLOT_NAME, () => slots.register(
    { name: SLOT_NAME, id: SLOT_ID, order: SLOT_ORDER },
    (props) => (0, import_react.createElement)(MermaidDriver, { ...props, ...driverProps })
  ));
}
var inject = ["slots"];
var name = "dsh-mermaid-renderer";
    return module.exports;
  },
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2NsaWVudC50cyIsICIuLi9zcmMvc2hhcmVkL2NsaWVudC1jb25maWcudHMiLCAiLi4vc3JjL3NoYXJlZC9kaWFncmFtLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIGRzaC1tZXJtYWlkLXJlbmRlcmVyIFx1MjAxNCBjbGllbnQgXHU1MzRBXHU4RkI5Olx1NjI4QVx1NTJBOVx1NjI0Qlx1NkQ4OFx1NjA2Rlx1OTFDQ1x1NzY4NCBgYGBtZXJtYWlkIFx1NEVFM1x1NzgwMVx1NTc1N1xuICogXHU1MzlGXHU0RjREXHU2NkZGXHU2MzYyXHU2MjEwXHU1M0VGXHU0RUE0XHU0RTkyIFNWRyBcdTUzNjFcdTcyNDcoXHU5MDAyXHU5MTREL1x1N0YyOVx1NjUzRS9cdTVFNzNcdTc5RkJcdTMwMDFcdTZFOTBcdTc4MDFcdTY3RTVcdTc3MEJcdTMwMDFcdTU5MERcdTUyMzZcdTMwMDFcdTkxQ0RcdThCRDUpLFxuICogXHU4RERGXHU5NjhGIEdVSSBcdTRFM0JcdTk4OTgsXHU2RTMyXHU2N0QzXHU4RDcwIGhvc3QgXHU1NDBDXHU2RTkwXHU0RUUzXHU3NDA2XHUzMDAyXG4gKlxuICogXHU5MTREXHU3RjZFXHU1OTUxXHU3RUE2OmNsaWVudCBidW5kbGUgXHU2NUUwXHU2Q0Q1XHU2MkZGXHU1MjMwIGhvc3QgXHU0RkE3XHU3Njg0XHU2M0QyXHU0RUY2XHU5MTREXHU3RjZFKGJvb3QgZ3JhcGggXHU1M0VBXHU1NDJCXG4gKiBpZC91cmwvcmV2L2luamVjdC9pbW1lZGlhdGVseSksXHU2MjQwXHU0RUU1XHU1NDJGXHU1MkE4XHU2NUY2XHU0RUNFIGhvc3QgXHU3Njg0IGNsaWVudC1jb25maWcgXHU3QUVGXHU3MEI5XG4gKiBcdTYyQzlcdTUzRDZcdTkxNERcdTdGNkVcdTVGRUJcdTcxNjcsXHU1OTMxXHU4RDI1XHU1MjE5XHU1NkRFXHU5MDAwXHU1MjMwXHU3RjE2XHU4QkQxXHU2NzFGXHU5RUQ4XHU4QkE0XHU1MDNDKFx1NEUwRSBob3N0IHNjaGVtYSBcdTlFRDhcdThCQTRcdTUwM0NcdTRFMDBcdTgxRjQpXHUzMDAyXG4gKlxuICogXHU1RTczXHU1M0YwXHU3RUFGXHU1RUE2Olx1NTAzQyBpbXBvcnQgXHU1M0VBXHU2NzA5IHJlYWN0IC8gcmVhY3QtZG9tL2NsaWVudChcdTVFNzNcdTUzRjBcdTZBMjFcdTU3NTdcdTg4Njggc2VlZCBcdThCQ0QpLFxuICogQGRlZXBzZWVrLWFpL2NvcmRpcyBcdTRFQzUgdHlwZS1vbmx5O1x1OERFOFx1NTMwNVx1NTM0Rlx1NEY1Q1x1OEQ3MCBzbG90cyBzZXJ2aWNlXHUzMDAyXG4gKi9cbmltcG9ydCB7IGNyZWF0ZUVsZW1lbnQsIHVzZUVmZmVjdCwgdXNlTGF5b3V0RWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlLCB0eXBlIFJlYWN0Tm9kZSB9IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgY3JlYXRlUm9vdCwgdHlwZSBSb290IH0gZnJvbSAncmVhY3QtZG9tL2NsaWVudCdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BkZWVwc2Vlay1haS9jb3JkaXMnXG5pbXBvcnQgeyBDTElFTlRfREVGQVVMVFMsIHNhbml0aXplQ2xpZW50Q29uZmlnLCB0eXBlIENsaWVudENvbmZpZywgdHlwZSBEYXJrQ29sb3JzIH0gZnJvbSAnLi9zaGFyZWQvY2xpZW50LWNvbmZpZydcbmltcG9ydCB7IGJ1aWxkRGFya0luamVjdGlvbiwgY2xhbXAsIGZpdFNjYWxlRm9yLCBzdW1tYXJpemVFcnJvciwgdW5pcXVpZnlTdmdJZHMgfSBmcm9tICcuL3NoYXJlZC9kaWFncmFtJ1xuXG4vLyBcdTI1MDBcdTI1MDAgXHU1OTUxXHU3RUE2XHU1RTM4XHU5MUNGIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuY29uc3QgTU9VTlRfQ0xBU1MgPSAndGNtLW1vdW50J1xuY29uc3QgQ09ERV9CTE9DS19DTEFTUyA9ICdtZC1jb2RlLWJsb2NrJ1xuY29uc3QgU0xPVF9OQU1FID0gJ2NvbnZlcnNhdGlvbi5jaGF0LmFzc2lzdGFudC1hY3Rpb25zJ1xuY29uc3QgU0xPVF9JRCA9ICdtZXJtYWlkLWlubGluZSdcbmNvbnN0IFNMT1RfT1JERVIgPSA5MFxuY29uc3QgUkVOREVSX0VORFBPSU5UID0gJy9wbHVnaW5zL2RzaC1tZXJtYWlkLXJlbmRlcmVyL3JlbmRlcidcbmNvbnN0IENPTkZJR19FTkRQT0lOVCA9ICcvcGx1Z2lucy9kc2gtbWVybWFpZC1yZW5kZXJlci9jbGllbnQtY29uZmlnJ1xuY29uc3QgQ09ORklHX0ZFVENIX1RJTUVPVVRfTVMgPSA1MDAwXG5cbi8vIFx1MjUwMFx1MjUwMCBcdThGRDBcdTg4NENcdTY1RjZcdTU5NTFcdTdFQTYoXHU3RUQzXHU2Nzg0XHU2MDI3XHU3QzdCXHU1NzhCLFx1NTk1MVx1N0VBNlx1OTc2Mlx1ODlDMSBkc2gtY2xpZW50LXVpLXNsb3RzIC8gaG9zdCBcdTUzNEFcdThGQjkpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuaW50ZXJmYWNlIFRoZW1lU25hcHNob3Qge1xuICBhY3RpdmU/OiB7IGNvbG9yU2NoZW1lPzogJ2xpZ2h0JyB8ICdkYXJrJyB9IHwgbnVsbFxufVxudHlwZSBUaGVtZVNuYXBzaG90T3JOdWxsID0gVGhlbWVTbmFwc2hvdCB8IG51bGxcbmludGVyZmFjZSBUaGVtZVNlcnZpY2Uge1xuICBnZXRUaGVtZSgpOiBUaGVtZVNuYXBzaG90XG59XG5pbnRlcmZhY2UgU2xvdFJlZ2lzdGVyT3B0aW9ucyB7XG4gIG5hbWU6IHN0cmluZ1xuICBpZD86IHN0cmluZ1xuICBvcmRlcj86IG51bWJlclxuICBsYWJlbD86IHN0cmluZ1xufVxudHlwZSBTbG90Q29tcG9uZW50ID0gKHByb3BzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdW5rbm93blxuaW50ZXJmYWNlIFNsb3RzU2VydmljZSB7XG4gIGluamVjdChrZXk6IHN0cmluZywgZmFjdG9yeTogKCkgPT4gdm9pZCB8ICgoKSA9PiB2b2lkKSk6IHZvaWRcbiAgcmVnaXN0ZXIob3B0aW9uczogU2xvdFJlZ2lzdGVyT3B0aW9ucywgY29tcG9uZW50OiBTbG90Q29tcG9uZW50KTogKCkgPT4gdm9pZFxufVxuXG50eXBlIFJlbmRlclJlc3VsdCA9XG4gIHwgeyBvazogdHJ1ZTsgc3ZnOiBzdHJpbmc7IGRhcmtSZW5kZXJlZDogYm9vbGVhbiB9XG4gIHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfVxuXG5pbnRlcmZhY2UgTWVybWFpZElubGluZVByb3BzIHtcbiAgc291cmNlOiBzdHJpbmdcbiAgdGhlbWVTdmM/OiBUaGVtZVNlcnZpY2VcbiAgY29yZGlzQ3R4PzogQ29udGV4dFxufVxuXG4vLyBcdTI1MDBcdTI1MDAgXHU5MTREXHU3RjZFXHU1QjU4XHU1MEE4OmFwcGx5IFx1NjVGNlx1NjJDOVx1NTNENiBob3N0IFx1OTE0RFx1N0Y2RVx1NUZFQlx1NzE2NyxcdTYyMTBcdTUyOUZcdTUyNERcdTc1MjhcdTdGMTZcdThCRDFcdTY3MUZcdTlFRDhcdThCQTRcdTUwM0MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5sZXQgbGl2ZUNvbmZpZzogQ2xpZW50Q29uZmlnID0gQ0xJRU5UX0RFRkFVTFRTXG5jb25zdCBjb25maWdMaXN0ZW5lcnMgPSBuZXcgU2V0PCgpID0+IHZvaWQ+KClcblxuZnVuY3Rpb24gc2V0TGl2ZUNvbmZpZyhjZmc6IENsaWVudENvbmZpZyk6IHZvaWQge1xuICBsaXZlQ29uZmlnID0gY2ZnXG4gIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgY29uZmlnTGlzdGVuZXJzKSBsaXN0ZW5lcigpXG59XG5cbmZ1bmN0aW9uIHN1YnNjcmliZUNvbmZpZyhsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICBjb25maWdMaXN0ZW5lcnMuYWRkKGxpc3RlbmVyKVxuICByZXR1cm4gKCkgPT4ge1xuICAgIGNvbmZpZ0xpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpXG4gIH1cbn1cblxuZnVuY3Rpb24gY29uZmlnTm93KCk6IENsaWVudENvbmZpZyB7XG4gIHJldHVybiBsaXZlQ29uZmlnXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRDbGllbnRDb25maWcoKTogUHJvbWlzZTxDbGllbnRDb25maWc+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBDT05GSUdfRkVUQ0hfVElNRU9VVF9NUylcbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChDT05GSUdfRU5EUE9JTlQsIHtcbiAgICAgIGhlYWRlcnM6IHsgYWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicgfSxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfSlcbiAgICBpZiAoIXJlcy5vaykgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzLnN0YXR1c31gKVxuICAgIHJldHVybiBzYW5pdGl6ZUNsaWVudENvbmZpZyhhd2FpdCByZXMuanNvbigpKVxuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgfVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgXHU1NkZFXHU2ODA3IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuY29uc3QgSUNPTl9QQVRIUzogUmVjb3JkPHN0cmluZywgW3N0cmluZywgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPl1bXT4gPSB7XG4gIGNvZGU6IFtcbiAgICBbJ3BvbHlsaW5lJywgeyBwb2ludHM6ICcxNiAxOCAyMiAxMiAxNiA2JyB9XSxcbiAgICBbJ3BvbHlsaW5lJywgeyBwb2ludHM6ICc4IDYgMiAxMiA4IDE4JyB9XSxcbiAgXSxcbiAgY29weTogW1xuICAgIFsncmVjdCcsIHsgeDogJzknLCB5OiAnOScsIHdpZHRoOiAnMTMnLCBoZWlnaHQ6ICcxMycsIHJ4OiAnMicgfV0sXG4gICAgWydwYXRoJywgeyBkOiAnTTUgMTVINGEyIDIgMCAwIDEtMi0yVjRhMiAyIDAgMCAxIDItMmg5YTIgMiAwIDAgMSAyIDJ2MScgfV0sXG4gIF0sXG4gIGNoZWNrOiBbWydwb2x5bGluZScsIHsgcG9pbnRzOiAnMjAgNiA5IDE3IDQgMTInIH1dXSxcbiAgem9vbUluOiBbXG4gICAgWydjaXJjbGUnLCB7IGN4OiAnMTEnLCBjeTogJzExJywgcjogJzgnIH1dLFxuICAgIFsnbGluZScsIHsgeDE6ICcyMScsIHkxOiAnMjEnLCB4MjogJzE2LjY1JywgeTI6ICcxNi42NScgfV0sXG4gICAgWydsaW5lJywgeyB4MTogJzExJywgeTE6ICc4JywgeDI6ICcxMScsIHkyOiAnMTQnIH1dLFxuICAgIFsnbGluZScsIHsgeDE6ICc4JywgeTE6ICcxMScsIHgyOiAnMTQnLCB5MjogJzExJyB9XSxcbiAgXSxcbiAgem9vbU91dDogW1xuICAgIFsnY2lyY2xlJywgeyBjeDogJzExJywgY3k6ICcxMScsIHI6ICc4JyB9XSxcbiAgICBbJ2xpbmUnLCB7IHgxOiAnMjEnLCB5MTogJzIxJywgeDI6ICcxNi42NScsIHkyOiAnMTYuNjUnIH1dLFxuICAgIFsnbGluZScsIHsgeDE6ICc4JywgeTE6ICcxMScsIHgyOiAnMTQnLCB5MjogJzExJyB9XSxcbiAgXSxcbiAgcGx1czogW1xuICAgIFsnbGluZScsIHsgeDE6ICcxMicsIHkxOiAnNScsIHgyOiAnMTInLCB5MjogJzE5JyB9XSxcbiAgICBbJ2xpbmUnLCB7IHgxOiAnNScsIHkxOiAnMTInLCB4MjogJzE5JywgeTI6ICcxMicgfV0sXG4gIF0sXG4gIG1pbnVzOiBbWydsaW5lJywgeyB4MTogJzUnLCB5MTogJzEyJywgeDI6ICcxOScsIHkyOiAnMTInIH1dXSxcbiAgbWF4aW1pemU6IFtcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNOCAzSDVhMiAyIDAgMCAwLTIgMnYzJyB9XSxcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNMjEgOFY1YTIgMiAwIDAgMC0yLTJoLTMnIH1dLFxuICAgIFsncGF0aCcsIHsgZDogJ00zIDE2djNhMiAyIDAgMCAwIDIgMmgzJyB9XSxcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNMTYgMjFoM2EyIDIgMCAwIDAgMi0ydi0zJyB9XSxcbiAgXSxcbiAgbWluaW1pemU6IFtcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNOCAzdjNhMiAyIDAgMCAxLTIgMkgzJyB9XSxcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNMjEgOGgtM2EyIDIgMCAwIDEtMi0yVjMnIH1dLFxuICAgIFsncGF0aCcsIHsgZDogJ00zIDE2aDNhMiAyIDAgMCAxIDIgMnYzJyB9XSxcbiAgICBbJ3BhdGgnLCB7IGQ6ICdNMTYgMjF2LTNhMiAyIDAgMCAxIDItMmgzJyB9XSxcbiAgXSxcbn1cblxuZnVuY3Rpb24gSWNvbihwcm9wczogeyBuYW1lOiBzdHJpbmc7IHNpemU/OiBudW1iZXIgfSkge1xuICBjb25zdCBlbnRyaWVzID0gSUNPTl9QQVRIU1twcm9wcy5uYW1lXVxuICBpZiAoZW50cmllcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCBjaGlsZHJlbiA9IGVudHJpZXMubWFwKChlbnRyeSwgaSkgPT5cbiAgICBjcmVhdGVFbGVtZW50KGVudHJ5WzBdLCBPYmplY3QuYXNzaWduKHsga2V5OiBgaSR7aX1gIH0sIGVudHJ5WzFdKSksXG4gIClcbiAgcmV0dXJuIGNyZWF0ZUVsZW1lbnQoJ3N2ZycsIHtcbiAgICB2aWV3Qm94OiAnMCAwIDI0IDI0JyxcbiAgICB3aWR0aDogcHJvcHMuc2l6ZSB8fCAxNCxcbiAgICBoZWlnaHQ6IHByb3BzLnNpemUgfHwgMTQsXG4gICAgZmlsbDogJ25vbmUnLFxuICAgIHN0cm9rZTogJ2N1cnJlbnRDb2xvcicsXG4gICAgc3Ryb2tlV2lkdGg6IDEuOCxcbiAgICBzdHJva2VMaW5lY2FwOiAncm91bmQnLFxuICAgIHN0cm9rZUxpbmVqb2luOiAncm91bmQnLFxuICAgICdhcmlhLWhpZGRlbic6ICd0cnVlJyxcbiAgICBjbGFzc05hbWU6ICd0Y20taWNvbicsXG4gIH0sIGNoaWxkcmVuKVxufVxuXG5mdW5jdGlvbiBJY29uQnRuKHByb3BzOiB7XG4gIGljb246IHN0cmluZ1xuICB0aXRsZTogc3RyaW5nXG4gIHNpemU/OiBudW1iZXJcbiAgY2xhc3NOYW1lPzogc3RyaW5nXG4gIG9uQ2xpY2s/OiAoKSA9PiB2b2lkXG59KSB7XG4gIHJldHVybiBjcmVhdGVFbGVtZW50KCdidXR0b24nLCB7XG4gICAgdHlwZTogJ2J1dHRvbicsXG4gICAgY2xhc3NOYW1lOiBwcm9wcy5jbGFzc05hbWUgfHwgJ3RjbS1idG4nLFxuICAgIHRpdGxlOiBwcm9wcy50aXRsZSxcbiAgICAnYXJpYS1sYWJlbCc6IHByb3BzLnRpdGxlLFxuICAgIG9uQ2xpY2s6IHByb3BzLm9uQ2xpY2ssXG4gIH0sIGNyZWF0ZUVsZW1lbnQoSWNvbiwgeyBuYW1lOiBwcm9wcy5pY29uLCBzaXplOiBwcm9wcy5zaXplIH0pKVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgXHU1RUE2XHU5MUNGXHU0RTBFXHU5MUNEXHU3NzQwXHU4MjcyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuZnVuY3Rpb24gbWVhc3VyZVN2Zyhob3N0RWw6IEVsZW1lbnQgfCBudWxsKTogeyBudzogbnVtYmVyOyBuaDogbnVtYmVyIH0ge1xuICBpZiAoaG9zdEVsID09PSBudWxsKSByZXR1cm4geyBudzogMCwgbmg6IDAgfVxuICBjb25zdCBzdmcgPSBob3N0RWwucXVlcnlTZWxlY3Rvcignc3ZnJylcbiAgaWYgKHN2ZyA9PT0gbnVsbCkgcmV0dXJuIHsgbnc6IDAsIG5oOiAwIH1cbiAgbGV0IG53ID0gMFxuICBsZXQgbmggPSAwXG4gIGNvbnN0IHdBdHRyID0gc3ZnLmdldEF0dHJpYnV0ZSgnd2lkdGgnKVxuICBjb25zdCBoQXR0ciA9IHN2Zy5nZXRBdHRyaWJ1dGUoJ2hlaWdodCcpXG4gIGlmICh3QXR0ciAhPT0gbnVsbCAmJiAhd0F0dHIuaW5jbHVkZXMoJyUnKSkgbncgPSBwYXJzZUZsb2F0KHdBdHRyKVxuICBpZiAoaEF0dHIgIT09IG51bGwgJiYgIWhBdHRyLmluY2x1ZGVzKCclJykpIG5oID0gcGFyc2VGbG9hdChoQXR0cilcbiAgaWYgKCEobncgPiAwKSkge1xuICAgIGNvbnN0IHZiID0gKHN2ZyBhcyBTVkdTVkdFbGVtZW50KS52aWV3Qm94XG4gICAgaWYgKHZiICE9PSBudWxsICYmIHZiLmJhc2VWYWwgIT09IHVuZGVmaW5lZCkgbncgPSB2Yi5iYXNlVmFsLndpZHRoXG4gIH1cbiAgaWYgKCEobmggPiAwKSkge1xuICAgIGNvbnN0IHZiID0gKHN2ZyBhcyBTVkdTVkdFbGVtZW50KS52aWV3Qm94XG4gICAgaWYgKHZiICE9PSBudWxsICYmIHZiLmJhc2VWYWwgIT09IHVuZGVmaW5lZCkgbmggPSB2Yi5iYXNlVmFsLmhlaWdodFxuICB9XG4gIGlmICghKG53ID4gMCkpIG53ID0gc3ZnLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLndpZHRoXG4gIGlmICghKG5oID4gMCkpIG5oID0gc3ZnLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLmhlaWdodFxuICByZXR1cm4geyBudywgbmggfVxufVxuXG5mdW5jdGlvbiBmb3JjZVN0eWxlKGVsOiBFbGVtZW50LCBwcm9wczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICBjb25zdCBzdHlsZSA9IChlbCBhcyBIVE1MRWxlbWVudCkuc3R5bGVcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocHJvcHMpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHN0eWxlLnNldFByb3BlcnR5KGtleSwgcHJvcHNba2V5XSwgJ2ltcG9ydGFudCcpXG4gICAgfSBjYXRjaCB7XG4gICAgICB0cnkge1xuICAgICAgICBlbC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgYCR7U3RyaW5nKGVsLmdldEF0dHJpYnV0ZSgnc3R5bGUnKSB8fCAnJyl9OyR7a2V5fToke3Byb3BzW2tleV19ICFpbXBvcnRhbnRgKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIGlnbm9yZSAqL1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vKiogS3Jva2kgZGFyayB0aGVtZSBcdTc2ODQgY2xhc3MgXHU1RTAzXHU1QzQwXHU1NkZBXHU1QjlBLFx1NjMwOVx1OEMwM1x1ODI3Mlx1Njc3Rlx1OTAxMFx1N0M3Qlx1OTFDRFx1Nzc0MFx1ODI3Mlx1MzAwMiAqL1xuZnVuY3Rpb24gcmVjb2xvckRhcmsoaG9zdEVsOiBFbGVtZW50IHwgbnVsbCwgY29sb3JzOiBEYXJrQ29sb3JzKTogdm9pZCB7XG4gIGlmIChob3N0RWwgPT09IG51bGwpIHJldHVyblxuICBjb25zdCBzdmcgPSBob3N0RWwucXVlcnlTZWxlY3Rvcignc3ZnJylcbiAgaWYgKHN2ZyA9PT0gbnVsbCkgcmV0dXJuXG4gIGZvciAoY29uc3QgZWwgb2YgQXJyYXkuZnJvbShzdmcucXVlcnlTZWxlY3RvckFsbCgndGV4dCwgdHNwYW4nKSkpIHtcbiAgICBmb3JjZVN0eWxlKGVsLCB7IGZpbGw6IGNvbG9ycy50ZXh0IH0pXG4gIH1cbiAgZm9yIChjb25zdCBlbCBvZiBBcnJheS5mcm9tKHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCcubm9kZSA+IHJlY3QsIC5ub2RlID4gY2lyY2xlLCAubm9kZSA+IGVsbGlwc2UsIC5ub2RlID4gcG9seWdvbiwgLm5vZGUgPiBwYXRoLCAuYWN0b3IgPiByZWN0LCAubm90ZSA+IHJlY3QsIC5lbnRpdHlCb3ggPiByZWN0LCAuYXR0cmlidXRlQm94ID4gcmVjdCwgLnRhc2sgPiByZWN0LCAuc2VjdGlvbiA+IHJlY3QnKSkpIHtcbiAgICBmb3JjZVN0eWxlKGVsLCB7IGZpbGw6IGNvbG9ycy5zaGFwZSwgc3Ryb2tlOiBjb2xvcnMuc3Ryb2tlIH0pXG4gIH1cbiAgZm9yIChjb25zdCBlbCBvZiBBcnJheS5mcm9tKHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCcuY2x1c3RlciA+IHJlY3QsIC5jbHVzdGVyID4gcG9seWdvbiwgLmNsdXN0ZXIgPiBwYXRoJykpKSB7XG4gICAgZm9yY2VTdHlsZShlbCwgeyBmaWxsOiBjb2xvcnMuY2x1c3Rlciwgc3Ryb2tlOiBjb2xvcnMuc3Ryb2tlIH0pXG4gIH1cbiAgZm9yIChjb25zdCBlbCBvZiBBcnJheS5mcm9tKHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCcuZWRnZVBhdGggcGF0aCwgLmZsb3djaGFydC1saW5rIHBhdGgsIC5yZWxhdGlvbiBwYXRoJykpKSB7XG4gICAgZm9yY2VTdHlsZShlbCwgeyBzdHJva2U6IGNvbG9ycy5lZGdlLCBmaWxsOiAnbm9uZScgfSlcbiAgfVxuICBmb3IgKGNvbnN0IGVsIG9mIEFycmF5LmZyb20oc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJ21hcmtlciBwYXRoJykpKSB7XG4gICAgZm9yY2VTdHlsZShlbCwgeyBmaWxsOiBjb2xvcnMuZWRnZSwgc3Ryb2tlOiAnbm9uZScgfSlcbiAgfVxuICBmb3IgKGNvbnN0IGVsIG9mIEFycmF5LmZyb20oc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJy5lZGdlTGFiZWwgcmVjdCcpKSkge1xuICAgIGZvcmNlU3R5bGUoZWwsIHsgZmlsbDogY29sb3JzLmNsdXN0ZXIsIHN0cm9rZTogJ25vbmUnIH0pXG4gIH1cbn1cblxuLy8gXHUyNTAwXHUyNTAwIFx1NkUzMlx1NjdEMyhcdTU0MENcdTZFOTBcdTRFRTNcdTc0MDYpXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5sZXQgc3ZnU2VxID0gMFxuLy8gXHU2QTIxXHU1NzU3XHU1QjlFXHU0RjhCXHU3RUE3XHU5NjhGXHU2NzNBXHU3NkQwOkhNUiBcdTkxQ0RcdThGN0RcdTRGMUFcdTkxQ0RcdTdGNkUgc3ZnU2VxLFx1NjVFN1x1NTM2MVx1NzI0N1x1NjcyQVx1NTM3OFx1OEY3RFx1NjVGNlx1NUU4Rlx1NTNGN1x1NEYxQVx1NjQ5RVxuLy8gKG1lcm1haWQgU1ZHIFx1NTE4NVx1OTBFOFx1NEVFNSAjY29udGFpbmVyIFx1NUYxNVx1NzUyOFx1ODFFQVx1OEVBQixcdTU0MENcdTk4NzVcdTkxQ0RcdTU5MEQgaWQgXHU0RjFBXHU0RTMyXHU1NkZFKVx1MzAwMlxuY29uc3Qgc3ZnU2FsdCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDgpXG5cbmFzeW5jIGZ1bmN0aW9uIHJlbmRlck9uZShcbiAgc291cmNlOiBzdHJpbmcsXG4gIGRhcms6IGJvb2xlYW4sXG4gIGNmZzogQ2xpZW50Q29uZmlnLFxuICBzaWduYWw6IEFib3J0U2lnbmFsLFxuKTogUHJvbWlzZTxSZW5kZXJSZXN1bHQ+IHtcbiAgY29uc3QgeyBkaWFncmFtLCBpbmplY3RlZCB9ID0gYnVpbGREYXJrSW5qZWN0aW9uKHNvdXJjZSwgZGFyaywgY2ZnLnRoZW1lQXV0bylcbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChSRU5ERVJfRU5EUE9JTlQsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGRpYWdyYW1fc291cmNlOiBkaWFncmFtLFxuICAgICAgICBkaWFncmFtX3R5cGU6ICdtZXJtYWlkJyxcbiAgICAgICAgb3V0cHV0X2Zvcm1hdDogJ3N2ZycsXG4gICAgICB9KSxcbiAgICAgIHNpZ25hbCxcbiAgICB9KVxuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpXG4gICAgLy8gXHU1QkI5XHU1RkNEIEJPTSAvIFx1NTI0RFx1NUJGQ1x1N0E3QVx1NzY3RDpcdTkwRThcdTUyMDYgS3Jva2kgXHU1MTdDXHU1QkI5XHU2NzBEXHU1MkExXHU0RjFBXHU1RTI2IFxcdUZFRkYgXHU2MjE2XHU2MzYyXHU4ODRDXHU1RjAwXHU1OTM0XHUzMDAyXG4gICAgY29uc3Qgc3ZnVGV4dCA9IHRleHQucmVwbGFjZSgvXlxcdUZFRkYvLCAnJykudHJpbVN0YXJ0KClcbiAgICBpZiAocmVzLm9rICYmIHN2Z1RleHQuc3RhcnRzV2l0aCgnPHN2ZycpKSB7XG4gICAgICBzdmdTZXEgKz0gMVxuICAgICAgcmV0dXJuIHsgb2s6IHRydWUsIHN2ZzogdW5pcXVpZnlTdmdJZHMoc3ZnVGV4dCwgYHRjbS1zdmctJHtzdmdTYWx0fS0ke3N2Z1NlcS50b1N0cmluZygzNil9YCksIGRhcmtSZW5kZXJlZDogaW5qZWN0ZWQgfVxuICAgIH1cbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiBzdW1tYXJpemVFcnJvcih0ZXh0IHx8IGBIVFRQICR7cmVzLnN0YXR1c31gKSB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubmFtZSA9PT0gJ0Fib3J0RXJyb3InKSB7XG4gICAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnXHU2RTMyXHU2N0QzXHU4RDg1XHU2NUY2JyB9XG4gICAgfVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHN1bW1hcml6ZUVycm9yKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSkgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGNvcHlUZXh0KHRleHQ6IHN0cmluZyk6IFByb21pc2U8eyBvazogYm9vbGVhbjsgZXJyb3I6IHN0cmluZyB9PiB7XG4gIGlmICh0eXBlb2YgbmF2aWdhdG9yICE9PSAndW5kZWZpbmVkJyAmJiBuYXZpZ2F0b3IuY2xpcGJvYXJkICYmIHR5cGVvZiBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KVxuICAgICAgLnRoZW4oKCkgPT4gKHsgb2s6IHRydWUsIGVycm9yOiAnJyB9KSlcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+ICh7IG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZygoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5tZXNzYWdlKSB8fCBlcnJvcikgfSkpXG4gIH1cbiAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7IG9rOiBmYWxzZSwgZXJyb3I6ICdjbGlwYm9hcmQgdW5hdmFpbGFibGUnIH0pXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBcdTUzNjFcdTcyNDdcdTdFQzRcdTRFRjYgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5pbnRlcmZhY2UgRGlhZ3JhbUNhcmRQcm9wcyB7XG4gIHNvdXJjZTogc3RyaW5nXG4gIHJlc3VsdDogUmVuZGVyUmVzdWx0XG4gIGNmZzogQ2xpZW50Q29uZmlnXG59XG5cbmZ1bmN0aW9uIERpYWdyYW1DYXJkKHByb3BzOiBEaWFncmFtQ2FyZFByb3BzKSB7XG4gIGNvbnN0IHJlc3VsdCA9IHByb3BzLnJlc3VsdFxuICBjb25zdCBjZmcgPSBwcm9wcy5jZmdcbiAgY29uc3QgW3Nob3dTb3VyY2UsIHNldFNob3dTb3VyY2VdID0gdXNlU3RhdGUoZmFsc2UpXG4gIGNvbnN0IFtjb3B5Tm90ZSwgc2V0Q29weU5vdGVdID0gdXNlU3RhdGUoJycpXG4gIGNvbnN0IFttb2RlLCBzZXRNb2RlXSA9IHVzZVN0YXRlPCdmaXQnIHwgJ3pvb20nPignZml0JylcbiAgY29uc3QgW21ldHJpY3MsIHNldE1ldHJpY3NdID0gdXNlU3RhdGUoeyBudzogMCwgbmg6IDAgfSlcbiAgY29uc3QgW2ZpdFNjYWxlLCBzZXRGaXRTY2FsZV0gPSB1c2VTdGF0ZSgwKVxuICBjb25zdCBbem9vbSwgc2V0Wm9vbV0gPSB1c2VTdGF0ZSh7IHM6IDEsIHg6IDAsIHk6IDAgfSlcbiAgY29uc3Qgc3ZnSG9zdFJlZiA9IHVzZVJlZjxIVE1MRGl2RWxlbWVudCB8IG51bGw+KG51bGwpXG4gIGNvbnN0IGZpdEJveFJlZiA9IHVzZVJlZjxIVE1MRGl2RWxlbWVudCB8IG51bGw+KG51bGwpXG4gIGNvbnN0IHpvb21Cb3hSZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQgfCBudWxsPihudWxsKVxuICBjb25zdCBkcmFnUmVmID0gdXNlUmVmPHsgc3g6IG51bWJlcjsgc3k6IG51bWJlcjsgb3g6IG51bWJlcjsgb3k6IG51bWJlciB9IHwgbnVsbD4obnVsbClcblxuICBjb25zdCBjYXJkRGFyayA9IHJlc3VsdC5vayA9PT0gdHJ1ZSAmJiByZXN1bHQuZGFya1JlbmRlcmVkID09PSB0cnVlXG4gIGNvbnN0IHN2ZyA9IHJlc3VsdC5vayA9PT0gdHJ1ZSA/IHJlc3VsdC5zdmcgOiAnJ1xuXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKGNhcmREYXJrKSByZWNvbG9yRGFyayhzdmdIb3N0UmVmLmN1cnJlbnQsIGNmZy5kYXJrQ29sb3JzKVxuICAgIGNvbnN0IG0gPSBtZWFzdXJlU3ZnKHN2Z0hvc3RSZWYuY3VycmVudClcbiAgICBpZiAobS5udyA+IDAgJiYgbS5uaCA+IDApIHNldE1ldHJpY3MobSlcbiAgfSwgW3N2Zywgc2hvd1NvdXJjZSwgbW9kZSwgY2FyZERhcmssIGNmZ10pXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAoIShtZXRyaWNzLm53ID4gMCkgfHwgZml0Qm94UmVmLmN1cnJlbnQgPT09IG51bGwpIHJldHVyblxuICAgIGNvbnN0IHIgPSBmaXRCb3hSZWYuY3VycmVudC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuICAgIHNldEZpdFNjYWxlKGZpdFNjYWxlRm9yKG1ldHJpY3MubncsIG1ldHJpY3MubmgsIHIud2lkdGgsIGNmZy5maXRNYXhIZWlnaHQsIGNmZy56b29tTWluU2NhbGUpKVxuICB9LCBbbWV0cmljcywgc2hvd1NvdXJjZSwgY2ZnXSlcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmIChtb2RlICE9PSAnem9vbScpIHJldHVybiB1bmRlZmluZWRcbiAgICBjb25zdCBib3ggPSB6b29tQm94UmVmLmN1cnJlbnRcbiAgICBpZiAoYm94ID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgciA9IGJveC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKVxuICAgIGNvbnN0IHMgPSBmaXRTY2FsZUZvcihtZXRyaWNzLm53LCBtZXRyaWNzLm5oLCByLndpZHRoLCByLmhlaWdodCwgY2ZnLnpvb21NaW5TY2FsZSlcbiAgICBjb25zdCBycyA9IHMgPiAwID8gcyA6IDFcbiAgICBjb25zdCBjZW50ZXJlZCA9IG1ldHJpY3MubncgPiAwXG4gICAgc2V0Wm9vbSh7XG4gICAgICBzOiBycyxcbiAgICAgIHg6IGNlbnRlcmVkID8gKHIud2lkdGggLSBtZXRyaWNzLm53ICogcnMpIC8gMiA6IDAsXG4gICAgICB5OiBjZW50ZXJlZCA/IChyLmhlaWdodCAtIG1ldHJpY3MubmggKiBycykgLyAyIDogMCxcbiAgICB9KVxuICAgIGNvbnN0IG9uV2hlZWwgPSAoZTogV2hlZWxFdmVudCkgPT4ge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpXG4gICAgICBjb25zdCByZWN0ID0gYm94LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG4gICAgICBjb25zdCBjeCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdFxuICAgICAgY29uc3QgY3kgPSBlLmNsaWVudFkgLSByZWN0LnRvcFxuICAgICAgc2V0Wm9vbSgoeikgPT4ge1xuICAgICAgICBjb25zdCBmYWN0b3IgPSBlLmRlbHRhWSA+IDAgPyAwLjg1IDogMS4xOFxuICAgICAgICBjb25zdCBucyA9IGNsYW1wKHoucyAqIGZhY3RvciwgY2ZnLnpvb21NaW5TY2FsZSwgY2ZnLnpvb21NYXhTY2FsZSlcbiAgICAgICAgY29uc3QgayA9IG5zIC8gei5zXG4gICAgICAgIHJldHVybiB7IHM6IG5zLCB4OiBjeCAtIChjeCAtIHoueCkgKiBrLCB5OiBjeSAtIChjeSAtIHoueSkgKiBrIH1cbiAgICAgIH0pXG4gICAgfVxuICAgIGJveC5hZGRFdmVudExpc3RlbmVyKCd3aGVlbCcsIG9uV2hlZWwsIHsgcGFzc2l2ZTogZmFsc2UgfSlcbiAgICBjb25zdCBvbktleSA9IChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgICBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSBzZXRNb2RlKCdmaXQnKVxuICAgIH1cbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIG9uS2V5KVxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBib3gucmVtb3ZlRXZlbnRMaXN0ZW5lcignd2hlZWwnLCBvbldoZWVsKVxuICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBvbktleSlcbiAgICB9XG4gIH0sIFttb2RlLCBtZXRyaWNzLCBjZmddKVxuXG4gIGNvbnN0IG9uUG9pbnRlckRvd24gPSAoZTogUmVhY3RQb2ludGVyRXZlbnQpID0+IHtcbiAgICBpZiAoZS5idXR0b24gIT09IDApIHJldHVyblxuICAgIGNvbnN0IHRhcmdldCA9IGUudGFyZ2V0XG4gICAgaWYgKHRhcmdldCBpbnN0YW5jZW9mIEVsZW1lbnQgJiYgdHlwZW9mIHRhcmdldC5jbG9zZXN0ID09PSAnZnVuY3Rpb24nICYmIHRhcmdldC5jbG9zZXN0KCcudGNtLXRvb2xiYXInKSAhPT0gbnVsbCkgcmV0dXJuXG4gICAgdHJ5IHtcbiAgICAgIGUuY3VycmVudFRhcmdldC5zZXRQb2ludGVyQ2FwdHVyZShlLnBvaW50ZXJJZClcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGlnbm9yZSAqL1xuICAgIH1cbiAgICBkcmFnUmVmLmN1cnJlbnQgPSB7IHN4OiBlLmNsaWVudFgsIHN5OiBlLmNsaWVudFksIG94OiB6b29tLngsIG95OiB6b29tLnkgfVxuICB9XG4gIGNvbnN0IG9uUG9pbnRlck1vdmUgPSAoZTogUmVhY3RQb2ludGVyRXZlbnQpID0+IHtcbiAgICBjb25zdCBkID0gZHJhZ1JlZi5jdXJyZW50XG4gICAgaWYgKGQgPT09IG51bGwpIHJldHVyblxuICAgIHNldFpvb20oKHopID0+ICh7IHM6IHoucywgeDogZC5veCArIChlLmNsaWVudFggLSBkLnN4KSwgeTogZC5veSArIChlLmNsaWVudFkgLSBkLnN5KSB9KSlcbiAgfVxuICBjb25zdCBvblBvaW50ZXJVcCA9ICgpID0+IHtcbiAgICBkcmFnUmVmLmN1cnJlbnQgPSBudWxsXG4gIH1cblxuICBjb25zdCB6b29tQnkgPSAoZmFjdG9yOiBudW1iZXIpID0+IHtcbiAgICBjb25zdCBib3ggPSB6b29tQm94UmVmLmN1cnJlbnRcbiAgICBpZiAoYm94ID09PSBudWxsKSByZXR1cm5cbiAgICBjb25zdCByID0gYm94LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG4gICAgY29uc3QgY3ggPSByLndpZHRoIC8gMlxuICAgIGNvbnN0IGN5ID0gci5oZWlnaHQgLyAyXG4gICAgc2V0Wm9vbSgoeikgPT4ge1xuICAgICAgY29uc3QgbnMgPSBjbGFtcCh6LnMgKiBmYWN0b3IsIGNmZy56b29tTWluU2NhbGUsIGNmZy56b29tTWF4U2NhbGUpXG4gICAgICBjb25zdCBrID0gbnMgLyB6LnNcbiAgICAgIHJldHVybiB7IHM6IG5zLCB4OiBjeCAtIChjeCAtIHoueCkgKiBrLCB5OiBjeSAtIChjeSAtIHoueSkgKiBrIH1cbiAgICB9KVxuICB9XG4gIGNvbnN0IHpvb21SZXNldCA9ICgpID0+IHtcbiAgICBjb25zdCBib3ggPSB6b29tQm94UmVmLmN1cnJlbnRcbiAgICBpZiAoYm94ID09PSBudWxsKSByZXR1cm5cbiAgICBjb25zdCByID0gYm94LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpXG4gICAgY29uc3QgcyA9IGZpdFNjYWxlRm9yKG1ldHJpY3MubncsIG1ldHJpY3MubmgsIHIud2lkdGgsIHIuaGVpZ2h0LCBjZmcuem9vbU1pblNjYWxlKVxuICAgIGNvbnN0IHJzID0gcyA+IDAgPyBzIDogMVxuICAgIGNvbnN0IGNlbnRlcmVkID0gbWV0cmljcy5udyA+IDBcbiAgICBzZXRab29tKHtcbiAgICAgIHM6IHJzLFxuICAgICAgeDogY2VudGVyZWQgPyAoci53aWR0aCAtIG1ldHJpY3MubncgKiBycykgLyAyIDogMCxcbiAgICAgIHk6IGNlbnRlcmVkID8gKHIuaGVpZ2h0IC0gbWV0cmljcy5uaCAqIHJzKSAvIDIgOiAwLFxuICAgIH0pXG4gIH1cblxuICBjb25zdCBzdmdIdG1sID0geyBfX2h0bWw6IHN2ZyB9XG4gIGNvbnN0IGNhblpvb20gPSByZXN1bHQub2sgPT09IHRydWUgJiYgIXNob3dTb3VyY2VcblxuICBjb25zdCBoZWFkID0gY3JlYXRlRWxlbWVudCgnZGl2JywgeyBjbGFzc05hbWU6ICd0Y20tY2FyZC1oZWFkJyB9LFxuICAgIGNyZWF0ZUVsZW1lbnQoJ3NwYW4nLCB7IGNsYXNzTmFtZTogJ3RjbS1jYXJkLXRpdGxlJyB9LCAnTWVybWFpZCBcdTU2RkUnKSxcbiAgICBjcmVhdGVFbGVtZW50KEljb25CdG4sIHtcbiAgICAgIGljb246ICdjb2RlJyxcbiAgICAgIHRpdGxlOiBzaG93U291cmNlID8gJ1x1NjUzNlx1OEQ3N1x1NkU5MFx1NzgwMScgOiAnXHU2N0U1XHU3NzBCXHU2RTkwXHU3ODAxJyxcbiAgICAgIG9uQ2xpY2s6ICgpID0+IHNldFNob3dTb3VyY2UoKHMpID0+ICFzKSxcbiAgICB9KSxcbiAgICBjcmVhdGVFbGVtZW50KEljb25CdG4sIHtcbiAgICAgIGljb246IGNvcHlOb3RlID09PSAnZG9uZScgPyAnY2hlY2snIDogJ2NvcHknLFxuICAgICAgdGl0bGU6ICdcdTU5MERcdTUyMzZcdTZFOTBcdTc4MDEnLFxuICAgICAgb25DbGljazogKCkgPT4ge1xuICAgICAgICBzZXRDb3B5Tm90ZSgncGVuZGluZycpXG4gICAgICAgIHZvaWQgY29weVRleHQocHJvcHMuc291cmNlKS50aGVuKChyKSA9PiBzZXRDb3B5Tm90ZShyLm9rID09PSB0cnVlID8gJ2RvbmUnIDogJ2ZhaWwnKSlcbiAgICAgIH0sXG4gICAgfSksXG4gICAgY2FuWm9vbVxuICAgICAgPyBjcmVhdGVFbGVtZW50KEljb25CdG4sIHtcbiAgICAgICAgaWNvbjogbW9kZSA9PT0gJ3pvb20nID8gJ21pbmltaXplJyA6ICd6b29tSW4nLFxuICAgICAgICB0aXRsZTogbW9kZSA9PT0gJ3pvb20nID8gJ1x1NjUzNlx1OEQ3NycgOiAnXHU2NTNFXHU1OTI3XHU2N0U1XHU3NzBCJyxcbiAgICAgICAgb25DbGljazogKCkgPT4gc2V0TW9kZShtb2RlID09PSAnem9vbScgPyAnZml0JyA6ICd6b29tJyksXG4gICAgICB9KVxuICAgICAgOiBudWxsLFxuICApXG5cbiAgbGV0IGJvZHk6IFJlYWN0Tm9kZVxuICBpZiAoc2hvd1NvdXJjZSkge1xuICAgIGJvZHkgPSBjcmVhdGVFbGVtZW50KCdwcmUnLCB7IGNsYXNzTmFtZTogJ3RjbS1zb3VyY2UnIH0sIHByb3BzLnNvdXJjZSlcbiAgfSBlbHNlIGlmIChyZXN1bHQub2sgPT09IHRydWUpIHtcbiAgICBpZiAobW9kZSA9PT0gJ3pvb20nKSB7XG4gICAgICBjb25zdCBpbm5lclN0eWxlID0ge1xuICAgICAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyBhcyBjb25zdCxcbiAgICAgICAgbGVmdDogMCxcbiAgICAgICAgdG9wOiAwLFxuICAgICAgICB3aWR0aDogbWV0cmljcy5udyA+IDAgPyBtZXRyaWNzLm53IDogJzEwMCUnLFxuICAgICAgICBoZWlnaHQ6IG1ldHJpY3MubmggPiAwID8gbWV0cmljcy5uaCA6ICcxMDAlJyxcbiAgICAgICAgdHJhbnNmb3JtOiBgdHJhbnNsYXRlKCR7em9vbS54fXB4LCR7em9vbS55fXB4KSBzY2FsZSgke3pvb20uc30pYCxcbiAgICAgICAgdHJhbnNmb3JtT3JpZ2luOiAnMCAwJyxcbiAgICAgIH1cbiAgICAgIGJvZHkgPSBjcmVhdGVFbGVtZW50KCdkaXYnLCB7XG4gICAgICAgIGNsYXNzTmFtZTogJ3RjbS16b29tJyxcbiAgICAgICAgcmVmOiB6b29tQm94UmVmLFxuICAgICAgICBvblBvaW50ZXJEb3duLFxuICAgICAgICBvblBvaW50ZXJNb3ZlLFxuICAgICAgICBvblBvaW50ZXJVcCxcbiAgICAgICAgb25Qb2ludGVyQ2FuY2VsOiBvblBvaW50ZXJVcCxcbiAgICAgICAgb25Eb3VibGVDbGljazogem9vbVJlc2V0LFxuICAgICAgICByb2xlOiAncmVnaW9uJyxcbiAgICAgICAgJ2FyaWEtbGFiZWwnOiAnTWVybWFpZCBcdTU2RkVcdTdGMjlcdTY1M0VcdTc1M0JcdTVFMDMoXHU2MkQ2XHU1MkE4XHU1RTczXHU3OUZCXHUzMDAxXHU2RURBXHU4RjZFXHU3RjI5XHU2NTNFXHUzMDAxXHU1M0NDXHU1MUZCXHU5MDAyXHU5MTREXHUzMDAxRXNjIFx1OTAwMFx1NTFGQSknLFxuICAgICAgfSxcbiAgICAgICAgY3JlYXRlRWxlbWVudCgnZGl2JywgeyByZWY6IHN2Z0hvc3RSZWYsIHN0eWxlOiBpbm5lclN0eWxlLCBjbGFzc05hbWU6ICd0Y20tc3ZnLWxheWVyJywgZGFuZ2Vyb3VzbHlTZXRJbm5lckhUTUw6IHN2Z0h0bWwgfSksXG4gICAgICAgIGNyZWF0ZUVsZW1lbnQoJ2RpdicsIHsgY2xhc3NOYW1lOiAndGNtLXRvb2xiYXInIH0sXG4gICAgICAgICAgY3JlYXRlRWxlbWVudChJY29uQnRuLCB7IGNsYXNzTmFtZTogJ3RjbS10b29sLWJ0bicsIGljb246ICdwbHVzJywgc2l6ZTogMTUsIHRpdGxlOiAnXHU2NTNFXHU1OTI3Jywgb25DbGljazogKCkgPT4gem9vbUJ5KDEuMykgfSksXG4gICAgICAgICAgY3JlYXRlRWxlbWVudChJY29uQnRuLCB7IGNsYXNzTmFtZTogJ3RjbS10b29sLWJ0bicsIGljb246ICdtaW51cycsIHNpemU6IDE1LCB0aXRsZTogJ1x1N0YyOVx1NUMwRicsIG9uQ2xpY2s6ICgpID0+IHpvb21CeSgwLjc3KSB9KSxcbiAgICAgICAgICBjcmVhdGVFbGVtZW50KEljb25CdG4sIHsgY2xhc3NOYW1lOiAndGNtLXRvb2wtYnRuJywgaWNvbjogJ21heGltaXplJywgc2l6ZTogMTUsIHRpdGxlOiAnXHU5MDAyXHU1RTk0XHU3QTk3XHU1M0UzJywgb25DbGljazogem9vbVJlc2V0IH0pLFxuICAgICAgICApLFxuICAgICAgICBjcmVhdGVFbGVtZW50KCdkaXYnLCB7IGNsYXNzTmFtZTogJ3RjbS1oaW50JyB9LCAnXHU2MkQ2XHU1MkE4XHU1RTczXHU3OUZCIFx1MDBCNyBcdTZFREFcdThGNkVcdTdGMjlcdTY1M0UgXHUwMEI3IFx1NTNDQ1x1NTFGQlx1OTAwMlx1OTE0RCBcdTAwQjcgRXNjIFx1OTAwMFx1NTFGQScpLFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzID0gZml0U2NhbGUgPiAwID8gZml0U2NhbGUgOiAwXG4gICAgICBjb25zdCBpbm5lclN0eWxlID0gcyA+IDAgPyB7XG4gICAgICAgIHBvc2l0aW9uOiAnYWJzb2x1dGUnIGFzIGNvbnN0LFxuICAgICAgICBsZWZ0OiAwLFxuICAgICAgICB0b3A6IDAsXG4gICAgICAgIHdpZHRoOiBtZXRyaWNzLm53LFxuICAgICAgICBoZWlnaHQ6IG1ldHJpY3MubmgsXG4gICAgICAgIHRyYW5zZm9ybTogYHNjYWxlKCR7c30pYCxcbiAgICAgICAgdHJhbnNmb3JtT3JpZ2luOiAnMCAwJyxcbiAgICAgIH0gOiB7IHdpZHRoOiAnMTAwJScgYXMgY29uc3QgfVxuICAgICAgY29uc3Qgc3RhZ2VTdHlsZSA9IHMgPiAwXG4gICAgICAgID8geyB3aWR0aDogTWF0aC5yb3VuZChtZXRyaWNzLm53ICogcyksIGhlaWdodDogTWF0aC5yb3VuZChtZXRyaWNzLm5oICogcyksIHBvc2l0aW9uOiAncmVsYXRpdmUnIGFzIGNvbnN0IH1cbiAgICAgICAgOiB7IHBvc2l0aW9uOiAncmVsYXRpdmUnIGFzIGNvbnN0IH1cbiAgICAgIGJvZHkgPSBjcmVhdGVFbGVtZW50KCdkaXYnLCB7IGNsYXNzTmFtZTogJ3RjbS1maXQnLCByZWY6IGZpdEJveFJlZiB9LFxuICAgICAgICBjcmVhdGVFbGVtZW50KCdkaXYnLCB7IHN0eWxlOiBzdGFnZVN0eWxlIH0sXG4gICAgICAgICAgY3JlYXRlRWxlbWVudCgnZGl2JywgeyByZWY6IHN2Z0hvc3RSZWYsIHN0eWxlOiBpbm5lclN0eWxlLCBjbGFzc05hbWU6ICd0Y20tc3ZnLWxheWVyJywgZGFuZ2Vyb3VzbHlTZXRJbm5lckhUTUw6IHN2Z0h0bWwgfSksXG4gICAgICAgICksXG4gICAgICApXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGJvZHkgPSBjcmVhdGVFbGVtZW50KCdkaXYnLCB7IGNsYXNzTmFtZTogJ3RjbS1lcnJvcicgfSwgYFx1NkUzMlx1NjdEM1x1NTkzMVx1OEQyNTogJHtyZXN1bHQuZXJyb3IgfHwgJ1x1NjcyQVx1NzdFNVx1OTUxOVx1OEJFRid9YClcbiAgfVxuXG4gIHJldHVybiBjcmVhdGVFbGVtZW50KCdkaXYnLCB7IGNsYXNzTmFtZTogYHRjbS1jYXJkJHtjYXJkRGFyayA/ICcgdGNtLWNhcmQtZGFyaycgOiAnJ31gIH0sIGhlYWQsIGJvZHkpXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBcdTUzNTVcdTU2RkVcdTUxNjVcdTUzRTM6XHU2MkM5XHU1M0Q2XHU0RTAwXHU2QjIxLFx1NEUzQlx1OTg5OFx1NTNEOFx1NTMxNlx1OTFDRFx1NkUzMlx1NjdEMyxcdTUzNzhcdThGN0QvXHU4RDg1XHU2NUY2XHU0RTJEXHU2QjYyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxudHlwZSBSZWFjdFBvaW50ZXJFdmVudCA9IHsgYnV0dG9uOiBudW1iZXI7IGNsaWVudFg6IG51bWJlcjsgY2xpZW50WTogbnVtYmVyOyBwb2ludGVySWQ6IG51bWJlcjsgdGFyZ2V0OiBFdmVudFRhcmdldCB8IG51bGw7IGN1cnJlbnRUYXJnZXQ6IEhUTUxFbGVtZW50IH1cblxuLyoqIFx1OEJBMlx1OTYwNSBHVUkgXHU0RTNCXHU5ODk4XHU1M0Q4XHU1MzE2O2NvcmRpcyBcdTc2ODQgRXZlbnRzIFx1ODg2OFx1NjMwOSBrZXlvZiBcdTY1MzZcdTdEMjcsXHU4RkQ5XHU5MUNDXHU1MDVBXHU1QjU3XHU3QjI2XHU0RTMyXHU5NTJFXHU3Njg0XHU3QTg0XHU1MzE2XHU5NzYyXHUzMDAyICovXG5mdW5jdGlvbiBzdWJzY3JpYmVUaGVtZShjdHg6IENvbnRleHQsIGxpc3RlbmVyOiAoc25hcDogVGhlbWVTbmFwc2hvdE9yTnVsbCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICBjb25zdCBlbWl0dGVyID0gY3R4IGFzIHVua25vd24gYXMge1xuICAgIG9uKG5hbWU6IHN0cmluZywgbGlzdGVuZXI6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24pOiAoKSA9PiB2b2lkXG4gIH1cbiAgcmV0dXJuIGVtaXR0ZXIub24oJ3RoZW1lL2NoYW5nZScsIChzbmFwOiB1bmtub3duKSA9PiBsaXN0ZW5lcihzbmFwIGFzIFRoZW1lU25hcHNob3RPck51bGwpKVxufVxuXG5mdW5jdGlvbiBNZXJtYWlkSW5saW5lKHByb3BzOiBNZXJtYWlkSW5saW5lUHJvcHMpIHtcbiAgY29uc3QgW3N0YXRlLCBzZXRTdGF0ZV0gPSB1c2VTdGF0ZTx7IHN0YXR1czogJ2xvYWRpbmcnIHwgJ2RvbmUnIHwgJ2Vycm9yJzsgcmVzdWx0OiBSZW5kZXJSZXN1bHQgfCBudWxsOyBlcnJvcjogc3RyaW5nIHwgbnVsbCB9Pih7XG4gICAgc3RhdHVzOiAnbG9hZGluZycsIHJlc3VsdDogbnVsbCwgZXJyb3I6IG51bGwsXG4gIH0pXG4gIGNvbnN0IFthdHRlbXB0LCBzZXRBdHRlbXB0XSA9IHVzZVN0YXRlKDApXG4gIGNvbnN0IFtjZmcsIHNldENmZ10gPSB1c2VTdGF0ZTxDbGllbnRDb25maWc+KCgpID0+IGNvbmZpZ05vdygpKVxuICBjb25zdCBbdGhlbWVTbmFwLCBzZXRUaGVtZVNuYXBdID0gdXNlU3RhdGU8VGhlbWVTbmFwc2hvdE9yTnVsbD4oKCkgPT4ge1xuICAgIGNvbnN0IHN2YyA9IHByb3BzLnRoZW1lU3ZjXG4gICAgaWYgKHN2YyAhPT0gdW5kZWZpbmVkICYmIHN2YyAhPT0gbnVsbCAmJiB0eXBlb2Ygc3ZjLmdldFRoZW1lID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gc3ZjLmdldFRoZW1lKClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbFxuICB9KVxuICBjb25zdCBkYXJrID0gdGhlbWVTbmFwPy5hY3RpdmU/LmNvbG9yU2NoZW1lID09PSAnZGFyaydcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGNvcmRpc0N0eCA9IHByb3BzLmNvcmRpc0N0eFxuICAgIGlmIChjb3JkaXNDdHggPT09IHVuZGVmaW5lZCB8fCBjb3JkaXNDdHggPT09IG51bGwpIHJldHVybiB1bmRlZmluZWRcbiAgICBjb25zdCBvZmYgPSBzdWJzY3JpYmVUaGVtZShjb3JkaXNDdHgsIChzbmFwKSA9PiBzZXRUaGVtZVNuYXAoc25hcCkpXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIG9mZigpXG4gICAgfVxuICAgIC8vIFx1NEUzQlx1OTg5OFx1OEJBMlx1OTYwNVx1NEUwMFx1NkIyMVx1NTM3M1x1NTNFRixwcm9wcyBcdTkxQ0MgY3R4IFx1NzUxRlx1NTQ3RFx1NTQ2OFx1NjcxRlx1NEUwRSBmaWJlciBcdTc2RjhcdTU0MENcdTMwMDJcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVhY3QtaG9va3MvZXhoYXVzdGl2ZS1kZXBzXG4gIH0sIFtdKVxuXG4gIHVzZUVmZmVjdCgoKSA9PiBzdWJzY3JpYmVDb25maWcoKCkgPT4gc2V0Q2ZnKGNvbmZpZ05vdygpKSksIFtdKVxuXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgbGV0IGFsaXZlID0gdHJ1ZVxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcbiAgICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCBjZmcucmVuZGVyVGltZW91dE1zKVxuICAgIHNldFN0YXRlKHsgc3RhdHVzOiAnbG9hZGluZycsIHJlc3VsdDogbnVsbCwgZXJyb3I6IG51bGwgfSlcbiAgICB2b2lkIHJlbmRlck9uZShwcm9wcy5zb3VyY2UsIGRhcmssIGNmZywgY29udHJvbGxlci5zaWduYWwpXG4gICAgICAudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGlmICghYWxpdmUpIHJldHVyblxuICAgICAgICBzZXRTdGF0ZSh7IHN0YXR1czogJ2RvbmUnLCByZXN1bHQsIGVycm9yOiBudWxsIH0pXG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICBpZiAoIWFsaXZlKSByZXR1cm5cbiAgICAgICAgc2V0U3RhdGUoeyBzdGF0dXM6ICdlcnJvcicsIHJlc3VsdDogbnVsbCwgZXJyb3I6IHN1bW1hcml6ZUVycm9yKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSkgfSlcbiAgICAgIH0pXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGFsaXZlID0gZmFsc2VcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lcilcbiAgICAgIGNvbnRyb2xsZXIuYWJvcnQoKVxuICAgIH1cbiAgfSwgW3Byb3BzLnNvdXJjZSwgZGFyaywgYXR0ZW1wdCwgY2ZnXSlcblxuICBpZiAoc3RhdGUuc3RhdHVzID09PSAnbG9hZGluZycpIHtcbiAgICByZXR1cm4gY3JlYXRlRWxlbWVudCgnZGl2JywgeyBjbGFzc05hbWU6ICd0Y20tbm90ZScgfSwgJ1x1NkI2M1x1NTcyOFx1NkUzMlx1NjdEMyBNZXJtYWlkIFx1NTZGRVx1MjAyNicpXG4gIH1cbiAgaWYgKHN0YXRlLnN0YXR1cyA9PT0gJ2Vycm9yJyB8fCBzdGF0ZS5yZXN1bHQgPT09IG51bGwpIHtcbiAgICByZXR1cm4gY3JlYXRlRWxlbWVudCgnZGl2JywgeyBjbGFzc05hbWU6ICd0Y20tZXJyb3InIH0sXG4gICAgICBgXHU2RTMyXHU2N0QzXHU1OTMxXHU4RDI1OiAke3N0YXRlLmVycm9yIHx8ICdcdTY3MkFcdTc3RTVcdTk1MTlcdThCRUYnfWAsXG4gICAgICBjcmVhdGVFbGVtZW50KCdidXR0b24nLCB7XG4gICAgICAgIHR5cGU6ICdidXR0b24nLFxuICAgICAgICBjbGFzc05hbWU6ICd0Y20tcmV0cnknLFxuICAgICAgICBvbkNsaWNrOiAoKSA9PiBzZXRBdHRlbXB0KChhKSA9PiBhICsgMSksXG4gICAgICB9LCAnXHU5MUNEXHU4QkQ1JyksXG4gICAgKVxuICB9XG4gIHJldHVybiBjcmVhdGVFbGVtZW50KERpYWdyYW1DYXJkLCB7IHNvdXJjZTogcHJvcHMuc291cmNlLCByZXN1bHQ6IHN0YXRlLnJlc3VsdCwgY2ZnIH0pXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBcdTUzOUZcdTRGNEQgRE9NIFx1NjI0Qlx1NjcyRiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbmNvbnN0IG1vdW50QmxvY2tzID0gbmV3IFdlYWtNYXA8SFRNTEVsZW1lbnQsIEVsZW1lbnQ+KClcbmNvbnN0IG1vdW50Um9vdHMgPSBuZXcgV2Vha01hcDxIVE1MRWxlbWVudCwgUm9vdD4oKVxuXG5mdW5jdGlvbiBibG9ja0xhbmcoYmxvY2s6IEVsZW1lbnQpOiBzdHJpbmcge1xuICBjb25zdCB3cmFwID0gYmxvY2suZmlyc3RFbGVtZW50Q2hpbGRcbiAgY29uc3QgYmFubmVyID0gd3JhcCA9PT0gbnVsbCA/IG51bGwgOiB3cmFwLmZpcnN0RWxlbWVudENoaWxkXG4gIGNvbnN0IGluZm8gPSBiYW5uZXIgPT09IG51bGwgPyBudWxsIDogYmFubmVyLmZpcnN0RWxlbWVudENoaWxkXG4gIHJldHVybiBpbmZvID09PSBudWxsID8gJycgOiBTdHJpbmcoaW5mby50ZXh0Q29udGVudCB8fCAnJykudHJpbSgpXG59XG5cbmZ1bmN0aW9uIHJlYWRTb3VyY2UoYmxvY2s6IEVsZW1lbnQpOiBzdHJpbmcge1xuICBjb25zdCBwcmUgPSBibG9jay5xdWVyeVNlbGVjdG9yKCdwcmUnKVxuICBpZiAocHJlID09PSBudWxsKSByZXR1cm4gJydcbiAgbGV0IHRleHQgPSBTdHJpbmcocHJlLnRleHRDb250ZW50IHx8ICcnKVxuICBpZiAodGV4dC5lbmRzV2l0aCgnXFxuJykpIHRleHQgPSB0ZXh0LnNsaWNlKDAsIC0xKVxuICByZXR1cm4gdGV4dFxufVxuXG5mdW5jdGlvbiByZW1vdmVNb3VudChtb3VudDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgY29uc3Qgcm9vdCA9IG1vdW50Um9vdHMuZ2V0KG1vdW50KVxuICBpZiAocm9vdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJvb3QudW5tb3VudCgpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gIH1cbiAgbW91bnQucmVtb3ZlKClcbn1cblxuZnVuY3Rpb24gdW5oaWRlQmxvY2soYmxvY2s6IEVsZW1lbnQpOiB2b2lkIHtcbiAgOyhibG9jayBhcyBIVE1MRWxlbWVudCkuc3R5bGUuZGlzcGxheSA9ICcnXG4gIGRlbGV0ZSAoYmxvY2sgYXMgSFRNTEVsZW1lbnQpLmRhdGFzZXQudGNtUmVwbGFjZWRcbn1cblxuLyoqIFx1NjI4QVx1NEUwMFx1NEUyQSBtZXJtYWlkIFx1NEVFM1x1NzgwMVx1NTc1N1x1NTM5Rlx1NEY0RFx1NjZGRlx1NjM2Mlx1NEUzQSBSZWFjdCBcdTZFMzJcdTY3RDNcdTc2ODRcdTU2RkVcdTUzNjFcdTcyNDdcdTMwMDIgKi9cbmZ1bmN0aW9uIHJlcGxhY2VCbG9jayhibG9jazogRWxlbWVudCwgaW5saW5lUHJvcHM6IE9taXQ8TWVybWFpZElubGluZVByb3BzLCAnc291cmNlJz4pOiB2b2lkIHtcbiAgY29uc3Qgc291cmNlID0gcmVhZFNvdXJjZShibG9jaylcbiAgaWYgKHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCBibG9ja0VsID0gYmxvY2sgYXMgSFRNTEVsZW1lbnRcbiAgYmxvY2tFbC5kYXRhc2V0LnRjbVJlcGxhY2VkID0gJzEnXG4gIGJsb2NrRWwuc3R5bGUuZGlzcGxheSA9ICdub25lJ1xuICBjb25zdCBtb3VudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIG1vdW50LmNsYXNzTmFtZSA9IE1PVU5UX0NMQVNTXG4gIGJsb2NrLnBhcmVudE5vZGU/Lmluc2VydEJlZm9yZShtb3VudCwgYmxvY2submV4dFNpYmxpbmcpXG4gIG1vdW50QmxvY2tzLnNldChtb3VudCwgYmxvY2spXG4gIHRyeSB7XG4gICAgY29uc3Qgcm9vdCA9IGNyZWF0ZVJvb3QobW91bnQpXG4gICAgbW91bnRSb290cy5zZXQobW91bnQsIHJvb3QpXG4gICAgcm9vdC5yZW5kZXIoY3JlYXRlRWxlbWVudChNZXJtYWlkSW5saW5lLCB7IC4uLmlubGluZVByb3BzLCBzb3VyY2UgfSkpXG4gIH0gY2F0Y2gge1xuICAgIG1vdW50LnRleHRDb250ZW50ID0gJ01lcm1haWQgXHU2RTMyXHU2N0QzXHU2MzAyXHU4RjdEXHU1OTMxXHU4RDI1J1xuICB9XG59XG5cbi8qKiBcdTUzNEZcdThDMDNcdTRFMDBcdTg4NEM6XHU2RTA1XHU1QjY0XHU1MTNGXHU2MzAyXHU4RjdEXHU3MEI5XHUzMDAxXHU0RkVFXHU1OTBEXHU4OEFCXHU5MUNEXHU2NTNFXHU3Njg0XHU2NkZGXHU2MzYyXHUzMDAxXHU2NUIwXHU1ODlFXHU2NzJBXHU2NkZGXHU2MzYyXHU3Njg0XHU0RUUzXHU3ODAxXHU1NzU3XHUzMDAyICovXG5mdW5jdGlvbiBzeW5jUm93KHJvdzogRWxlbWVudCwgaW5saW5lUHJvcHM6IE9taXQ8TWVybWFpZElubGluZVByb3BzLCAnc291cmNlJz4pOiB2b2lkIHtcbiAgY29uc3QgbW91bnRzID0gQXJyYXkuZnJvbShyb3cucXVlcnlTZWxlY3RvckFsbChgLiR7TU9VTlRfQ0xBU1N9YCkpIGFzIEhUTUxFbGVtZW50W11cbiAgZm9yIChjb25zdCBtb3VudCBvZiBtb3VudHMpIHtcbiAgICBjb25zdCBibG9jayA9IG1vdW50QmxvY2tzLmdldChtb3VudClcbiAgICBjb25zdCBoZWFsdGh5ID0gYmxvY2sgIT09IHVuZGVmaW5lZCAmJiBibG9jay5pc0Nvbm5lY3RlZFxuICAgICAgJiYgbW91bnQucHJldmlvdXNFbGVtZW50U2libGluZyA9PT0gYmxvY2tcbiAgICAgICYmIChibG9jayBhcyBIVE1MRWxlbWVudCkuc3R5bGUuZGlzcGxheSA9PT0gJ25vbmUnXG4gICAgICAmJiAoYmxvY2sgYXMgSFRNTEVsZW1lbnQpLmRhdGFzZXQudGNtUmVwbGFjZWQgPT09ICcxJ1xuICAgIGlmICghaGVhbHRoeSkgcmVtb3ZlTW91bnQobW91bnQpXG4gIH1cbiAgY29uc3QgYmxvY2tzID0gQXJyYXkuZnJvbShyb3cucXVlcnlTZWxlY3RvckFsbChgLiR7Q09ERV9CTE9DS19DTEFTU31gKSlcbiAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICBpZiAoYmxvY2tMYW5nKGJsb2NrKSAhPT0gJ21lcm1haWQnKSBjb250aW51ZVxuICAgIGNvbnN0IG1hcmsgPSAoYmxvY2sgYXMgSFRNTEVsZW1lbnQpLmRhdGFzZXQudGNtUmVwbGFjZWQgPT09ICcxJ1xuICAgIGNvbnN0IG5leHQgPSBibG9jay5uZXh0RWxlbWVudFNpYmxpbmdcbiAgICBjb25zdCBoZWFsdGh5ID0gbWFyayAmJiAoYmxvY2sgYXMgSFRNTEVsZW1lbnQpLnN0eWxlLmRpc3BsYXkgPT09ICdub25lJ1xuICAgICAgJiYgbmV4dCAhPT0gbnVsbCAmJiBuZXh0LmNsYXNzTGlzdC5jb250YWlucyhNT1VOVF9DTEFTUylcbiAgICAgICYmIG1vdW50QmxvY2tzLmdldChuZXh0IGFzIEhUTUxFbGVtZW50KSA9PT0gYmxvY2tcbiAgICAgICYmIG1vdW50Um9vdHMuaGFzKG5leHQgYXMgSFRNTEVsZW1lbnQpXG4gICAgaWYgKGhlYWx0aHkpIGNvbnRpbnVlXG4gICAgaWYgKG1hcmspIHVuaGlkZUJsb2NrKGJsb2NrKVxuICAgIGlmIChuZXh0ICE9PSBudWxsICYmIG5leHQuY2xhc3NMaXN0LmNvbnRhaW5zKE1PVU5UX0NMQVNTKSkgcmVtb3ZlTW91bnQobmV4dCBhcyBIVE1MRWxlbWVudClcbiAgICByZXBsYWNlQmxvY2soYmxvY2ssIGlubGluZVByb3BzKVxuICB9XG59XG5cbi8qKiBcdTRFMDBcdThGNkVcdTc2ODQgcm93Olx1NEVDRSB0YWlsIHJvdyBcdTU0MTFcdTRFMEFcdTY1MzZcdTk2QzZcdTUyMzBcdTRFMEFcdTRFMDBcdTRFMkEgdHVybi10YWlsIHJvdyBcdTRFM0FcdTZCNjJcdTMwMDIgKi9cbmZ1bmN0aW9uIGNvbGxlY3RUdXJuUm93cyh0YWlsUm93OiBIVE1MRWxlbWVudCk6IEVsZW1lbnRbXSB7XG4gIGNvbnN0IHJvd3M6IEVsZW1lbnRbXSA9IFtdXG4gIGxldCBjdXI6IEVsZW1lbnQgfCBudWxsID0gdGFpbFJvd1xuICB3aGlsZSAoY3VyICE9PSBudWxsKSB7XG4gICAgcm93cy5wdXNoKGN1cilcbiAgICBjdXIgPSBjdXIucHJldmlvdXNFbGVtZW50U2libGluZ1xuICAgIGlmIChjdXIgIT09IG51bGwgJiYgY3VyLmdldEF0dHJpYnV0ZSgnZGF0YS1jaGF0LWZsb3cta2luZCcpID09PSAndHVybi10YWlsJykgYnJlYWtcbiAgfVxuICByZXR1cm4gcm93c1xufVxuXG5mdW5jdGlvbiByZXN0b3JlUm93cyhyb3dzOiBFbGVtZW50W10pOiB2b2lkIHtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGlmICghcm93LmlzQ29ubmVjdGVkKSBjb250aW51ZVxuICAgIGZvciAoY29uc3QgbW91bnQgb2YgQXJyYXkuZnJvbShyb3cucXVlcnlTZWxlY3RvckFsbChgLiR7TU9VTlRfQ0xBU1N9YCkpIGFzIEhUTUxFbGVtZW50W10pIHtcbiAgICAgIHJlbW92ZU1vdW50KG1vdW50KVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGJsb2NrIG9mIEFycmF5LmZyb20ocm93LnF1ZXJ5U2VsZWN0b3JBbGwoYC4ke0NPREVfQkxPQ0tfQ0xBU1N9YCkpKSB7XG4gICAgICBpZiAoKGJsb2NrIGFzIEhUTUxFbGVtZW50KS5kYXRhc2V0LnRjbVJlcGxhY2VkID09PSAnMScpIHVuaGlkZUJsb2NrKGJsb2NrKVxuICAgIH1cbiAgfVxufVxuXG5pbnRlcmZhY2UgTWVybWFpZERyaXZlclByb3BzIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICB0aGVtZVN2Yz86IFRoZW1lU2VydmljZVxuICBjb3JkaXNDdHg/OiBDb250ZXh0XG59XG5cbi8qKiBcdTRFMERcdTUzRUZcdTg5QzFcdTc2ODQgdGFpbCBcdTUxNjVcdTUzRTMsXHU5QTcxXHU1MkE4XHU1QjgzXHU2MjQwXHU1NzI4XHU4RjZFXHU3Njg0XHU0RUUzXHU3ODAxXHU1NzU3XHU1MzlGXHU0RjREXHU2NkZGXHU2MzYyXHUzMDAyICovXG5mdW5jdGlvbiBNZXJtYWlkRHJpdmVyKHByb3BzOiBNZXJtYWlkRHJpdmVyUHJvcHMpIHtcbiAgY29uc3QgYW5jaG9yUmVmID0gdXNlUmVmPEhUTUxTcGFuRWxlbWVudCB8IG51bGw+KG51bGwpXG4gIHVzZUxheW91dEVmZmVjdCgoKSA9PiB7XG4gICAgY29uc3QgYW5jaG9yID0gYW5jaG9yUmVmLmN1cnJlbnRcbiAgICBpZiAoYW5jaG9yID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgY29uc3QgdGFpbFJvdyA9IGFuY2hvci5jbG9zZXN0KCdbZGF0YS1jaGF0LWZsb3cta2luZF0nKVxuICAgIGlmICh0YWlsUm93ID09PSBudWxsIHx8IHRhaWxSb3cucGFyZW50RWxlbWVudCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGNvbnN0IGxpc3QgPSB0YWlsUm93LnBhcmVudEVsZW1lbnRcbiAgICBjb25zdCBpbmxpbmVQcm9wcyA9IHsgdGhlbWVTdmM6IHByb3BzLnRoZW1lU3ZjLCBjb3JkaXNDdHg6IHByb3BzLmNvcmRpc0N0eCB9XG4gICAgbGV0IHJhZlBlbmRpbmcgPSBmYWxzZVxuICAgIGNvbnN0IHNjYW4gPSAoKSA9PiB7XG4gICAgICAvLyBcdTZCQ0ZcdTZCMjFcdTYyNkJcdTYzQ0ZcdTkxQ0RcdTY1QjBcdTYzQThcdTVCRkNcdTY3MkNcdThGNkVcdTc2ODQgcm93czpcdTVFQzlcdTRFRjcsXHU0RTE0XHU1MjE3XHU4ODY4XHU5MUNEXHU2MzkyL1x1NTQxMVx1NEUwQVx1OEZGRFx1NTJBMFx1NTM4Nlx1NTNGMlx1NjVGNlx1NEY5RFx1NzEzNlx1N0EzM1x1NTA2NVx1MzAwMlxuICAgICAgY29uc3Qgcm93cyA9IGNvbGxlY3RUdXJuUm93cyh0YWlsUm93IGFzIEhUTUxFbGVtZW50KVxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgICBpZiAocm93LmlzQ29ubmVjdGVkKSBzeW5jUm93KHJvdywgaW5saW5lUHJvcHMpXG4gICAgICB9XG4gICAgfVxuICAgIHNjYW4oKVxuICAgIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKCkgPT4ge1xuICAgICAgaWYgKHJhZlBlbmRpbmcpIHJldHVyblxuICAgICAgcmFmUGVuZGluZyA9IHRydWVcbiAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgIHJhZlBlbmRpbmcgPSBmYWxzZVxuICAgICAgICBzY2FuKClcbiAgICAgIH0pXG4gICAgfSlcbiAgICBvYnNlcnZlci5vYnNlcnZlKGxpc3QsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIG9ic2VydmVyLmRpc2Nvbm5lY3QoKVxuICAgICAgcmVzdG9yZVJvd3MoY29sbGVjdFR1cm5Sb3dzKHRhaWxSb3cgYXMgSFRNTEVsZW1lbnQpKVxuICAgIH1cbiAgICAvLyBcdTlBNzFcdTUyQThcdTUzRUFcdTk2OEZcdTgxRUFcdThFQUJcdTYzMDJcdThGN0RcdTc1MUZcdTU0N0RcdTU0NjhcdTY3MUZcdThGRDBcdTg4NENcdTRFMDBcdTZCMjFcdTMwMDJcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVhY3QtaG9va3MvZXhoYXVzdGl2ZS1kZXBzXG4gIH0sIFtdKVxuICByZXR1cm4gY3JlYXRlRWxlbWVudCgnc3BhbicsIHsgcmVmOiBhbmNob3JSZWYsIHN0eWxlOiB7IGRpc3BsYXk6ICdub25lJyB9IH0pXG59XG5cbi8vIFx1MjUwMFx1MjUwMCBcdTY4MzdcdTVGMEYoXHU5MTREXHU3RjZFXHU5QTcxXHU1MkE4KVx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuZnVuY3Rpb24gYnVpbGRDc3MoY2ZnOiBDbGllbnRDb25maWcpOiBzdHJpbmcge1xuICBjb25zdCBkID0gY2ZnLmRhcmtDb2xvcnNcbiAgcmV0dXJuIFtcbiAgICBgLnRjbS1tb3VudHtkaXNwbGF5OmJsb2NrO21hcmdpbjo4cHggMH1gLFxuICAgIGAudGNtLWNhcmR7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1kc3ctYWxpYXMtYm9yZGVyLWwxLHJnYmEoMTI4LDEyOCwxMjgsLjI4KSk7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6dmFyKC0tZHN3LWFsaWFzLWJnLWxheWVyLTEscmdiYSgxMjgsMTI4LDEyOCwuMDYpKTtvdmVyZmxvdzpoaWRkZW59YCxcbiAgICBgLnRjbS1jYXJkLWhlYWR7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NHB4O3BhZGRpbmc6NnB4IDEwcHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tZHN3LWFsaWFzLWJvcmRlci1sMSxyZ2JhKDEyOCwxMjgsMTI4LC4yKSl9YCxcbiAgICBgLnRjbS1jYXJkLXRpdGxle2ZsZXg6MTtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtbGFiZWwtc2Vjb25kYXJ5LCM4YThmOTgpfWAsXG4gICAgYC50Y20tYnRue2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7d2lkdGg6MjZweDtoZWlnaHQ6MjRweDtwYWRkaW5nOjA7Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MTtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtbGFiZWwtc2Vjb25kYXJ5LCM4YThmOTgpO2JhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Ym9yZGVyOm5vbmU7Y3Vyc29yOnBvaW50ZXI7Ym9yZGVyLXJhZGl1czo2cHh9YCxcbiAgICBgLnRjbS1idG46aG92ZXJ7Y29sb3I6dmFyKC0tZHN3LWFsaWFzLWJyYW5kLXByaW1hcnksIzRhN2RmZik7YmFja2dyb3VuZDp2YXIoLS1kc3ctYWxpYXMtYmctbGF5ZXItMixyZ2JhKDEyOCwxMjgsMTI4LC4xNCkpfWAsXG4gICAgYC50Y20tYnRuOmZvY3VzLXZpc2libGUsLnRjbS10b29sLWJ0bjpmb2N1cy12aXNpYmxlLC50Y20tcmV0cnk6Zm9jdXMtdmlzaWJsZXtvdXRsaW5lOjJweCBzb2xpZCB2YXIoLS1kc3ctYWxpYXMtYnJhbmQtcHJpbWFyeSwjNGE3ZGZmKTtvdXRsaW5lLW9mZnNldDoycHh9YCxcbiAgICBgLnRjbS1pY29ue2Rpc3BsYXk6YmxvY2t9YCxcbiAgICBgLnRjbS1maXR7cG9zaXRpb246cmVsYXRpdmU7b3ZlcmZsb3c6aGlkZGVuO2JhY2tncm91bmQ6I2ZmZmZmZjttYXgtaGVpZ2h0OiR7Y2ZnLmZpdE1heEhlaWdodH1weDtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OmNlbnRlcn1gLFxuICAgIGAudGNtLWZpdCBzdmd7bWF4LXdpZHRoOjEwMCU7aGVpZ2h0OmF1dG87ZGlzcGxheTpibG9ja31gLFxuICAgIGAudGNtLXpvb217cG9zaXRpb246cmVsYXRpdmU7b3ZlcmZsb3c6aGlkZGVuO2JhY2tncm91bmQ6I2ZmZmZmZjtoZWlnaHQ6Y2xhbXAoMzIwcHgsNjJ2aCwke2NmZy56b29tQm94SGVpZ2h0fXB4KTt0b3VjaC1hY3Rpb246bm9uZTtjdXJzb3I6Z3JhYjt1c2VyLXNlbGVjdDpub25lfWAsXG4gICAgYC50Y20tem9vbTphY3RpdmV7Y3Vyc29yOmdyYWJiaW5nfWAsXG4gICAgYC50Y20tc3ZnLWxheWVyIHN2Z3tkaXNwbGF5OmJsb2NrfWAsXG4gICAgYC50Y20tdG9vbGJhcntwb3NpdGlvbjphYnNvbHV0ZTt0b3A6OHB4O3JpZ2h0OjhweDtkaXNwbGF5OmZsZXg7Z2FwOjJweDtwYWRkaW5nOjNweDtib3JkZXItcmFkaXVzOjhweDtiYWNrZ3JvdW5kOnZhcigtLWRzdy1hbGlhcy1iZy1vdmVybGF5LHJnYmEoMjU1LDI1NSwyNTUsLjk0KSk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1kc3ctYWxpYXMtYm9yZGVyLWwxLHJnYmEoMTI4LDEyOCwxMjgsLjMpKTtib3gtc2hhZG93OjAgMnB4IDEwcHggcmdiYSgwLDAsMCwuMTQpO3otaW5kZXg6Mn1gLFxuICAgIGAudGNtLXRvb2wtYnRue2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7d2lkdGg6MjhweDtoZWlnaHQ6MjRweDtwYWRkaW5nOjA7Y29sb3I6dmFyKC0tZHN3LWFsaWFzLWxhYmVsLXByaW1hcnksIzMzMyk7YmFja2dyb3VuZDp0cmFuc3BhcmVudDtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjZweDtjdXJzb3I6cG9pbnRlcn1gLFxuICAgIGAudGNtLXRvb2wtYnRuOmhvdmVye2JhY2tncm91bmQ6dmFyKC0tZHN3LWFsaWFzLWJnLWxheWVyLTIscmdiYSgxMjgsMTI4LDEyOCwuMTYpKTtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtYnJhbmQtcHJpbWFyeSwjNGE3ZGZmKX1gLFxuICAgIGAudGNtLWhpbnR7cG9zaXRpb246YWJzb2x1dGU7bGVmdDo4cHg7Ym90dG9tOjhweDtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtbGFiZWwtc2Vjb25kYXJ5LCM4ODgpO2JhY2tncm91bmQ6dmFyKC0tZHN3LWFsaWFzLWJnLW92ZXJsYXkscmdiYSgyNTUsMjU1LDI1NSwuOSkpO3BhZGRpbmc6MnB4IDhweDtib3JkZXItcmFkaXVzOjZweDtwb2ludGVyLWV2ZW50czpub25lO3otaW5kZXg6Mn1gLFxuICAgIGAudGNtLXNvdXJjZXttYXJnaW46MDtwYWRkaW5nOjEycHggMTRweDtmb250LXNpemU6MTJweDtsaW5lLWhlaWdodDoxLjU1O292ZXJmbG93OmF1dG87bWF4LWhlaWdodDozNDBweDtiYWNrZ3JvdW5kOnZhcigtLWRzdy1hbGlhcy1iZy1sYXllci0yLHJnYmEoMCwwLDAsLjA1KSk7Y29sb3I6dmFyKC0tZHN3LWFsaWFzLWxhYmVsLXByaW1hcnksaW5oZXJpdCk7d2hpdGUtc3BhY2U6cHJlfWAsXG4gICAgYC50Y20tbm90ZXtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtbGFiZWwtc2Vjb25kYXJ5LCM4YThmOTgpO3BhZGRpbmc6NHB4IDJweH1gLFxuICAgIGAudGNtLWVycm9ye2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLWRzdy1hbGlhcy1zdGF0ZS1lcnJvci1wcmltYXJ5LCNkNDM4MGQpO3BhZGRpbmc6MTBweCAxMnB4fWAsXG4gICAgYC50Y20tcmV0cnl7bWFyZ2luLWxlZnQ6MTBweDtmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS1kc3ctYWxpYXMtYnJhbmQtcHJpbWFyeSwjNGE3ZGZmKTtiYWNrZ3JvdW5kOnRyYW5zcGFyZW50O2JvcmRlcjoxcHggc29saWQgdmFyKC0tZHN3LWFsaWFzLWJvcmRlci1sMSxyZ2JhKDEyOCwxMjgsMTI4LC40KSk7Ym9yZGVyLXJhZGl1czo2cHg7cGFkZGluZzoycHggMTBweDtjdXJzb3I6cG9pbnRlcn1gLFxuICAgIGAudGNtLWNhcmQtZGFyayAudGNtLWZpdCwudGNtLWNhcmQtZGFyayAudGNtLXpvb217YmFja2dyb3VuZDoke2QuY2FudmFzfX1gLFxuICAgIGBAbWVkaWEgKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246IHJlZHVjZSl7LnRjbS1idG4sLnRjbS10b29sLWJ0biwudGNtLXJldHJ5e3RyYW5zaXRpb246bm9uZX19YCxcbiAgXS5qb2luKCdcXG4nKVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgXHU2M0QyXHU0RUY2IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5KGN0eDogQ29udGV4dCk6IHZvaWQge1xuICBjb25zdCBzbG90cyA9IGN0eC5nZXQoJ3Nsb3RzJykgYXMgU2xvdHNTZXJ2aWNlIHwgdW5kZWZpbmVkXG4gIGlmIChzbG90cyA9PT0gdW5kZWZpbmVkKSByZXR1cm5cbiAgLy8gc3R5bGUgXHU2Q0U4XHU1MTY1XHU1RjUyXHU1QzVFIGZpYmVyOlx1NjMwMi9cdTY0NThcdTkwRkRcdTU3MjggZWZmZWN0IFx1OTFDQyxmaWJlciBcdTU0MkZcdTUyQThcdTU5MzFcdThEMjVcdTRFMERcdTRGMUFcdTZDQzRcdTZGMEZcdTgyODJcdTcwQjlcdTMwMDJcbiAgY29uc3Qgc3R5bGVUYWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpXG4gIHN0eWxlVGFnLnNldEF0dHJpYnV0ZSgnZGF0YS1wbHVnaW4nLCAnZHNoLW1lcm1haWQtcmVuZGVyZXInKVxuICBzdHlsZVRhZy50ZXh0Q29udGVudCA9IGJ1aWxkQ3NzKENMSUVOVF9ERUZBVUxUUylcbiAgY3R4LmVmZmVjdCgoKSA9PiB7XG4gICAgZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzdHlsZVRhZylcbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgc3R5bGVUYWcucmVtb3ZlKClcbiAgICB9XG4gIH0sICdkc2gtbWVybWFpZC1yZW5kZXJlcjogYmFzZSBzdHlsZXMnKVxuICAvLyBcdTkxNERcdTdGNkVcdTVGRUJcdTcxNjc6XHU2MjEwXHU1MjlGXHU1MjREXHU3NTI4XHU5RUQ4XHU4QkE0XHU1MDNDXHU2RTMyXHU2N0QzLFx1NjIxMFx1NTI5Rlx1NTQwRVx1NzBFRFx1NjZGRlx1NjM2MiBDU1MgXHU0RTBFXHU4RkQwXHU4ODRDXHU2NUY2XHU1M0MyXHU2NTcwXHUzMDAyXG4gIHZvaWQgbG9hZENsaWVudENvbmZpZygpXG4gICAgLnRoZW4oKGNmZykgPT4ge1xuICAgICAgc2V0TGl2ZUNvbmZpZyhjZmcpXG4gICAgICBpZiAoc3R5bGVUYWcuaXNDb25uZWN0ZWQpIHN0eWxlVGFnLnRleHRDb250ZW50ID0gYnVpbGRDc3MoY2ZnKVxuICAgIH0pXG4gICAgLmNhdGNoKCgpID0+IHtcbiAgICAgIC8qIFx1NEZERFx1NjMwMVx1N0YxNlx1OEJEMVx1NjcxRlx1OUVEOFx1OEJBNFx1NTAzQyAqL1xuICAgIH0pXG4gIGNvbnN0IHRoZW1lU3ZjID0gY3R4LmdldCgndGhlbWUnKSBhcyBUaGVtZVNlcnZpY2UgfCB1bmRlZmluZWRcbiAgY29uc3QgZHJpdmVyUHJvcHMgPSB7IHRoZW1lU3ZjLCBjb3JkaXNDdHg6IGN0eCB9XG4gIC8vIFx1OTY0NFx1NTJBMFx1NUYwRiBsaXN0IHNsb3Q6XHU2QkNGXHU0RTJBXHU1QjlBXHU3QTNGXHU1MkE5XHU2MjRCXHU2RDg4XHU2MDZGXHU0RTAwXHU2NzYxLFx1NEUwRFx1NEUwRVx1NTE3Nlx1NEVENlx1NUMzRVx1NURGNFx1NEVBNFx1NEVEOFx1OTRGRVx1N0FERVx1NEU4OVx1MzAwMlxuICBzbG90cy5pbmplY3QoU0xPVF9OQU1FLCAoKSA9PiBzbG90cy5yZWdpc3RlcihcbiAgICB7IG5hbWU6IFNMT1RfTkFNRSwgaWQ6IFNMT1RfSUQsIG9yZGVyOiBTTE9UX09SREVSIH0sXG4gICAgKHByb3BzKSA9PiBjcmVhdGVFbGVtZW50KE1lcm1haWREcml2ZXIsIHsgLi4ucHJvcHMsIC4uLmRyaXZlclByb3BzIH0pLFxuICApKVxufVxuXG5leHBvcnQgY29uc3QgaW5qZWN0ID0gWydzbG90cyddXG5leHBvcnQgY29uc3QgbmFtZSA9ICdkc2gtbWVybWFpZC1yZW5kZXJlcidcbiIsICIvKipcbiAqIFx1NUJBMlx1NjIzN1x1N0FFRlx1NkUzMlx1NjdEM1x1OTE0RFx1N0Y2RVx1NTk1MVx1N0VBNiBcdTIwMTRcdTIwMTQgaG9zdCBcdTRFMEUgY2xpZW50IFx1NTM0QVx1OEZCOVx1NTE3MVx1NEVBQlx1NzY4NFx1NTM1NVx1NEUwMFx1NEU4Qlx1NUI5RVx1NkU5MFx1MzAwMlxuICpcbiAqIFx1NjcyQ1x1NkEyMVx1NTc1N1x1NEUwRCBpbXBvcnQgc2NoZW1hc3Rlcnk6Y2xpZW50IGJ1bmRsZSBcdTc2ODRcdTVFNzNcdTUzRjBcdTZBMjFcdTU3NTdcdTg4NjhcdTkxQ0NcdTZDQTFcdTY3MDlcdTVCODMsXG4gKiBcdTZENEZcdTg5QzhcdTU2NjhcdTUzNEFcdThGQjlcdTUzRUFcdTZEODhcdThEMzlcdTdFQUYgSlNPTihjb25maWcgXHU3NTMxIGhvc3QgXHU3Njg0IGNsaWVudC1jb25maWcgXHU3QUVGXHU3MEI5XHU0RTBCXHU1M0QxLFxuICogXHU1NDA4XHU1RTc2XHU1MjREXHU3Njg0XHU3RjE2XHU4QkQxXHU2NzFGXHU5RUQ4XHU4QkE0XHU1MDNDXHU0RTBFIGhvc3Qgc2NoZW1hIFx1OUVEOFx1OEJBNFx1NTAzQ1x1NEUwMFx1ODFGNCxcdTc1MzFcdTUzNTVcdTZENEJcdTVCODhcdTYyQTRcdTRFMERcdTZGMDJcdTc5RkIpXHUzMDAyXG4gKi9cblxuLyoqIFx1NkRGMVx1ODI3Mlx1NEUzQlx1OTg5OFx1NEUwQiBTVkcgXHU5MUNEXHU3NzQwXHU4MjcyXHU3NTI4XHU3Njg0XHU4QzAzXHU4MjcyXHU2NzdGXHUzMDAyICovXG5leHBvcnQgaW50ZXJmYWNlIERhcmtDb2xvcnMge1xuICAvKiogXHU4MjgyXHU3MEI5XHU1RjYyXHU3MkI2XHU1ODZCXHU1MTQ1XHU4MjcyICovXG4gIHNoYXBlOiBzdHJpbmdcbiAgLyoqIFx1NUY2Mlx1NzJCNi9cdTdDMDdcdTYzQ0ZcdThGQjlcdTgyNzIgKi9cbiAgc3Ryb2tlOiBzdHJpbmdcbiAgLyoqIFx1N0MwN1x1NEUwRVx1OEZCOVx1NjgwN1x1N0I3RVx1NUU5NVx1ODI3MiAqL1xuICBjbHVzdGVyOiBzdHJpbmdcbiAgLyoqIFx1OEZERVx1N0VCRlx1NEUwRVx1N0JBRFx1NTkzNFx1ODI3MiAqL1xuICBlZGdlOiBzdHJpbmdcbiAgLyoqIFx1NjU4N1x1NjcyQ1x1ODI3MiAqL1xuICB0ZXh0OiBzdHJpbmdcbiAgLyoqIFx1NkRGMVx1ODI3Mlx1NTM2MVx1NzI0N1x1NzUzQlx1NUUwM1x1NUU5NVx1ODI3MiAqL1xuICBjYW52YXM6IHN0cmluZ1xufVxuXG4vKiogXHU0RTBCXHU1M0QxXHU3RUQ5XHU2RDRGXHU4OUM4XHU1NjY4XHU3Njg0XHU2RTMyXHU2N0QzXHU5MTREXHU3RjZFKGhvc3QgQ29uZmlnIFx1NzY4NFx1NUJBMlx1NjIzN1x1N0FFRlx1NTNFRlx1ODlDMVx1NUI1MFx1OTZDNilcdTMwMDIgKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50Q29uZmlnIHtcbiAgLyoqIFx1OTAwMlx1OTE0RFx1NkEyMVx1NUYwRlx1NzY4NFx1NjcwMFx1NTkyN1x1NUM1NVx1NzkzQVx1OUFEOFx1NUVBNihweCkgKi9cbiAgZml0TWF4SGVpZ2h0OiBudW1iZXJcbiAgLyoqIFx1N0YyOVx1NjUzRVx1NkEyMVx1NUYwRlx1NUJCOVx1NTY2OFx1OUFEOFx1NUVBNihweCkgKi9cbiAgem9vbUJveEhlaWdodDogbnVtYmVyXG4gIC8qKiBcdTdGMjlcdTY1M0VcdTRFMEJcdTk2NTAgKi9cbiAgem9vbU1pblNjYWxlOiBudW1iZXJcbiAgLyoqIFx1N0YyOVx1NjUzRVx1NEUwQVx1OTY1MCAqL1xuICB6b29tTWF4U2NhbGU6IG51bWJlclxuICAvKiogXHU1MzU1XHU1NkZFXHU2RTMyXHU2N0QzXHU4RDg1XHU2NUY2KG1zKSAqL1xuICByZW5kZXJUaW1lb3V0TXM6IG51bWJlclxuICAvKiogXHU2REYxXHU4MjcyIEdVSSBcdTRFMEJcdTgxRUFcdTUyQThcdTZDRThcdTUxNjUgZGFyayB0aGVtZShcdTY1RTBcdTY2M0VcdTVGMEYgaW5pdCBcdTYzMDdcdTRFRTRcdTY1RjYpICovXG4gIHRoZW1lQXV0bzogYm9vbGVhblxuICAvKiogXHU2REYxXHU4MjcyXHU5MUNEXHU3NzQwXHU4MjcyXHU4QzAzXHU4MjcyXHU2NzdGICovXG4gIGRhcmtDb2xvcnM6IERhcmtDb2xvcnNcbn1cblxuLyoqXG4gKiBcdTdGMTZcdThCRDFcdTY3MUZcdTlFRDhcdThCQTRcdTUwM0NcdTMwMDJcdTVGQzVcdTk4N0JcdTRFMEUgc3JjL2NvbmZpZy50cyBcdTRFMkQgU2NoZW1hc3Rlcnkgc2NoZW1hIFx1NzY4NFx1OUVEOFx1OEJBNFx1NTAzQ1xuICogXHU1QjhDXHU1MTY4XHU0RTAwXHU4MUY0KFx1NzUzMSB0ZXN0L2NsaWVudC1jb25maWcudGVzdC5qcyBcdTY1QURcdThBMDBcdTVCODhcdTYyQTQpXHUzMDAyXG4gKi9cbmV4cG9ydCBjb25zdCBDTElFTlRfREVGQVVMVFM6IENsaWVudENvbmZpZyA9IHtcbiAgZml0TWF4SGVpZ2h0OiAzNjAsXG4gIHpvb21Cb3hIZWlnaHQ6IDU2MCxcbiAgem9vbU1pblNjYWxlOiAwLjE1LFxuICB6b29tTWF4U2NhbGU6IDYsXG4gIHJlbmRlclRpbWVvdXRNczogMzAwMDAsXG4gIHRoZW1lQXV0bzogdHJ1ZSxcbiAgZGFya0NvbG9yczoge1xuICAgIHNoYXBlOiAnIzIxMjYyZCcsXG4gICAgc3Ryb2tlOiAnIzZlNzY4MScsXG4gICAgY2x1c3RlcjogJyMxNjFiMjInLFxuICAgIGVkZ2U6ICcjOGI5NDllJyxcbiAgICB0ZXh0OiAnI2U2ZWRmMycsXG4gICAgY2FudmFzOiAnIzBkMTExNycsXG4gIH0sXG59XG5cbi8qKiBcdTRFQ0VcdTVCOENcdTY1NzQgaG9zdCBcdTkxNERcdTdGNkVcdTYyOTVcdTVGNzFcdTUxRkFcdTVCQTJcdTYyMzdcdTdBRUZcdTVCNTBcdTk2QzYoaG9zdCBcdTc2ODQgY2xpZW50LWNvbmZpZyBcdTdBRUZcdTcwQjlcdTRGN0ZcdTc1MjgpXHUzMDAyICovXG5leHBvcnQgZnVuY3Rpb24gY2xpZW50Q29uZmlnT2YoY29uZmlnOiBDbGllbnRDb25maWcpOiBDbGllbnRDb25maWcge1xuICByZXR1cm4ge1xuICAgIGZpdE1heEhlaWdodDogY29uZmlnLmZpdE1heEhlaWdodCxcbiAgICB6b29tQm94SGVpZ2h0OiBjb25maWcuem9vbUJveEhlaWdodCxcbiAgICB6b29tTWluU2NhbGU6IGNvbmZpZy56b29tTWluU2NhbGUsXG4gICAgem9vbU1heFNjYWxlOiBjb25maWcuem9vbU1heFNjYWxlLFxuICAgIHJlbmRlclRpbWVvdXRNczogY29uZmlnLnJlbmRlclRpbWVvdXRNcyxcbiAgICB0aGVtZUF1dG86IGNvbmZpZy50aGVtZUF1dG8sXG4gICAgZGFya0NvbG9yczogeyAuLi5jb25maWcuZGFya0NvbG9ycyB9LFxuICB9XG59XG5cbi8qKlxuICogXHU2RTA1XHU2RDE3XHU3RjUxXHU3RURDXHU0RTBCXHU1M0QxXHU3Njg0XHU2NzJBXHU3N0U1IEpTT046XHU1QjU3XHU2QkI1XHU3RjNBXHU1OTMxXHU2MjE2XHU3QzdCXHU1NzhCXHU0RTBEXHU1QkY5XHU2NUY2XHU5MDEwXHU5ODc5XHU1NkRFXHU5MDAwXHU1MjMwXHU3RjE2XHU4QkQxXHU2NzFGXHU5RUQ4XHU4QkE0XHU1MDNDLFxuICogXHU0RkREXHU4QkMxXHU2RDRGXHU4OUM4XHU1NjY4XHU1MzRBXHU4RkI5XHU2MkZGXHU1MjMwXHU3Njg0XHU0RTAwXHU1QjlBXHU2NjJGXHU3RUQzXHU2Nzg0XHU1QjhDXHU1OTdEXHU3Njg0IENsaWVudENvbmZpZ1x1MzAwMlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVDbGllbnRDb25maWcoZGF0YTogdW5rbm93bik6IENsaWVudENvbmZpZyB7XG4gIGNvbnN0IG51bSA9ICh2YWx1ZTogdW5rbm93biwgZmFsbGJhY2s6IG51bWJlcikgPT5cbiAgICB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgPyB2YWx1ZSA6IGZhbGxiYWNrXG4gIGNvbnN0IGJvb2wgPSAodmFsdWU6IHVua25vd24sIGZhbGxiYWNrOiBib29sZWFuKSA9PlxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ2Jvb2xlYW4nID8gdmFsdWUgOiBmYWxsYmFja1xuICBjb25zdCBzdHIgPSAodmFsdWU6IHVua25vd24sIGZhbGxiYWNrOiBzdHJpbmcpID0+XG4gICAgdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IHZhbHVlIDogZmFsbGJhY2tcbiAgaWYgKGRhdGEgPT09IG51bGwgfHwgdHlwZW9mIGRhdGEgIT09ICdvYmplY3QnKSByZXR1cm4gQ0xJRU5UX0RFRkFVTFRTXG4gIGNvbnN0IHNyYyA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3QgZGMgPSBzcmMuZGFya0NvbG9ycyAhPT0gbnVsbCAmJiB0eXBlb2Ygc3JjLmRhcmtDb2xvcnMgPT09ICdvYmplY3QnXG4gICAgPyBzcmMuZGFya0NvbG9ycyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgIDoge31cbiAgcmV0dXJuIHtcbiAgICBmaXRNYXhIZWlnaHQ6IG51bShzcmMuZml0TWF4SGVpZ2h0LCBDTElFTlRfREVGQVVMVFMuZml0TWF4SGVpZ2h0KSxcbiAgICB6b29tQm94SGVpZ2h0OiBudW0oc3JjLnpvb21Cb3hIZWlnaHQsIENMSUVOVF9ERUZBVUxUUy56b29tQm94SGVpZ2h0KSxcbiAgICB6b29tTWluU2NhbGU6IG51bShzcmMuem9vbU1pblNjYWxlLCBDTElFTlRfREVGQVVMVFMuem9vbU1pblNjYWxlKSxcbiAgICB6b29tTWF4U2NhbGU6IG51bShzcmMuem9vbU1heFNjYWxlLCBDTElFTlRfREVGQVVMVFMuem9vbU1heFNjYWxlKSxcbiAgICByZW5kZXJUaW1lb3V0TXM6IG51bShzcmMucmVuZGVyVGltZW91dE1zLCBDTElFTlRfREVGQVVMVFMucmVuZGVyVGltZW91dE1zKSxcbiAgICB0aGVtZUF1dG86IGJvb2woc3JjLnRoZW1lQXV0bywgQ0xJRU5UX0RFRkFVTFRTLnRoZW1lQXV0byksXG4gICAgZGFya0NvbG9yczoge1xuICAgICAgc2hhcGU6IHN0cihkYy5zaGFwZSwgQ0xJRU5UX0RFRkFVTFRTLmRhcmtDb2xvcnMuc2hhcGUpLFxuICAgICAgc3Ryb2tlOiBzdHIoZGMuc3Ryb2tlLCBDTElFTlRfREVGQVVMVFMuZGFya0NvbG9ycy5zdHJva2UpLFxuICAgICAgY2x1c3Rlcjogc3RyKGRjLmNsdXN0ZXIsIENMSUVOVF9ERUZBVUxUUy5kYXJrQ29sb3JzLmNsdXN0ZXIpLFxuICAgICAgZWRnZTogc3RyKGRjLmVkZ2UsIENMSUVOVF9ERUZBVUxUUy5kYXJrQ29sb3JzLmVkZ2UpLFxuICAgICAgdGV4dDogc3RyKGRjLnRleHQsIENMSUVOVF9ERUZBVUxUUy5kYXJrQ29sb3JzLnRleHQpLFxuICAgICAgY2FudmFzOiBzdHIoZGMuY2FudmFzLCBDTElFTlRfREVGQVVMVFMuZGFya0NvbG9ycy5jYW52YXMpLFxuICAgIH0sXG4gIH1cbn1cbiIsICIvKipcbiAqIFx1N0VBRlx1NTFGRFx1NjU3MFx1NTE3MVx1NEVBQlx1NUM0MiBcdTIwMTRcdTIwMTQgaG9zdCBcdTRFMEUgY2xpZW50IFx1NTM0QVx1OEZCOVx1NTQwNFx1ODFFQVx1N0YxNlx1OEJEMVx1OEZEQlx1ODFFQVx1NURGMVx1NzY4NFx1NEVBN1x1NzI2OSxcbiAqIFx1NEUwRFx1NEY5RFx1OEQ1Nlx1NEVGQlx1NEY1NVx1OEZEMFx1ODg0Q1x1NjVGNlx1NzNBRlx1NTg4MyxcdTUzNTVcdTUxNDNcdTZENEJcdThCRDVcdTc2RjRcdTYzQTVcdTk0ODhcdTVCRjlcdTY3MkNcdTZBMjFcdTU3NTdcdTMwMDJcbiAqL1xuXG4vKiogXHU2NTcwXHU1MDNDXHU1OTM5XHU1M0Q2XHUzMDAyICovXG5leHBvcnQgZnVuY3Rpb24gY2xhbXAodmFsdWU6IG51bWJlciwgbG86IG51bWJlciwgaGk6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiB2YWx1ZSA8IGxvID8gbG8gOiB2YWx1ZSA+IGhpID8gaGkgOiB2YWx1ZVxufVxuXG4vKipcbiAqIFx1OTAwMlx1OTE0RFx1NkEyMVx1NUYwRlx1N0YyOVx1NjUzRTpcdTYyOEFcdTgxRUFcdTcxMzZcdTVDM0FcdTVCRjggKG53LCBuaCkgXHU3Njg0XHU1NkZFXHU2NTNFXHU4RkRCIChib3hXLCBib3hIKSBcdTc2ODRcdTg5QzZcdTUzRTMsXG4gKiBcdTc1NTkgMTJweCBcdThGQjlcdThEREQsXHU0RUNFXHU0RTBEXHU2NTNFXHU1OTI3KFx1NEUwQVx1OTY1MCAxKSxcdTRFMEJcdTk2NTBcdTRFM0EgbWluU2NhbGVcdTMwMDJcbiAqIFx1NEVGQlx1NEY1NVx1NUMzQVx1NUJGOFx1OTc1RVx1NkNENSg8PTApXHU4RkQ0XHU1NkRFIDAsXHU4QzAzXHU3NTI4XHU2NUI5XHU2MzA5XCJcdTRFMERcdTdGMjlcdTY1M0VcIlx1NTkwNFx1NzQwNlx1MzAwMlxuICovXG5leHBvcnQgZnVuY3Rpb24gZml0U2NhbGVGb3IoXG4gIG53OiBudW1iZXIsXG4gIG5oOiBudW1iZXIsXG4gIGJveFc6IG51bWJlcixcbiAgYm94SDogbnVtYmVyLFxuICBtaW5TY2FsZSA9IDAuMTUsXG4pOiBudW1iZXIge1xuICBpZiAoIShudyA+IDApIHx8ICEobmggPiAwKSB8fCAhKGJveFcgPiAwKSB8fCAhKGJveEggPiAwKSkgcmV0dXJuIDBcbiAgY29uc3QgcyA9IE1hdGgubWluKDEsIChib3hXIC0gMTIpIC8gbncsIChib3hIIC0gMTIpIC8gbmgpXG4gIHJldHVybiBjbGFtcChzLCBtaW5TY2FsZSwgMSlcbn1cblxuLyoqXG4gKiBcdTZERjFcdTgyNzJcdTRFM0JcdTk4OThcdTZDRThcdTUxNjU6R1VJIFx1NTkwNFx1NEU4RVx1NkRGMVx1ODI3Mlx1NEUxNFx1NzUyOFx1NjIzN1x1NkNBMVx1NjcwOVx1NjYzRVx1NUYwRiBpbml0IFx1NjMwN1x1NEVFNFx1NjVGNixcdTUyNERcdTdGNkVcdTZDRThcdTUxNjVcbiAqIG1lcm1haWQgZGFyayB0aGVtZVx1MzAwMlx1OEZENFx1NTZERVx1NkNFOFx1NTE2NVx1NTQwRVx1NzY4NFx1NkU5MFx1NzgwMVx1NEUwRVwiXHU2NjJGXHU1NDI2XHU2Q0U4XHU1MTY1XCJcdTY4MDdcdThCQjAoXHU1MzYxXHU3MjQ3XHU2MzZFXHU2QjY0XG4gKiBcdTUxQjNcdTVCOUFcdTY2MkZcdTU0MjZcdTUwNUEgU1ZHIFx1OTFDRFx1Nzc0MFx1ODI3MilcdTMwMDJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRGFya0luamVjdGlvbihcbiAgc291cmNlOiBzdHJpbmcsXG4gIGRhcms6IGJvb2xlYW4sXG4gIHRoZW1lQXV0bzogYm9vbGVhbixcbik6IHsgZGlhZ3JhbTogc3RyaW5nOyBpbmplY3RlZDogYm9vbGVhbiB9IHtcbiAgY29uc3QgaGFzSW5pdCA9IHNvdXJjZS5pbmNsdWRlcygnJSV7aW5pdCcpXG4gIGNvbnN0IGluamVjdGVkID0gZGFyayAmJiB0aGVtZUF1dG8gJiYgIWhhc0luaXRcbiAgcmV0dXJuIHtcbiAgICBkaWFncmFtOiBpbmplY3RlZCA/ICclJXtpbml0OiB7XCJ0aGVtZVwiOiBcImRhcmtcIn19JSVcXG4nICsgc291cmNlIDogc291cmNlLFxuICAgIGluamVjdGVkLFxuICB9XG59XG5cbi8qKlxuICogS3Jva2kgXHU2RTMyXHU2N0QzXHU4RkQ0XHU1NkRFXHU3Njg0IFNWRyBcdTkxQ0MgaWQ9XCJjb250YWluZXJcIiBcdTRGMUFcdTRFMEVcdTk4NzVcdTk3NjJcdTRFMEFcdTUxNzZcdTRFRDYgU1ZHIFx1NTFCMlx1N0E4MSxcbiAqIFx1OEZEOVx1OTFDQ1x1NTA1QVx1Nzg2RVx1NUI5QVx1NjAyN1x1OTFDRFx1NTQ3RFx1NTQwRDpcdTU0MENcdTRFMDBcdThGOTNcdTUxNjUgKyBcdTU0MENcdTRFMDBcdTY1QjAgaWQgXHU1Rjk3XHU1MjMwXHU1NDBDXHU0RTAwXHU4RjkzXHU1MUZBKFx1NTNFRlx1OTFDRFx1NjUzRSlcdTMwMDJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVuaXF1aWZ5U3ZnSWRzKHN2Zzogc3RyaW5nLCBpZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN2Z1xuICAgIC5yZXBsYWNlKC9pZD1cImNvbnRhaW5lclwiL2csIGBpZD1cIiR7aWR9XCJgKVxuICAgIC5yZXBsYWNlKC8jY29udGFpbmVyL2csIGAjJHtpZH1gKVxufVxuXG4vKiogXHU2MkZDXHU2M0E1IEtyb2tpIFx1N0FFRlx1NzBCOSBVUkwoYmFzZSBcdTY3MkJcdTVDM0VcdTY1OUNcdTY3NjBcdTRFMEUgcGF0aCBcdTVGMDBcdTU5MzRcdTY1OUNcdTY3NjBcdTVGNTJcdTRFMDApXHUzMDAyICovXG5leHBvcnQgZnVuY3Rpb24ga3Jva2lVcmxPZihiYXNlVXJsOiBzdHJpbmcsIGtyb2tpUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYmFzZSA9IGJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJylcbiAgY29uc3QgcGF0aCA9IGtyb2tpUGF0aC5zdGFydHNXaXRoKCcvJykgPyBrcm9raVBhdGggOiBgLyR7a3Jva2lQYXRofWBcbiAgcmV0dXJuIGJhc2UgKyBwYXRoXG59XG5cbi8qKiBcdTZFMzJcdTY3RDNcdTk1MTlcdThCRUZcdTY1ODdcdTY3MkNcdTVGNTJcdTRFMDA6XHU2Mjk4XHU1M0UwXHU3QTdBXHU3NjdEXHU1RTc2XHU1M0JCXHU5OTk2XHU1QzNFXHUzMDAxXHU2MjJBXHU2NUFEXHU1MjMwIDQwMCBcdTVCNTdcdTdCMjZcdTMwMDIgKi9cbmV4cG9ydCBmdW5jdGlvbiBzdW1tYXJpemVFcnJvcih0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gU3RyaW5nKHRleHQgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCkuc2xpY2UoMCwgNDAwKVxufVxuXG5leHBvcnQgdHlwZSBSZW5kZXJCb2R5TGltaXRzID0ge1xuICBtYXhCb2R5Qnl0ZXM6IG51bWJlclxuICBtYXhEaWFncmFtQnl0ZXM6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBQYXJzZVJlbmRlckJvZHlSZXN1bHQgPVxuICB8IHsgb2s6IHRydWU7IHNvdXJjZTogc3RyaW5nIH1cbiAgfCB7IG9rOiBmYWxzZTsgc3RhdHVzOiBudW1iZXI7IG1lc3NhZ2U6IHN0cmluZyB9XG5cbi8qKlxuICogXHU4OUUzXHU2NzkwXHU2RTMyXHU2N0QzXHU4QkY3XHU2QzQyXHU0RjUzOlx1OEQ4NVx1OTY1MCBcdTIxOTIgNDEzO1x1OTc1RVx1NkNENSBKU09OIFx1MjE5MiA0MDA7ZGlhZ3JhbV9zb3VyY2UgXHU3RjNBXHU1OTMxL1xuICogXHU5NzVFXHU1QjU3XHU3QjI2XHU0RTMyL1x1NEUzQVx1N0E3QS9cdThEODVcdTk2NTAgXHUyMTkyIDQwMFx1MzAwMlx1NTE2OFx1OTBFOFx1NTkzMVx1OEQyNVx1OERFRlx1NUY4NFx1NUUyNlx1NjYwRVx1Nzg2RVx1NzY4NFx1N0VBRlx1NjU4N1x1NjcyQ1x1OEJFRFx1NEU0OVx1MzAwMlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VSZW5kZXJCb2R5KHJhdzogc3RyaW5nLCBsaW1pdHM6IFJlbmRlckJvZHlMaW1pdHMpOiBQYXJzZVJlbmRlckJvZHlSZXN1bHQge1xuICBpZiAocmF3Lmxlbmd0aCA+IGxpbWl0cy5tYXhCb2R5Qnl0ZXMpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNDEzLCBtZXNzYWdlOiAncGF5bG9hZCB0b28gbGFyZ2UnIH1cbiAgfVxuICBsZXQgcGFyc2VkOiB1bmtub3duID0gbnVsbFxuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIHN0YXR1czogNDAwLCBtZXNzYWdlOiAnaW52YWxpZCBqc29uJyB9XG4gIH1cbiAgY29uc3Qgc291cmNlID0gcGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnXG4gICAgICAmJiB0eXBlb2YgKHBhcnNlZCBhcyB7IGRpYWdyYW1fc291cmNlPzogdW5rbm93biB9KS5kaWFncmFtX3NvdXJjZSA9PT0gJ3N0cmluZydcbiAgICA/IChwYXJzZWQgYXMgeyBkaWFncmFtX3NvdXJjZTogc3RyaW5nIH0pLmRpYWdyYW1fc291cmNlXG4gICAgOiAnJ1xuICBpZiAoc291cmNlLmxlbmd0aCA9PT0gMCB8fCBzb3VyY2UubGVuZ3RoID4gbGltaXRzLm1heERpYWdyYW1CeXRlcykge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgc3RhdHVzOiA0MDAsIG1lc3NhZ2U6ICdiYWQgZGlhZ3JhbSBzb3VyY2UnIH1cbiAgfVxuICByZXR1cm4geyBvazogdHJ1ZSwgc291cmNlIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBWUEsbUJBQTRGO0FBQzVGLG9CQUFzQzs7O0FDaUMvQixJQUFN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
