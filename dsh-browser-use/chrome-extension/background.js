// dsh Browser Use — real Chrome bridge.
// Connects to dsh host at ws://127.0.0.1:3080/browser-use/extension and executes
// browser commands against the user's real Chrome.
//
// P0: real CDP input via chrome.debugger (Input.dispatchMouseEvent,
// Input.dispatchKeyEvent / Input.insertText, Page.captureScreenshot,
// Page.javascriptDialogOpening / Page.handleJavaScriptDialog,
// Page.navigateToHistoryEntry).

const HOST = '127.0.0.1';
const PORT = 3080;
const WS_URL = `ws://${HOST}:${PORT}/browser-use/extension`;

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const pending = new Map();

const AGENT_TABS_KEY = 'agentTabIds';

// ---- chrome.debugger CDP state ----
const DEBUGGER_ATTACHED = new Set();
const pendingDialogs = new Map();
// Keep JS dialogs from blocking the page until a host `dialog` command exists.
// Set to false once the host protocol exposes dialog control; the command
// branch below already supports Page.handleJavaScriptDialog.
let autoDismissDialogs = true;

async function getAgentTabIds() {
  const data = await chrome.storage.session.get(AGENT_TABS_KEY);
  return new Set(data[AGENT_TABS_KEY] || []);
}

async function setAgentTabIds(ids) {
  await chrome.storage.session.set({ [AGENT_TABS_KEY]: [...ids] });
}

async function markAgentTab(tabId) {
  const ids = await getAgentTabIds();
  ids.add(tabId);
  await setAgentTabIds(ids);
}

async function unmarkAgentTab(tabId) {
  const ids = await getAgentTabIds();
  ids.delete(tabId);
  await setAgentTabIds(ids);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(WS_URL);
  socket.onopen = () => {
    reconnectDelay = 1000;
    socket.send(JSON.stringify({ type: 'hello', name: 'dsh-chrome-extension' }));
    console.log('[dsh-browser-use] connected to dsh host');
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'command') {
      handleCommand(message.id, message.command);
    }
  };
  socket.onclose = () => {
    socket = null;
    rejectAll('Chrome extension disconnected');
    scheduleReconnect();
  };
  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

function sendResponse(id, result) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'response', id, result }));
  }
}

function rejectAll(message) {
  for (const { reject } of pending.values()) reject(new Error(message));
  pending.clear();
}

async function executeScript(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results?.[0]?.result;
}

// ---- CDP helpers ----

function cdpAttach(tabId) {
  return new Promise((resolve, reject) => {
    if (DEBUGGER_ATTACHED.has(tabId)) {
      resolve();
      return;
    }
    chrome.debugger.attach({ tabId }, '1.3', () => {
      const error = chrome.runtime.lastError;
      if (error) {
        if (/already attached/i.test(error.message || '')) {
          DEBUGGER_ATTACHED.add(tabId);
          resolve();
          return;
        }
        reject(new Error(error.message || 'Failed to attach debugger'));
        return;
      }
      DEBUGGER_ATTACHED.add(tabId);
      resolve();
    });
  });
}

function cdpDetach(tabId) {
  return new Promise((resolve) => {
    if (!DEBUGGER_ATTACHED.has(tabId)) {
      resolve();
      return;
    }
    chrome.debugger.detach({ tabId }, () => {
      DEBUGGER_ATTACHED.delete(tabId);
      resolve();
    });
  });
}

function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || `CDP ${method} failed`));
        return;
      }
      resolve(result);
    });
  });
}

async function cdpEnablePage(tabId) {
  await cdpAttach(tabId);
  await cdpSend(tabId, 'Page.enable');
}

function modifiersToBitfield(modifiers = []) {
  let bits = 0;
  for (const mod of modifiers) {
    const name = String(mod).toLowerCase();
    if (name === 'alt') bits |= 1;
    else if (name === 'ctrl' || name === 'control') bits |= 2;
    else if (name === 'meta' || name === 'command' || name === 'cmd') bits |= 4;
    else if (name === 'shift') bits |= 8;
  }
  return bits;
}

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' },
  '.': { key: '.', code: 'Period', vk: 190, text: '.' },
  ',': { key: ',', code: 'Comma', vk: 188, text: ',' },
};

function normalizeKey(key) {
  if (KEY_DEFS[key]) return KEY_DEFS[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = /^[a-z]$/i.test(key) ? `Key${upper}` : /^[0-9]$/.test(key) ? `Digit${key}` : '';
    return { key: key === ' ' ? ' ' : key, code, vk: upper.charCodeAt(0), text: key };
  }
  return { key, code: key, vk: 0 };
}

async function cdpPressKey(tabId, key, modifiers = []) {
  const mods = modifiersToBitfield(modifiers);
  const def = normalizeKey(key);
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.vk,
    nativeVirtualKeyCode: def.vk,
    modifiers: mods,
  };
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  if (def.text) {
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: def.text,
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      modifiers: mods,
    });
  }
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function cdpMouseClick(tabId, point, options = {}) {
  const button = options.button || 'left';
  const doubleClick = Boolean(options.doubleClick);
  const mods = modifiersToBitfield(options.modifiers || []);
  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    modifiers: mods,
  });
  const clickCount = doubleClick ? 2 : 1;
  const press = {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button,
    clickCount,
    modifiers: mods,
  };
  const release = {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button,
    clickCount,
    modifiers: mods,
  };
  await cdpSend(tabId, 'Input.dispatchMouseEvent', press);
  await cdpSend(tabId, 'Input.dispatchMouseEvent', release);
  if (doubleClick) {
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { ...press, clickCount: 2 });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { ...release, clickCount: 2 });
  }
}

// ---- snapshot / ref helpers (same contract as dsh-browser-use host) ----
//
// Every function below is injected with chrome.scripting.executeScript, so it
// must be self-contained: it cannot rely on background-service-worker globals.

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
].join(',');

function snapshotInPage() {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const refs = [];
  const seen = new Set();
  const elements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  let count = 0;
  for (const el of elements) {
    if (seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const tag = el.tagName.toLowerCase();
    let text = '';
    if (el instanceof HTMLInputElement) {
      text = el.placeholder || el.name || el.getAttribute('aria-label') || '';
      const sensitive = el.type === 'password' || (el.autocomplete || '').toLowerCase().startsWith('cc-');
      const value = sensitive ? '••••' : el.value;
      refs.push({ ref: `e${++count}`, tag, text, type: el.type || 'text', value });
    } else if (el instanceof HTMLTextAreaElement) {
      text = el.placeholder || el.name || el.getAttribute('aria-label') || '';
      refs.push({ ref: `e${++count}`, tag, text, type: 'textarea', value: el.value });
    } else if (el instanceof HTMLSelectElement) {
      text = el.name || el.getAttribute('aria-label') || '';
      const options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 20).join(' | ');
      refs.push({ ref: `e${++count}`, tag, text, type: 'select', value: options });
    } else {
      text = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const href = el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href') || undefined;
      const role = el.getAttribute('role') || undefined;
      const entry = { ref: `e${++count}`, tag, text };
      if (href) entry.href = href;
      if (role) entry.role = role;
      refs.push(entry);
    }
    if (count >= 200) break;
  }

  function buildAria() {
    const lines = [];
    const ROLE_MAP = {
      A: 'link', BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox',
      NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
      ASIDE: 'complementary', FORM: 'form', IMG: 'img', UL: 'list', OL: 'list',
      LI: 'listitem', TABLE: 'table', THEAD: 'rowgroup', TBODY: 'rowgroup',
      TR: 'row', TH: 'columnheader', TD: 'cell', DIALOG: 'dialog',
      H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    };
    const MAX_LINES = 500;

    function isVisible(el) {
      if (el.hidden) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }

    function roleOf(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      if (el instanceof HTMLInputElement) {
        const type = el.type || 'text';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      if (ROLE_MAP[el.tagName]) return ROLE_MAP[el.tagName];
      return '';
    }

    function nameOf(el) {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const parts = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').filter(Boolean);
        if (parts.length) return parts.join(' ').trim();
      }
      if (el instanceof HTMLInputElement) return el.placeholder || el.name || el.getAttribute('aria-label') || '';
      if (el instanceof HTMLTextAreaElement) return el.placeholder || el.name || el.getAttribute('aria-label') || '';
      if (el instanceof HTMLSelectElement) return el.name || el.getAttribute('aria-label') || '';
      if (el instanceof HTMLImageElement) return el.alt || '';
      const text = (el.getAttribute('title') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      return text;
    }

    function statesOf(el) {
      const states = [];
      if (el.disabled) states.push('disabled');
      if (el.getAttribute('aria-checked') === 'true' || el.checked === true) states.push('checked');
      if (el.getAttribute('aria-expanded') === 'true') states.push('expanded');
      if (el.getAttribute('aria-selected') === 'true') states.push('selected');
      return states;
    }

    function walk(root, depth) {
      for (const child of root.children) {
        if (!isVisible(child)) continue;
        const role = roleOf(child);
        if (role) {
          const name = nameOf(child);
          const states = statesOf(child);
          const label = [role, name ? `"${name}"` : '', ...(states.length ? [`[${states.join(' ')}]`] : [])].filter(Boolean).join(' ');
          lines.push('  '.repeat(depth) + '- ' + label);
          if (lines.length >= MAX_LINES) return;
          walk(child, depth + 1);
        } else {
          walk(child, depth);
        }
        if (lines.length >= MAX_LINES) return;
      }
    }

    walk(document.body, 0);
    return lines.join('\n');
  }

  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').trim(),
    aria: buildAria(),
    refs,
  };
}

function elementByRef(ref) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  if (!Number.isInteger(index)) return null;
  const elements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  let visible = 0;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (visible === index) return el;
    visible += 1;
  }
  return null;
}

function pointForRef(ref) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  if (!Number.isInteger(index)) return { ok: false, error: `invalid ref ${ref}` };
  const elements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  let visible = 0;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (visible === index) {
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }
    visible += 1;
  }
  return { ok: false, error: `ref ${ref} not found` };
}

function pointForSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: `selector ${selector} not found` };
  const rect = el.getBoundingClientRect();
  return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

function prepareInputInPage(ref, selector) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const elements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  let el = null;
  if (ref) {
    const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
    if (Number.isInteger(index)) {
      let visible = 0;
      for (const candidate of elements) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        if (visible === index) {
          el = candidate;
          break;
        }
        visible += 1;
      }
    }
  } else if (selector) {
    el = document.querySelector(selector);
  }
  if (!el) return { ok: false, error: 'input target not found' };
  el.focus();
  if (typeof el.select === 'function') {
    el.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return { ok: true };
}

function clickInPage(ref) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  let el = null;
  if (Number.isInteger(index)) {
    let visible = 0;
    for (const candidate of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (visible === index) {
        el = candidate;
        break;
      }
      visible += 1;
    }
  }
  if (!el) return { ok: false, error: `ref ${ref} not found` };
  el.click();
  return { ok: true };
}

function typeInPage(ref, text, submit) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  let el = null;
  if (Number.isInteger(index)) {
    let visible = 0;
    for (const candidate of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (visible === index) {
        el = candidate;
        break;
      }
      visible += 1;
    }
  }
  if (!el) return { ok: false, error: `ref ${ref} not found` };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    return { ok: false, error: 'ref is not an input element' };
  }
  if (submit) el.form?.requestSubmit?.();
  return { ok: true };
}

function selectInPage(ref, values) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  let el = null;
  if (Number.isInteger(index)) {
    let visible = 0;
    for (const candidate of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (visible === index) {
        el = candidate;
        break;
      }
      visible += 1;
    }
  }
  if (!el || !(el instanceof HTMLSelectElement)) return { ok: false, error: 'ref is not a select' };
  const picked = [];
  for (const option of Array.from(el.options)) {
    if (values.includes(option.value) || values.includes(option.text)) {
      option.selected = true;
      picked.push(option.value);
    }
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: picked };
}

function pressInPage(ref, key) {
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
  ].join(',');
  const index = Number(/^e(\d+)$/i.exec(ref)?.[1]) - 1;
  let el = null;
  if (Number.isInteger(index)) {
    let visible = 0;
    for (const candidate of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (visible === index) {
        el = candidate;
        break;
      }
      visible += 1;
    }
  }
  if (el) el.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  return { ok: true };
}

function scrollInPage(direction, amount, x, y) {
  if (typeof x === 'number' && typeof y === 'number') {
    window.scrollBy(x, y);
  } else {
    const dir = direction || 'down';
    const amt = amount || 800;
    if (dir === 'top' || dir === 'bottom') window.scrollTo({ top: dir === 'top' ? 0 : document.body.scrollHeight, behavior: 'instant' });
    else window.scrollBy(dir === 'left' ? -amt : dir === 'right' ? amt : 0, dir === 'up' ? -amt : dir === 'down' ? amt : 0);
  }
  return { ok: true };
}

function locatorInPage(selector, operation, fields) {
  const elements = Array.from(document.querySelectorAll(selector));
  switch (operation) {
    case 'count': return { ok: true, value: elements.length };
    case 'click': elements[0]?.click(); return { ok: true };
    case 'dblclick': {
      const el = elements[0];
      if (el) {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      }
      return { ok: true };
    }
    case 'fill': {
      const el = elements[0];
      if (!el) return { ok: false, error: 'locator not found' };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, String(fields.value ?? ''));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true };
    }
    case 'press': elements[0]?.focus(); return { ok: true };
    case 'textContent': return { ok: true, value: elements[0]?.textContent ?? null };
    case 'innerText': return { ok: true, value: elements[0]?.innerText ?? '' };
    case 'isVisible': return { ok: true, value: !!elements[0] };
    case 'isEnabled': return { ok: true, value: !!elements[0] && !elements[0].disabled };
    default: return { ok: false, error: `locator.${operation} not supported` };
  }
}

// ---- command handlers ----

async function handleCommand(id, command) {
  try {
    const result = await dispatch(command);
    sendResponse(id, result);
  } catch (error) {
    sendResponse(id, {
      ok: false,
      elapsedMs: 0,
      error: { code: 'execution_error', message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function dispatch(command) {
  const method = command.method;
  switch (method) {
    case 'list': {
      const agentIds = await getAgentTabIds();
      const tabs = await chrome.tabs.query({});
      return {
        ok: true,
        tabs: tabs.map((tab) => ({
          tabId: String(tab.id),
          url: tab.url || '',
          title: tab.title || '',
          active: tab.active === true,
          viewport: { width: 1280, height: 720 },
          ...(agentIds.has(tab.id) ? { lifecycle: 'agent' } : {}),
        })),
      };
    }
    case 'listUserTabs': {
      const agentIds = await getAgentTabIds();
      const tabs = await chrome.tabs.query({});
      return {
        ok: true,
        userTabs: tabs
          .filter((tab) => !agentIds.has(tab.id) && tab.url && tab.url !== 'chrome://newtab/')
          .map((tab) => ({ id: String(tab.id), url: tab.url, title: tab.title })),
      };
    }
    case 'newTab': {
      const tab = await chrome.tabs.create({ url: command.url || 'about:blank' });
      await markAgentTab(tab.id);
      return { ok: true, tab: { tabId: String(tab.id), url: tab.url || '', title: tab.title || '', viewport: { width: 1280, height: 720 }, active: true } };
    }
    case 'activateTab': {
      const tabId = Number(command.tabId);
      const tab = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, tab: { tabId: String(tab.id), url: tab.url || '', title: tab.title || '', viewport: { width: 1280, height: 720 }, active: true } };
    }
    case 'claimTab': {
      await markAgentTab(Number(command.tabId));
      const tab = await chrome.tabs.get(Number(command.tabId));
      return { ok: true, tab: { tabId: String(tab.id), url: tab.url || '', title: tab.title || '', viewport: { width: 1280, height: 720 } } };
    }
    case 'close': {
      if (command.tabId) {
        await cdpDetach(Number(command.tabId));
        await chrome.tabs.remove(Number(command.tabId));
        await unmarkAgentTab(Number(command.tabId));
      }
      return { ok: true };
    }
    case 'clearAgentTabs': {
      await chrome.storage.session.set({ [AGENT_TABS_KEY]: [] });
      return { ok: true };
    }
    case 'navigate': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpEnablePage(tabId);
      await cdpSend(tabId, 'Page.navigate', { url: command.url });
      return { ok: true, state: await tabState(tabId) };
    }
    case 'getState': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      return { ok: true, state: await tabState(tabId) };
    }
    case 'back': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpEnablePage(tabId);
      const history = await cdpSend(tabId, 'Page.getNavigationHistory');
      const entries = history.entries || [];
      const index = history.currentIndex || 0;
      if (index > 0) {
        await cdpSend(tabId, 'Page.navigateToHistoryEntry', { entryId: entries[index - 1].id });
      }
      return { ok: true, state: await tabState(tabId) };
    }
    case 'forward': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpEnablePage(tabId);
      const history = await cdpSend(tabId, 'Page.getNavigationHistory');
      const entries = history.entries || [];
      const index = history.currentIndex || 0;
      if (index + 1 < entries.length) {
        await cdpSend(tabId, 'Page.navigateToHistoryEntry', { entryId: entries[index + 1].id });
      }
      return { ok: true, state: await tabState(tabId) };
    }
    case 'reload': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpEnablePage(tabId);
      await cdpSend(tabId, 'Page.reload', { ignoreCache: false });
      return { ok: true, state: await tabState(tabId) };
    }
    case 'snapshot': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const snap = await executeScript(tabId, snapshotInPage);
      return { ok: true, snapshot: { ...snap, truncated: false } };
    }
    case 'screenshot': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpAttach(tabId);
      const params = { format: 'png', fromSurface: true };
      if (command.fullPage) params.captureBeyondViewport = true;
      if (command.clip) params.clip = { x: command.clip.x, y: command.clip.y, width: command.clip.width, height: command.clip.height, scale: 1 };
      const shot = await cdpSend(tabId, 'Page.captureScreenshot', params);
      return { ok: true, image: { base64: shot.data, mimeType: 'image/png' } };
    }
    case 'click': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const point = await resolvePoint(tabId, command);
      await cdpAttach(tabId);
      await cdpMouseClick(tabId, point, { button: command.button, doubleClick: command.doubleClick, modifiers: command.modifiers });
      return { ok: true, state: await tabState(tabId) };
    }
    case 'type': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpAttach(tabId);
      if (command.ref || command.selector) {
        const point = await resolvePoint(tabId, command);
        await cdpMouseClick(tabId, point);
        await executeScript(tabId, prepareInputInPage, [command.ref, command.selector]);
      }
      await cdpSend(tabId, 'Input.insertText', { text: command.text });
      if (command.submit) await cdpPressKey(tabId, 'Enter');
      return { ok: true, state: await tabState(tabId) };
    }
    case 'select': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const result = await executeScript(tabId, selectInPage, [command.ref, command.values]);
      return { ok: true, ...result };
    }
    case 'press': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpAttach(tabId);
      if (command.ref) {
        const point = await resolvePoint(tabId, { ref: command.ref });
        await cdpMouseClick(tabId, point);
      }
      await cdpPressKey(tabId, command.key, command.modifiers);
      return { ok: true };
    }
    case 'scroll': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await cdpAttach(tabId);
      const direction = command.direction;
      const amount = command.amount || 800;
      let deltaX = 0;
      let deltaY = 0;
      if (direction === 'top') deltaY = -100000;
      else if (direction === 'bottom') deltaY = 100000;
      else if (direction === 'left') deltaX = -amount;
      else if (direction === 'right') deltaX = amount;
      else if (direction === 'up') deltaY = -amount;
      else if (direction === 'down') deltaY = amount;
      if (command.x !== undefined && command.y !== undefined) {
        deltaX = command.x;
        deltaY = command.y;
      } else if (command.scrollX !== undefined && command.scrollY !== undefined) {
        deltaX = command.scrollX;
        deltaY = command.scrollY;
      }
      const point = await activeViewportCenter(tabId);
      await cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaX,
        deltaY,
      });
      return { ok: true };
    }
    case 'browserViewportSet': {
      const tab = command.tabId ? await chrome.tabs.get(Number(command.tabId)) : await chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]);
      await chrome.windows.update(tab.windowId, { width: command.width, height: command.height });
      return { ok: true };
    }
    case 'dialog': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const pending = pendingDialogs.get(tabId);
      if (!pending) {
        return { ok: false, error: { code: 'no_dialog', message: 'No JavaScript dialog is open on this tab' } };
      }
      await cdpAttach(tabId);
      const params = { accept: command.accept === true };
      if (command.promptText !== undefined) params.promptText = command.promptText;
      await cdpSend(tabId, 'Page.handleJavaScriptDialog', params);
      pendingDialogs.delete(tabId);
      return { ok: true };
    }
    case 'playwright': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const action = command.action;
      if (action.name === 'domSnapshot') {
        const snap = await executeScript(tabId, snapshotInPage);
        return { ok: true, value: snap.aria || snap.text };
      }
      if (action.name === 'locator') {
        const result = await executeScript(tabId, locatorInPage, [action.selector, action.operation, action]);
        return result.ok ? { ok: true, value: result.value } : result;
      }
      return { ok: false, error: { code: 'capability_unsupported', message: `playwright.${action.name} not supported by extension yet` } };
    }
    case 'playwrightWaitForTimeout': {
      await new Promise((resolve) => setTimeout(resolve, Math.min(command.timeoutMs || 0, 30000)));
      return { ok: true };
    }
    default:
      return { ok: false, error: { code: 'capability_unsupported', message: `command ${method} not supported by extension` } };
  }
}

async function resolvePoint(tabId, command) {
  if (command.ref) {
    const result = await executeScript(tabId, pointForRef, [command.ref]);
    if (!result?.ok) throw new Error(result?.error || `ref ${command.ref} not found`);
    return { x: result.x, y: result.y };
  }
  if (command.selector) {
    const result = await executeScript(tabId, pointForSelector, [command.selector]);
    if (!result?.ok) throw new Error(result?.error || `selector ${command.selector} not found`);
    return { x: result.x, y: result.y };
  }
  if (command.x !== undefined && command.y !== undefined) {
    return { x: command.x, y: command.y };
  }
  throw new Error('click requires ref / selector / x+y');
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no active tab');
  return tab.id;
}

async function activeViewportCenter(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  return {
    x: Math.round((win.width || 1280) / 2),
    y: Math.round((win.height || 720) / 2),
  };
}

async function tabState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url || '', title: tab.title || '', viewport: { width: 1280, height: 720 } };
}

// Listen for tab removal to clean agent marks.
chrome.tabs.onRemoved.addListener((tabId) => {
  void unmarkAgentTab(tabId);
  DEBUGGER_ATTACHED.delete(tabId);
  pendingDialogs.delete(tabId);
});

// CDP events: keep JS dialogs from blocking until a host `dialog` command exists.
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return;
  if (method === 'Page.javascriptDialogOpening') {
    pendingDialogs.set(source.tabId, { ...params, time: Date.now() });
    if (autoDismissDialogs) {
      chrome.debugger.sendCommand({ tabId: source.tabId }, 'Page.handleJavaScriptDialog', { accept: false }, () => {
        pendingDialogs.delete(source.tabId);
      });
    }
  } else if (method === 'Page.javascriptDialogClosed') {
    pendingDialogs.delete(source.tabId);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    DEBUGGER_ATTACHED.delete(source.tabId);
    pendingDialogs.delete(source.tabId);
  }
});

connect();
