/**
 * dsh-browser-use Browser Use client facade (Codex/ZCode compatible subset).
 *
 * The node_repl MCP server injects a bridge under
 * Symbol.for('dsh.node-repl.browser-control-bridge'); calling
 * setupBrowserRuntime({ globals }) attaches `agent.browsers` and
 * `agent.documentation` to the given globals object.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const BRIDGE_SYMBOL = Symbol.for('dsh.node-repl.browser-control-bridge')

function readBridge(globals) {
  const bridge = globals[BRIDGE_SYMBOL]
  if (!bridge || typeof bridge !== 'object') {
    throw new Error('Browser runtime bridge is unavailable. Use Browser from a dsh-browser-use session.')
  }
  return bridge
}

function expectOk(result) {
  if (!result?.ok) {
    const code = result?.error?.code ?? 'browser_command_failed'
    const message = result?.error?.message ?? 'Browser command failed'
    throw new Error(`${code}: ${message}`)
  }
  return result
}

function bytesFromBase64(base64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'))
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function filterApi(api, info) {
  const overrides = info?.apiSupportOverrides ?? {}
  const objects = {}
  for (const [objectName, object] of Object.entries(api.objects ?? {})) {
    const members = (object.members ?? []).filter((member) => overrides[member.name] !== false)
    if (members.length > 0 || object.kind === 'property') {
      objects[objectName] = { ...object, members }
    }
  }
  return { ...api, objects }
}

async function readDocumentation(info, root) {
  const parts = []
  let apiJson = null
  try {
    apiJson = JSON.parse(await readFile(join(root, 'api.json'), 'utf8'))
    const filtered = filterApi(apiJson, info)
    parts.push(`# Browser Use API${apiJson.version ? ` (v${apiJson.version})` : ''}\n\n${JSON.stringify(filtered, null, 2)}`)
  } catch (error) {
    parts.push(`# Browser Use API\n\n> api.json unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const documents = JSON.parse(await readFile(join(root, 'documents.json'), 'utf8'))
    for (const doc of documents.documents ?? []) {
      if (doc.mode !== 'included') continue
      const text = await readFile(join(root, doc.path), 'utf8')
      parts.push(`# ${doc.title}\n\n${text}`)
    }
  } catch (error) {
    parts.push(`> documents.json unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const files = await readdir(root)
    for (const file of files.sort()) {
      if (!file.endsWith('.md') || file === 'README.md') continue
      const path = relative(root, join(root, file))
      const text = await readFile(join(root, path), 'utf8')
      parts.push(`# ${file.replace(/\.md$/, '')}\n\n${text}`)
    }
  } catch {
    // optional; ignore when the docs directory is not readable
  }

  return parts.join('\n\n---\n\n')
}

function serializeMatcher(value, exact, method) {
  if (typeof value === 'string') return `${JSON.stringify(value)}${exact ? 's' : 'i'}`
  if (value instanceof RegExp) return value.toString()
  throw new Error(`${method} requires a string or RegExp`)
}

function roleSelector(role, options = {}) {
  const name = options.name === undefined ? '' : `[name=${serializeMatcher(options.name, Boolean(options.exact), 'getByRole')}]`
  return `internal:role=${role}${name}`
}

function textSelector(text, exact = false) {
  return `internal:text=${serializeMatcher(text, exact, 'getByText')}`
}

function labelSelector(text, exact = false) {
  return `internal:label=${serializeMatcher(text, exact, 'getByLabel')}`
}

function placeholderSelector(text, exact = false) {
  return `internal:attr=[placeholder=${serializeMatcher(text, exact, 'getByPlaceholder')}]`
}

function testIdSelector(testId) {
  return `internal:testid=[data-testid=${JSON.stringify(testId)}s]`
}

class PlaywrightLocator {
  constructor(run, owner, selector) {
    this.run = run
    this.owner = owner
    this.selector = selector
  }

  child(selector) {
    return new PlaywrightLocator(this.run, this.owner, `${this.selector} >> ${selector}`)
  }

  async action(operation, fields = {}) {
    const result = await this.run({
      method: 'playwright',
      action: { name: 'locator', selector: this.selector, operation, ...fields },
    })
    return expectOk(result).value
  }

  count() { return this.action('count') }
  click(options = {}) { return this.action('click', options) }
  dblclick(options = {}) { return this.action('dblclick', options) }
  fill(value, options = {}) { return this.action('fill', { value, ...options }) }
  press(value, options = {}) { return this.action('press', { value, ...options }) }
  selectOption(value, options = {}) { return this.action('selectOption', { selections: Array.isArray(value) ? value : [value], ...options }) }
  check(options = {}) { return this.action('check', options) }
  uncheck(options = {}) { return this.action('uncheck', options) }
  setChecked(checked, options = {}) { return this.action('setChecked', { checked, ...options }) }
  textContent(options = {}) { return this.action('textContent', options) }
  innerText(options = {}) { return this.action('innerText', options) }
  getAttribute(name, options = {}) { return this.action('getAttribute', { attribute: name, ...options }) }
  isVisible() { return this.action('isVisible') }
  isEnabled() { return this.action('isEnabled') }
  allTextContents(options = {}) { return this.action('allTextContents', options) }
  waitFor(options) { return this.action('waitFor', options) }

  getByRole(role, options = {}) { return this.child(roleSelector(role, options)) }
  getByText(text, options = {}) { return this.child(textSelector(text, Boolean(options.exact))) }
  getByLabel(text, options = {}) { return this.child(labelSelector(text, Boolean(options.exact))) }
  getByPlaceholder(text, options = {}) { return this.child(placeholderSelector(text, Boolean(options.exact))) }
  getByTestId(testId) { return this.child(testIdSelector(testId)) }
  locator(selector, options = {}) { return this.child(selector) }
  filter(options = {}) {
    let selector = this.selector
    if (options.hasText !== undefined) selector += ` >> internal:has-text=${serializeMatcher(options.hasText, false, 'filter')}`
    if (options.hasNotText !== undefined) selector += ` >> internal:has-not-text=${serializeMatcher(options.hasNotText, false, 'filter')}`
    return new PlaywrightLocator(this.run, this.owner, selector)
  }
  first() { return this.child('nth=0') }
  last() { return this.child('nth=-1') }
  nth(index) { return this.child(`nth=${index}`) }
}

class PlaywrightAPI {
  constructor(run) {
    this.run = run
  }

  locator(selector) { return new PlaywrightLocator(this.run, this, selector) }
  getByRole(role, options = {}) { return this.locator(roleSelector(role, options)) }
  getByText(text, options = {}) { return this.locator(textSelector(text, Boolean(options.exact))) }
  getByLabel(text, options = {}) { return this.locator(labelSelector(text, Boolean(options.exact))) }
  getByPlaceholder(text, options = {}) { return this.locator(placeholderSelector(text, Boolean(options.exact))) }
  getByTestId(testId) { return this.locator(testIdSelector(testId)) }

  async domSnapshot() {
    const result = expectOk(await this.run({ method: 'snapshot' }))
    const snapshot = result.snapshot ?? {}
    return snapshot.aria || snapshot.text || ''
  }

  async evaluate(pageFunction, arg) {
    const expression = typeof pageFunction === 'function' ? `(${pageFunction.toString()})()` : String(pageFunction)
    const result = expectOk(await this.run({ method: 'playwright', action: { name: 'evaluate', expression, arg } }))
    return result.value
  }

  async waitForLoadState(options = {}) {
    await this.run({ method: 'playwright', action: { name: 'waitForLoadState', state: options.state, timeoutMs: options.timeoutMs } })
  }

  async waitForURL(url, options = {}) {
    await this.run({ method: 'playwright', action: { name: 'waitForURL', url, timeoutMs: options.timeoutMs, waitUntil: options.waitUntil } })
  }

  async waitForTimeout(timeoutMs) {
    await this.run({ method: 'playwrightWaitForTimeout', timeoutMs })
  }
}

class Tab {
  constructor(execute, tabId, viewport = { width: 1280, height: 720 }) {
    this.execute = execute
    this.id = tabId
    this.viewportSizeValue = viewport
    this.playwright = new PlaywrightAPI((command) => this.execute({ ...command, tabId: this.id }))
  }

  async goto(url) {
    expectOk(await this.execute({ method: 'navigate', url, tabId: this.id }))
  }

  async url() {
    const state = expectOk(await this.execute({ method: 'getState', tabId: this.id })).state
    return state?.url
  }

  async title() {
    const state = expectOk(await this.execute({ method: 'getState', tabId: this.id })).state
    return state?.title
  }

  async screenshot(options = {}) {
    const result = expectOk(await this.execute({ method: 'screenshot', tabId: this.id, ...options }))
    return bytesFromBase64(result.image.base64)
  }

  async setViewportSize({ width, height }) {
    expectOk(await this.execute({ method: 'browserViewportSet', tabId: this.id, width, height }))
    this.viewportSizeValue = { width, height }
  }

  viewportSize() {
    return this.viewportSizeValue ? { ...this.viewportSizeValue } : null
  }

  async close() {
    expectOk(await this.execute({ method: 'close', tabId: this.id }))
  }

  async back() { expectOk(await this.execute({ method: 'back', tabId: this.id })) }
  async forward() { expectOk(await this.execute({ method: 'forward', tabId: this.id })) }
  async reload() { expectOk(await this.execute({ method: 'reload', tabId: this.id })) }
}

class BrowserTabs {
  constructor(execute) {
    this.execute = execute
  }

  async list() {
    const result = expectOk(await this.execute({ method: 'list' }))
    return (result.tabs ?? []).map((tab) => ({
      id: tab.tabId,
      viewport: tab.viewport,
      ...(tab.active ? { active: true } : {}),
      ...(tab.url ? { url: tab.url } : {}),
      ...(tab.title ? { title: tab.title } : {}),
    }))
  }

  async get(tabId) {
    const result = expectOk(await this.execute({ method: 'activateTab', tabId }))
    const tab = result.tab
    if (!tab) throw new Error(`Browser tab '${tabId}' is unavailable`)
    return new Tab((command) => this.execute(command), tab.tabId, tab.viewport)
  }

  async new() {
    const result = expectOk(await this.execute({ method: 'newTab' }))
    const tab = result.tab ?? result.tabs?.at(-1)
    if (!tab) throw new Error('Browser did not return a new tab')
    return new Tab((command) => this.execute(command), tab.tabId, tab.viewport)
  }

  async selected() {
    const tabs = await this.list()
    const active = tabs.find((tab) => tab.active === true) ?? tabs.at(-1)
    if (!active) return undefined
    return this.get(active.id)
  }
}

class BrowserUser {
  constructor(execute) {
    this.execute = execute
  }

  async openTabs() {
    const result = expectOk(await this.execute({ method: 'listUserTabs' }))
    return result.userTabs ?? []
  }

  async claimTab(tab) {
    const id = typeof tab === 'string' ? tab : tab?.id
    const result = expectOk(await this.execute({ method: 'claimTab', tabId: id }))
    const summary = result.tab
    if (!summary) throw new Error(`User tab '${id}' is unavailable`)
    return new Tab((command) => this.execute(command), summary.tabId, summary.viewport)
  }
}

class Browser {
  constructor(info, execute, readDocumentation) {
    this.info = info
    this.browserId = info.id
    this.type = info.type
    this.generation = info.generation
    this.execute = (command) => execute(info.id, info.generation, command)
    this.tabs = new BrowserTabs(this.execute)
    this.user = new BrowserUser(this.execute)
    this.capabilities = {
      list: async () => info.capabilities?.browser ?? [],
      get: async (id) => (info.capabilities?.browser ?? []).find((cap) => cap.id === id),
    }
    this.documentation = async () => readDocumentation()
  }
}

class BrowsersFacade {
  constructor(bridge) {
    this.bridge = bridge
    this.browsers = new Map()
  }

  async listAvailable() {
    return this.bridge.list()
  }

  async list() {
    const infos = await this.listAvailable()
    return infos.map(({ generation, ...descriptor }) => descriptor)
  }

  browserFor(info) {
    const existing = this.browsers.get(info.id)
    if (existing && existing.generation === info.generation) return existing
    const browser = new Browser(
      info,
      async (browserId, browserGeneration, command) => this.bridge.execute(browserId, browserGeneration, command),
      async () => readDocumentation(info, this.bridge.documentationRoot),
    )
    this.browsers.set(info.id, browser)
    return browser
  }

  async get(idOrType) {
    const infos = await this.listAvailable()
    const info = infos.find((candidate) => candidate.id === idOrType) ?? infos.find((candidate) => candidate.type === idOrType)
    if (!info) throw new Error(`Browser backend '${idOrType}' is unavailable`)
    return this.browserFor(info)
  }

  async getDefault() {
    const infos = await this.listAvailable()
    if (infos.length === 0) throw new Error('No browser backend is available')
    return this.browserFor(infos[0])
  }

  async getForUrl(_url) {
    return this.getDefault()
  }
}

export function setupBrowserRuntime({ globals }) {
  const bridge = readBridge(globals)
  bridge.assertAvailable?.()
  const agent = globals.agent ??= {}
  agent.browsers = new BrowsersFacade(bridge)
  agent.documentation = Object.freeze({
    get: async (name) => {
      if (!name) throw new TypeError('agent.documentation.get requires a document name')
      return `Browser documentation for ${name} is provided by the dsh-browser-use plugin.`
    },
  })
}
