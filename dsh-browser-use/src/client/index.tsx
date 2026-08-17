import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots']

interface TabInfo {
  index: number
  url: string
  title: string
}

interface BrowserState {
  open: boolean
  tabs: TabInfo[]
  activeIndex: number
  viewport: { width: number; height: number } | null
  headless: boolean
}

async function postJson(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

const toolbarButtonStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '20px',
}

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
}

function BrowserPanel(_props: ConvViewProps): JSX.Element {
  const [state, setState] = useState<BrowserState | null>(null)
  const [url, setUrl] = useState('')
  const [shot, setShot] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/browser-use/state', { cache: 'no-store' })
      const data = (await res.json()) as BrowserState
      setState(data)
      if (data.open) {
        setShot(`/browser-use/screenshot.png?t=${Date.now()}`)
      } else {
        setShot('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 1200)
    return () => clearInterval(timer)
  }, [refresh])

  const act = useCallback(async (path: string, body?: unknown) => {
    setBusy(true)
    setError('')
    try {
      const data = await postJson(path, body)
      await refresh()
      return data
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const navigate = (raw: string): void => {
    const value = raw.trim()
    if (!value) return
    void act('/browser-use/navigate', { url: value })
  }

  const onImageClick = (e: MouseEvent<HTMLImageElement>): void => {
    const img = e.currentTarget
    const rect = img.getBoundingClientRect()
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return
    const x = ((e.clientX - rect.left) / rect.width) * img.naturalWidth
    const y = ((e.clientY - rect.top) / rect.height) * img.naturalHeight
    void act('/browser-use/click', { x, y })
  }

  const activeTab = state?.tabs.find((t) => t.index === state.activeIndex)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={toolbarButtonStyle} disabled={busy} onClick={() => void act('/browser-use/back')} title="后退">←</button>
        <button style={toolbarButtonStyle} disabled={busy} onClick={() => void act('/browser-use/forward')} title="前进">→</button>
        <button style={toolbarButtonStyle} disabled={busy} onClick={() => void act('/browser-use/reload')} title="刷新">⟳</button>
        <input
          style={inputStyle}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(url)
          }}
          placeholder={activeTab ? activeTab.url : '输入 URL 后回车'}
        />
        <button style={toolbarButtonStyle} disabled={busy} onClick={() => navigate(url)}>打开</button>
        <button style={toolbarButtonStyle} disabled={busy} onClick={() => void act('/browser-use/tab', { action: 'new' })} title="新标签页">+</button>
        <button style={toolbarButtonStyle} disabled={busy || !state?.open} onClick={() => void act('/browser-use/close')} title="关闭浏览器">✕</button>
      </div>

      {state && state.open && state.tabs.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid rgba(128,128,128,0.2)', overflowX: 'auto', flexWrap: 'nowrap' }}>
          {state.tabs.map((tab) => (
            <button
              key={tab.index}
              onClick={() => void act('/browser-use/tab', { action: 'switch', index: tab.index })}
              style={{
                ...toolbarButtonStyle,
                whiteSpace: 'nowrap',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                background: tab.index === state.activeIndex ? 'rgba(128,128,128,0.2)' : 'transparent',
                fontWeight: tab.index === state.activeIndex ? 600 : 400,
              }}
              title={tab.url}
            >
              {tab.title || tab.url || `标签 ${tab.index + 1}`}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', background: '#0f1115' }}>
        {shot ? (
          <img
            ref={imgRef}
            src={shot}
            alt="浏览器实时画面（点击可让 Agent 点击该位置）"
            onClick={onImageClick}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', cursor: 'crosshair', margin: '0 auto' }}
          />
        ) : (
          <div style={{ padding: 24, color: 'rgba(255,255,255,0.65)', textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px' }}>浏览器尚未启动。</p>
            <p style={{ margin: '0 0 12px' }}>让 Agent 调用 <code>browser_open</code>，或直接打开空白页：</p>
            <button style={toolbarButtonStyle} onClick={() => void act('/browser-use/navigate', { url: 'about:blank' })}>打开空白页</button>
          </div>
        )}
      </div>

      <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(128,128,128,0.2)', color: error ? '#ff6b6b' : 'rgba(128,128,128,0.8)', minHeight: 22 }}>
        {error || (state?.open ? `${activeTab?.title || ''} — ${activeTab?.url || ''}` : '未连接浏览器')}
      </div>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'browser-use',
      order: 20,
      label: () => '浏览器',
    }, BrowserPanel),
  ), 'dsh-browser-use: browser view')
}
