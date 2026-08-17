/**
 * Shared wire protocol between the node_repl MCP server and the dsh-browser-use
 * host broker. Modeled on ZCode/Codex Browser Use command surface.
 */

export interface BrowserTabSummary {
  tabId: string
  url?: string
  title?: string
  viewport: { width: number; height: number }
  active?: boolean
  lifecycle?: string
}

export interface BrowserUserTabInfo {
  id: string
  url?: string
  title?: string
}

export interface BrowserStateResult {
  url?: string
  title?: string
  canGoBack?: boolean
  canGoForward?: boolean
  viewport?: { width: number; height: number }
}

export interface BrowserSnapshotResult {
  url: string
  title: string
  text: string
  aria: string
  refs: Array<{
    ref: string
    tag: string
    text: string
    type?: string
    value?: string
    href?: string
    role?: string
  }>
  truncated: boolean
}

export interface BrowserImageResult {
  base64: string
  mimeType: string
}

export interface BrowserCommandResult {
  ok: boolean
  error?: { code: string; message: string; sideEffect?: string }
  elapsedMs: number
  tabs?: BrowserTabSummary[]
  tab?: BrowserTabSummary
  userTabs?: BrowserUserTabInfo[]
  state?: BrowserStateResult
  snapshot?: BrowserSnapshotResult
  image?: BrowserImageResult
  value?: unknown
  meta?: Record<string, unknown>
}

export interface BrowserListRequest {
  op: 'list'
  sessionId: string
  turnId?: string
}

export interface BrowserExecuteRequest {
  op: 'execute'
  browserId: string
  browserGeneration: number
  sessionId: string
  turnId?: string
  command: BrowserCommand
}

export type BrowserBrokerRequest = BrowserListRequest | BrowserExecuteRequest

export type BrowserBrokerResponse = {
  id: string
  ok: true
  browsers?: Array<{
    id: string
    generation: number
    type: string
    name: string
    capabilities: { browser: Array<{ id: string; description: string }>; tab: Array<{ id: string; description: string }> }
    apiSupportOverrides?: Record<string, boolean>
    metadata?: Record<string, string>
  }>
  result?: BrowserCommandResult
} | {
  id: string
  ok: false
  error: string
}

export type BrowserCommand =
  | { method: 'list' }
  | { method: 'listUserTabs' }
  | { method: 'newTab'; url?: string }
  | { method: 'activateTab'; tabId: string }
  | { method: 'claimTab'; tabId: string }
  | { method: 'close'; tabId?: string }
  | { method: 'navigate'; url: string }
  | { method: 'getState'; tabId?: string }
  | { method: 'back'; tabId?: string }
  | { method: 'forward'; tabId?: string }
  | { method: 'reload'; tabId?: string }
  | { method: 'snapshot'; tabId?: string }
  | { method: 'screenshot'; tabId?: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }
  | { method: 'click'; tabId?: string; ref?: string; selector?: string; x?: number; y?: number; button?: string; doubleClick?: boolean; modifiers?: string[] }
  | { method: 'type'; tabId?: string; ref?: string; selector?: string; text: string; submit?: boolean }
  | { method: 'press'; tabId?: string; ref?: string; key: string; modifiers?: string[] }
  | { method: 'scroll'; tabId?: string; direction?: string; amount?: number; x?: number; y?: number; scrollX?: number; scrollY?: number }
  | { method: 'select'; tabId?: string; ref?: string; selector?: string; values: string[] }
  | { method: 'check'; tabId?: string; ref?: string; selector?: string; checked?: boolean }
  | { method: 'hover'; tabId?: string; ref?: string; x?: number; y?: number }
  | { method: 'drag'; tabId?: string; fromRef?: string; toRef?: string; from?: { x: number; y: number }; to?: { x: number; y: number } }
  | { method: 'browserViewportSet'; tabId?: string; width: number; height: number }
  | { method: 'browserViewportReset'; tabId?: string }
  | { method: 'playwright'; tabId?: string; action: PlaywrightAction }
  | { method: 'playwrightWaitForTimeout'; tabId?: string; timeoutMs: number }
  | { method: 'nameSession'; name: string }
  | { method: 'finalizeTabs'; keep: Array<{ tabId: string; status: string }> }
  | { method: 'cancelRequest'; requestId: string }
  | { method: 'turnEnded'; turnId?: string }
  | { method: 'closeSession' }

export type PlaywrightAction =
  | { name: 'domSnapshot' }
  | { name: 'evaluate'; expression: string; expressionKind?: 'string' | 'function'; arg?: unknown; timeoutMs?: number }
  | { name: 'waitForLoadState'; state?: string; timeoutMs?: number }
  | { name: 'waitForURL'; url: string; timeoutMs?: number; waitUntil?: string }
  | { name: 'locator'; selector: string; operation: string; [key: string]: unknown }
  | { name: 'elementInfo'; x: number; y: number; includeNonInteractable?: boolean }

export function okResult(value: Partial<BrowserCommandResult> = {}, elapsedMs = 0): BrowserCommandResult {
  return { ok: true, elapsedMs, ...value }
}

export function errResult(code: string, message: string, elapsedMs = 0, sideEffect?: string): BrowserCommandResult {
  return { ok: false, elapsedMs, error: { code, message, ...(sideEffect ? { sideEffect } : {}) } }
}
