/**
 * dsh-mermaid-renderer — client 半边:把助手消息里的 ```mermaid 代码块
 * 原位替换成可交互 SVG 卡片(适配/缩放/平移、源码查看、复制、重试),
 * 跟随 GUI 主题,渲染走 host 同源代理。
 *
 * 配置契约:client bundle 无法拿到 host 侧的插件配置(boot graph 只含
 * id/url/rev/inject/immediately),所以启动时从 host 的 client-config 端点
 * 拉取配置快照,失败则回退到编译期默认值(与 host schema 默认值一致)。
 *
 * 平台纯度:值 import 只有 react / react-dom/client(平台模块表 seed 词),
 * @deepseek-ai/cordis 仅 type-only;跨包协作走 slots service。
 */
import { createElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { CLIENT_DEFAULTS, sanitizeClientConfig, type ClientConfig, type DarkColors } from './shared/client-config'
import { buildDarkInjection, clamp, fitScaleFor, summarizeError, uniquifySvgIds } from './shared/diagram'

// ── 契约常量 ────────────────────────────────────────────────────────────────
const MOUNT_CLASS = 'tcm-mount'
const CODE_BLOCK_CLASS = 'md-code-block'
const SLOT_NAME = 'conversation.chat.assistant-actions'
const SLOT_ID = 'mermaid-inline'
const SLOT_ORDER = 90
const RENDER_ENDPOINT = '/plugins/dsh-mermaid-renderer/render'
const CONFIG_ENDPOINT = '/plugins/dsh-mermaid-renderer/client-config'
const CONFIG_FETCH_TIMEOUT_MS = 5000

// ── 运行时契约(结构性类型,契约面见 dsh-client-ui-slots / host 半边) ──────
interface ThemeSnapshot {
  active?: { colorScheme?: 'light' | 'dark' } | null
}
type ThemeSnapshotOrNull = ThemeSnapshot | null
interface ThemeService {
  getTheme(): ThemeSnapshot
}
interface SlotRegisterOptions {
  name: string
  id?: string
  order?: number
  label?: string
}
type SlotComponent = (props: Record<string, unknown>) => unknown
interface SlotsService {
  inject(key: string, factory: () => void | (() => void)): void
  register(options: SlotRegisterOptions, component: SlotComponent): () => void
}

type RenderResult =
  | { ok: true; svg: string; darkRendered: boolean }
  | { ok: false; error: string }

interface MermaidInlineProps {
  source: string
  themeSvc?: ThemeService
  cordisCtx?: Context
}

// ── 配置存储:apply 时拉取 host 配置快照,成功前用编译期默认值 ──────────────
let liveConfig: ClientConfig = CLIENT_DEFAULTS
const configListeners = new Set<() => void>()

function setLiveConfig(cfg: ClientConfig): void {
  liveConfig = cfg
  for (const listener of configListeners) listener()
}

function subscribeConfig(listener: () => void): () => void {
  configListeners.add(listener)
  return () => {
    configListeners.delete(listener)
  }
}

function configNow(): ClientConfig {
  return liveConfig
}

async function loadClientConfig(): Promise<ClientConfig> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(CONFIG_ENDPOINT, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return sanitizeClientConfig(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

// ── 图标 ────────────────────────────────────────────────────────────────────
const ICON_PATHS: Record<string, [string, Record<string, string | number>][]> = {
  code: [
    ['polyline', { points: '16 18 22 12 16 6' }],
    ['polyline', { points: '8 6 2 12 8 18' }],
  ],
  copy: [
    ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  check: [['polyline', { points: '20 6 9 17 4 12' }]],
  zoomIn: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }],
    ['line', { x1: '11', y1: '8', x2: '11', y2: '14' }],
    ['line', { x1: '8', y1: '11', x2: '14', y2: '11' }],
  ],
  zoomOut: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }],
    ['line', { x1: '8', y1: '11', x2: '14', y2: '11' }],
  ],
  plus: [
    ['line', { x1: '12', y1: '5', x2: '12', y2: '19' }],
    ['line', { x1: '5', y1: '12', x2: '19', y2: '12' }],
  ],
  minus: [['line', { x1: '5', y1: '12', x2: '19', y2: '12' }]],
  maximize: [
    ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
    ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
    ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
    ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }],
  ],
  minimize: [
    ['path', { d: 'M8 3v3a2 2 0 0 1-2 2H3' }],
    ['path', { d: 'M21 8h-3a2 2 0 0 1-2-2V3' }],
    ['path', { d: 'M3 16h3a2 2 0 0 1 2 2v3' }],
    ['path', { d: 'M16 21v-3a2 2 0 0 1 2-2h3' }],
  ],
}

function Icon(props: { name: string; size?: number }) {
  const entries = ICON_PATHS[props.name]
  if (entries === undefined) return null
  const children = entries.map((entry, i) =>
    createElement(entry[0], Object.assign({ key: `i${i}` }, entry[1])),
  )
  return createElement('svg', {
    viewBox: '0 0 24 24',
    width: props.size || 14,
    height: props.size || 14,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    className: 'tcm-icon',
  }, children)
}

function IconBtn(props: {
  icon: string
  title: string
  size?: number
  className?: string
  onClick?: () => void
}) {
  return createElement('button', {
    type: 'button',
    className: props.className || 'tcm-btn',
    title: props.title,
    'aria-label': props.title,
    onClick: props.onClick,
  }, createElement(Icon, { name: props.icon, size: props.size }))
}

// ── 度量与重着色 ────────────────────────────────────────────────────────────
function measureSvg(hostEl: Element | null): { nw: number; nh: number } {
  if (hostEl === null) return { nw: 0, nh: 0 }
  const svg = hostEl.querySelector('svg')
  if (svg === null) return { nw: 0, nh: 0 }
  let nw = 0
  let nh = 0
  const wAttr = svg.getAttribute('width')
  const hAttr = svg.getAttribute('height')
  if (wAttr !== null && !wAttr.includes('%')) nw = parseFloat(wAttr)
  if (hAttr !== null && !hAttr.includes('%')) nh = parseFloat(hAttr)
  if (!(nw > 0)) {
    const vb = (svg as SVGSVGElement).viewBox
    if (vb !== null && vb.baseVal !== undefined) nw = vb.baseVal.width
  }
  if (!(nh > 0)) {
    const vb = (svg as SVGSVGElement).viewBox
    if (vb !== null && vb.baseVal !== undefined) nh = vb.baseVal.height
  }
  if (!(nw > 0)) nw = svg.getBoundingClientRect().width
  if (!(nh > 0)) nh = svg.getBoundingClientRect().height
  return { nw, nh }
}

function forceStyle(el: Element, props: Record<string, string>): void {
  const style = (el as HTMLElement).style
  for (const key of Object.keys(props)) {
    try {
      style.setProperty(key, props[key], 'important')
    } catch {
      try {
        el.setAttribute('style', `${String(el.getAttribute('style') || '')};${key}:${props[key]} !important`)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Kroki dark theme 的 class 布局固定,按调色板逐类重着色。 */
function recolorDark(hostEl: Element | null, colors: DarkColors): void {
  if (hostEl === null) return
  const svg = hostEl.querySelector('svg')
  if (svg === null) return
  for (const el of Array.from(svg.querySelectorAll('text, tspan'))) {
    forceStyle(el, { fill: colors.text })
  }
  for (const el of Array.from(svg.querySelectorAll('.node > rect, .node > circle, .node > ellipse, .node > polygon, .node > path, .actor > rect, .note > rect, .entityBox > rect, .attributeBox > rect, .task > rect, .section > rect'))) {
    forceStyle(el, { fill: colors.shape, stroke: colors.stroke })
  }
  for (const el of Array.from(svg.querySelectorAll('.cluster > rect, .cluster > polygon, .cluster > path'))) {
    forceStyle(el, { fill: colors.cluster, stroke: colors.stroke })
  }
  for (const el of Array.from(svg.querySelectorAll('.edgePath path, .flowchart-link path, .relation path'))) {
    forceStyle(el, { stroke: colors.edge, fill: 'none' })
  }
  for (const el of Array.from(svg.querySelectorAll('marker path'))) {
    forceStyle(el, { fill: colors.edge, stroke: 'none' })
  }
  for (const el of Array.from(svg.querySelectorAll('.edgeLabel rect'))) {
    forceStyle(el, { fill: colors.cluster, stroke: 'none' })
  }
}

// ── 渲染(同源代理)─────────────────────────────────────────────────────────
let svgSeq = 0
// 模块实例级随机盐:HMR 重载会重置 svgSeq,旧卡片未卸载时序号会撞
// (mermaid SVG 内部以 #container 引用自身,同页重复 id 会串图)。
const svgSalt = Math.random().toString(36).slice(2, 8)

async function renderOne(
  source: string,
  dark: boolean,
  cfg: ClientConfig,
  signal: AbortSignal,
): Promise<RenderResult> {
  const { diagram, injected } = buildDarkInjection(source, dark, cfg.themeAuto)
  try {
    const res = await fetch(RENDER_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        diagram_source: diagram,
        diagram_type: 'mermaid',
        output_format: 'svg',
      }),
      signal,
    })
    const text = await res.text()
    // 容忍 BOM / 前导空白:部分 Kroki 兼容服务会带 \uFEFF 或换行开头。
    const svgText = text.replace(/^\uFEFF/, '').trimStart()
    if (res.ok && svgText.startsWith('<svg')) {
      svgSeq += 1
      return { ok: true, svg: uniquifySvgIds(svgText, `tcm-svg-${svgSalt}-${svgSeq.toString(36)}`), darkRendered: injected }
    }
    return { ok: false, error: summarizeError(text || `HTTP ${res.status}`) }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: '渲染超时' }
    }
    return { ok: false, error: summarizeError(error instanceof Error ? error.message : String(error)) }
  }
}

function copyText(text: string): Promise<{ ok: boolean; error: string }> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text)
      .then(() => ({ ok: true, error: '' }))
      .catch((error: unknown) => ({ ok: false, error: String((error instanceof Error && error.message) || error) }))
  }
  return Promise.resolve({ ok: false, error: 'clipboard unavailable' })
}

// ── 卡片组件 ────────────────────────────────────────────────────────────────
interface DiagramCardProps {
  source: string
  result: RenderResult
  cfg: ClientConfig
}

function DiagramCard(props: DiagramCardProps) {
  const result = props.result
  const cfg = props.cfg
  const [showSource, setShowSource] = useState(false)
  const [copyNote, setCopyNote] = useState('')
  const [mode, setMode] = useState<'fit' | 'zoom'>('fit')
  const [metrics, setMetrics] = useState({ nw: 0, nh: 0 })
  const [fitScale, setFitScale] = useState(0)
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 })
  const svgHostRef = useRef<HTMLDivElement | null>(null)
  const fitBoxRef = useRef<HTMLDivElement | null>(null)
  const zoomBoxRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const cardDark = result.ok === true && result.darkRendered === true
  const svg = result.ok === true ? result.svg : ''

  useEffect(() => {
    if (cardDark) recolorDark(svgHostRef.current, cfg.darkColors)
    const m = measureSvg(svgHostRef.current)
    if (m.nw > 0 && m.nh > 0) setMetrics(m)
  }, [svg, showSource, mode, cardDark, cfg])

  useEffect(() => {
    if (!(metrics.nw > 0) || fitBoxRef.current === null) return
    const r = fitBoxRef.current.getBoundingClientRect()
    setFitScale(fitScaleFor(metrics.nw, metrics.nh, r.width, cfg.fitMaxHeight, cfg.zoomMinScale))
  }, [metrics, showSource, cfg])

  useEffect(() => {
    if (mode !== 'zoom') return undefined
    const box = zoomBoxRef.current
    if (box === null) return undefined
    const r = box.getBoundingClientRect()
    const s = fitScaleFor(metrics.nw, metrics.nh, r.width, r.height, cfg.zoomMinScale)
    const rs = s > 0 ? s : 1
    const centered = metrics.nw > 0
    setZoom({
      s: rs,
      x: centered ? (r.width - metrics.nw * rs) / 2 : 0,
      y: centered ? (r.height - metrics.nh * rs) / 2 : 0,
    })
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setZoom((z) => {
        const factor = e.deltaY > 0 ? 0.85 : 1.18
        const ns = clamp(z.s * factor, cfg.zoomMinScale, cfg.zoomMaxScale)
        const k = ns / z.s
        return { s: ns, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k }
      })
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('fit')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      box.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [mode, metrics, cfg])

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target
    if (target instanceof Element && typeof target.closest === 'function' && target.closest('.tcm-toolbar') !== null) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: zoom.x, oy: zoom.y }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (d === null) return
    setZoom((z) => ({ s: z.s, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }))
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  const zoomBy = (factor: number) => {
    const box = zoomBoxRef.current
    if (box === null) return
    const r = box.getBoundingClientRect()
    const cx = r.width / 2
    const cy = r.height / 2
    setZoom((z) => {
      const ns = clamp(z.s * factor, cfg.zoomMinScale, cfg.zoomMaxScale)
      const k = ns / z.s
      return { s: ns, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k }
    })
  }
  const zoomReset = () => {
    const box = zoomBoxRef.current
    if (box === null) return
    const r = box.getBoundingClientRect()
    const s = fitScaleFor(metrics.nw, metrics.nh, r.width, r.height, cfg.zoomMinScale)
    const rs = s > 0 ? s : 1
    const centered = metrics.nw > 0
    setZoom({
      s: rs,
      x: centered ? (r.width - metrics.nw * rs) / 2 : 0,
      y: centered ? (r.height - metrics.nh * rs) / 2 : 0,
    })
  }

  const svgHtml = { __html: svg }
  const canZoom = result.ok === true && !showSource

  const head = createElement('div', { className: 'tcm-card-head' },
    createElement('span', { className: 'tcm-card-title' }, 'Mermaid 图'),
    createElement(IconBtn, {
      icon: 'code',
      title: showSource ? '收起源码' : '查看源码',
      onClick: () => setShowSource((s) => !s),
    }),
    createElement(IconBtn, {
      icon: copyNote === 'done' ? 'check' : 'copy',
      title: '复制源码',
      onClick: () => {
        setCopyNote('pending')
        void copyText(props.source).then((r) => setCopyNote(r.ok === true ? 'done' : 'fail'))
      },
    }),
    canZoom
      ? createElement(IconBtn, {
        icon: mode === 'zoom' ? 'minimize' : 'zoomIn',
        title: mode === 'zoom' ? '收起' : '放大查看',
        onClick: () => setMode(mode === 'zoom' ? 'fit' : 'zoom'),
      })
      : null,
  )

  let body: ReactNode
  if (showSource) {
    body = createElement('pre', { className: 'tcm-source' }, props.source)
  } else if (result.ok === true) {
    if (mode === 'zoom') {
      const innerStyle = {
        position: 'absolute' as const,
        left: 0,
        top: 0,
        width: metrics.nw > 0 ? metrics.nw : '100%',
        height: metrics.nh > 0 ? metrics.nh : '100%',
        transform: `translate(${zoom.x}px,${zoom.y}px) scale(${zoom.s})`,
        transformOrigin: '0 0',
      }
      body = createElement('div', {
        className: 'tcm-zoom',
        ref: zoomBoxRef,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onDoubleClick: zoomReset,
        role: 'region',
        'aria-label': 'Mermaid 图缩放画布(拖动平移、滚轮缩放、双击适配、Esc 退出)',
      },
        createElement('div', { ref: svgHostRef, style: innerStyle, className: 'tcm-svg-layer', dangerouslySetInnerHTML: svgHtml }),
        createElement('div', { className: 'tcm-toolbar' },
          createElement(IconBtn, { className: 'tcm-tool-btn', icon: 'plus', size: 15, title: '放大', onClick: () => zoomBy(1.3) }),
          createElement(IconBtn, { className: 'tcm-tool-btn', icon: 'minus', size: 15, title: '缩小', onClick: () => zoomBy(0.77) }),
          createElement(IconBtn, { className: 'tcm-tool-btn', icon: 'maximize', size: 15, title: '适应窗口', onClick: zoomReset }),
        ),
        createElement('div', { className: 'tcm-hint' }, '拖动平移 · 滚轮缩放 · 双击适配 · Esc 退出'),
      )
    } else {
      const s = fitScale > 0 ? fitScale : 0
      const innerStyle = s > 0 ? {
        position: 'absolute' as const,
        left: 0,
        top: 0,
        width: metrics.nw,
        height: metrics.nh,
        transform: `scale(${s})`,
        transformOrigin: '0 0',
      } : { width: '100%' as const }
      const stageStyle = s > 0
        ? { width: Math.round(metrics.nw * s), height: Math.round(metrics.nh * s), position: 'relative' as const }
        : { position: 'relative' as const }
      body = createElement('div', { className: 'tcm-fit', ref: fitBoxRef },
        createElement('div', { style: stageStyle },
          createElement('div', { ref: svgHostRef, style: innerStyle, className: 'tcm-svg-layer', dangerouslySetInnerHTML: svgHtml }),
        ),
      )
    }
  } else {
    body = createElement('div', { className: 'tcm-error' }, `渲染失败: ${result.error || '未知错误'}`)
  }

  return createElement('div', { className: `tcm-card${cardDark ? ' tcm-card-dark' : ''}` }, head, body)
}

// ── 单图入口:拉取一次,主题变化重渲染,卸载/超时中止 ───────────────────────
type ReactPointerEvent = { button: number; clientX: number; clientY: number; pointerId: number; target: EventTarget | null; currentTarget: HTMLElement }

/** 订阅 GUI 主题变化;cordis 的 Events 表按 keyof 收紧,这里做字符串键的窄化面。 */
function subscribeTheme(ctx: Context, listener: (snap: ThemeSnapshotOrNull) => void): () => void {
  const emitter = ctx as unknown as {
    on(name: string, listener: (...args: unknown[]) => unknown): () => void
  }
  return emitter.on('theme/change', (snap: unknown) => listener(snap as ThemeSnapshotOrNull))
}

function MermaidInline(props: MermaidInlineProps) {
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; result: RenderResult | null; error: string | null }>({
    status: 'loading', result: null, error: null,
  })
  const [attempt, setAttempt] = useState(0)
  const [cfg, setCfg] = useState<ClientConfig>(() => configNow())
  const [themeSnap, setThemeSnap] = useState<ThemeSnapshotOrNull>(() => {
    const svc = props.themeSvc
    if (svc !== undefined && svc !== null && typeof svc.getTheme === 'function') {
      try {
        return svc.getTheme()
      } catch {
        return null
      }
    }
    return null
  })
  const dark = themeSnap?.active?.colorScheme === 'dark'

  useEffect(() => {
    const cordisCtx = props.cordisCtx
    if (cordisCtx === undefined || cordisCtx === null) return undefined
    const off = subscribeTheme(cordisCtx, (snap) => setThemeSnap(snap))
    return () => {
      off()
    }
    // 主题订阅一次即可,props 里 ctx 生命周期与 fiber 相同。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeConfig(() => setCfg(configNow())), [])

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.renderTimeoutMs)
    setState({ status: 'loading', result: null, error: null })
    void renderOne(props.source, dark, cfg, controller.signal)
      .then((result) => {
        if (!alive) return
        setState({ status: 'done', result, error: null })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setState({ status: 'error', result: null, error: summarizeError(error instanceof Error ? error.message : String(error)) })
      })
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [props.source, dark, attempt, cfg])

  if (state.status === 'loading') {
    return createElement('div', { className: 'tcm-note' }, '正在渲染 Mermaid 图…')
  }
  if (state.status === 'error' || state.result === null) {
    return createElement('div', { className: 'tcm-error' },
      `渲染失败: ${state.error || '未知错误'}`,
      createElement('button', {
        type: 'button',
        className: 'tcm-retry',
        onClick: () => setAttempt((a) => a + 1),
      }, '重试'),
    )
  }
  return createElement(DiagramCard, { source: props.source, result: state.result, cfg })
}

// ── 原位 DOM 手术 ──────────────────────────────────────────────────────────
const mountBlocks = new WeakMap<HTMLElement, Element>()
const mountRoots = new WeakMap<HTMLElement, Root>()

function blockLang(block: Element): string {
  const wrap = block.firstElementChild
  const banner = wrap === null ? null : wrap.firstElementChild
  const info = banner === null ? null : banner.firstElementChild
  return info === null ? '' : String(info.textContent || '').trim()
}

function readSource(block: Element): string {
  const pre = block.querySelector('pre')
  if (pre === null) return ''
  let text = String(pre.textContent || '')
  if (text.endsWith('\n')) text = text.slice(0, -1)
  return text
}

function removeMount(mount: HTMLElement): void {
  const root = mountRoots.get(mount)
  if (root !== undefined) {
    try {
      root.unmount()
    } catch {
      /* ignore */
    }
  }
  mount.remove()
}

function unhideBlock(block: Element): void {
  ;(block as HTMLElement).style.display = ''
  delete (block as HTMLElement).dataset.tcmReplaced
}

/** 把一个 mermaid 代码块原位替换为 React 渲染的图卡片。 */
function replaceBlock(block: Element, inlineProps: Omit<MermaidInlineProps, 'source'>): void {
  const source = readSource(block)
  if (source.length === 0) return
  const blockEl = block as HTMLElement
  blockEl.dataset.tcmReplaced = '1'
  blockEl.style.display = 'none'
  const mount = document.createElement('div')
  mount.className = MOUNT_CLASS
  block.parentNode?.insertBefore(mount, block.nextSibling)
  mountBlocks.set(mount, block)
  try {
    const root = createRoot(mount)
    mountRoots.set(mount, root)
    root.render(createElement(MermaidInline, { ...inlineProps, source }))
  } catch {
    mount.textContent = 'Mermaid 渲染挂载失败'
  }
}

/** 协调一行:清孤儿挂载点、修复被重放的替换、新增未替换的代码块。 */
function syncRow(row: Element, inlineProps: Omit<MermaidInlineProps, 'source'>): void {
  const mounts = Array.from(row.querySelectorAll(`.${MOUNT_CLASS}`)) as HTMLElement[]
  for (const mount of mounts) {
    const block = mountBlocks.get(mount)
    const healthy = block !== undefined && block.isConnected
      && mount.previousElementSibling === block
      && (block as HTMLElement).style.display === 'none'
      && (block as HTMLElement).dataset.tcmReplaced === '1'
    if (!healthy) removeMount(mount)
  }
  const blocks = Array.from(row.querySelectorAll(`.${CODE_BLOCK_CLASS}`))
  for (const block of blocks) {
    if (blockLang(block) !== 'mermaid') continue
    const mark = (block as HTMLElement).dataset.tcmReplaced === '1'
    const next = block.nextElementSibling
    const healthy = mark && (block as HTMLElement).style.display === 'none'
      && next !== null && next.classList.contains(MOUNT_CLASS)
      && mountBlocks.get(next as HTMLElement) === block
      && mountRoots.has(next as HTMLElement)
    if (healthy) continue
    if (mark) unhideBlock(block)
    if (next !== null && next.classList.contains(MOUNT_CLASS)) removeMount(next as HTMLElement)
    replaceBlock(block, inlineProps)
  }
}

/** 一轮的 row:从 tail row 向上收集到上一个 turn-tail row 为止。 */
function collectTurnRows(tailRow: HTMLElement): Element[] {
  const rows: Element[] = []
  let cur: Element | null = tailRow
  while (cur !== null) {
    rows.push(cur)
    cur = cur.previousElementSibling
    if (cur !== null && cur.getAttribute('data-chat-flow-kind') === 'turn-tail') break
  }
  return rows
}

function restoreRows(rows: Element[]): void {
  for (const row of rows) {
    if (!row.isConnected) continue
    for (const mount of Array.from(row.querySelectorAll(`.${MOUNT_CLASS}`)) as HTMLElement[]) {
      removeMount(mount)
    }
    for (const block of Array.from(row.querySelectorAll(`.${CODE_BLOCK_CLASS}`))) {
      if ((block as HTMLElement).dataset.tcmReplaced === '1') unhideBlock(block)
    }
  }
}

interface MermaidDriverProps extends Record<string, unknown> {
  themeSvc?: ThemeService
  cordisCtx?: Context
}

/** 不可见的 tail 入口,驱动它所在轮的代码块原位替换。 */
function MermaidDriver(props: MermaidDriverProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return undefined
    const tailRow = anchor.closest('[data-chat-flow-kind]')
    if (tailRow === null || tailRow.parentElement === null) return undefined
    const list = tailRow.parentElement
    const inlineProps = { themeSvc: props.themeSvc, cordisCtx: props.cordisCtx }
    let rafPending = false
    const scan = () => {
      // 每次扫描重新推导本轮的 rows:廉价,且列表重排/向上追加历史时依然稳健。
      const rows = collectTurnRows(tailRow as HTMLElement)
      for (const row of rows) {
        if (row.isConnected) syncRow(row, inlineProps)
      }
    }
    scan()
    const observer = new MutationObserver(() => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        scan()
      })
    })
    observer.observe(list, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      restoreRows(collectTurnRows(tailRow as HTMLElement))
    }
    // 驱动只随自身挂载生命周期运行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createElement('span', { ref: anchorRef, style: { display: 'none' } })
}

// ── 样式(配置驱动)─────────────────────────────────────────────────────────
function buildCss(cfg: ClientConfig): string {
  const d = cfg.darkColors
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
    `@media (prefers-reduced-motion: reduce){.tcm-btn,.tcm-tool-btn,.tcm-retry{transition:none}}`,
  ].join('\n')
}

// ── 插件 ────────────────────────────────────────────────────────────────────
export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  // style 注入归属 fiber:挂/摘都在 effect 里,fiber 启动失败不会泄漏节点。
  const styleTag = document.createElement('style')
  styleTag.setAttribute('data-plugin', 'dsh-mermaid-renderer')
  styleTag.textContent = buildCss(CLIENT_DEFAULTS)
  ctx.effect(() => {
    document.head.appendChild(styleTag)
    return () => {
      styleTag.remove()
    }
  }, 'dsh-mermaid-renderer: base styles')
  // 配置快照:成功前用默认值渲染,成功后热替换 CSS 与运行时参数。
  void loadClientConfig()
    .then((cfg) => {
      setLiveConfig(cfg)
      if (styleTag.isConnected) styleTag.textContent = buildCss(cfg)
    })
    .catch(() => {
      /* 保持编译期默认值 */
    })
  const themeSvc = ctx.get('theme') as ThemeService | undefined
  const driverProps = { themeSvc, cordisCtx: ctx }
  // 附加式 list slot:每个定稿助手消息一条,不与其他尾巴交付链竞争。
  slots.inject(SLOT_NAME, () => slots.register(
    { name: SLOT_NAME, id: SLOT_ID, order: SLOT_ORDER },
    (props) => createElement(MermaidDriver, { ...props, ...driverProps }),
  ))
}

export const inject = ['slots']
export const name = 'dsh-mermaid-renderer'
