// dsh Browser Use — real Chrome bridge.
// Connects to dsh host at ws://127.0.0.1:3080/browser-use/extension and executes
// browser commands against the user's real Chrome.

const HOST = '127.0.0.1';
const PORT = 3080;
const WS_URL = `ws://${HOST}:${PORT}/browser-use/extension`;

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const pending = new Map();

const AGENT_TABS_KEY = 'agentTabIds';

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

// ---- snapshot / ref helpers (same contract as dsh-browser-use host) ----

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', 'summary', '[onclick]',
].join(',');

function snapshotInPage() {
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
  return {
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').trim(),
    refs,
  };
}

function elementByRef(ref) {
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

function clickInPage(ref) {
  const el = elementByRef(ref);
  if (!el) return { ok: false, error: `ref ${ref} not found` };
  el.click();
  return { ok: true };
}

function typeInPage(ref, text, submit) {
  const el = elementByRef(ref);
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
  const el = elementByRef(ref);
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
  const el = elementByRef(ref);
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
        await chrome.tabs.remove(Number(command.tabId));
        await unmarkAgentTab(Number(command.tabId));
      }
      return { ok: true };
    }
    case 'navigate': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await chrome.tabs.update(tabId, { url: command.url });
      return { ok: true, state: await tabState(tabId) };
    }
    case 'getState': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      return { ok: true, state: await tabState(tabId) };
    }
    case 'back': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await executeScript(tabId, () => history.back());
      return { ok: true, state: await tabState(tabId) };
    }
    case 'forward': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await executeScript(tabId, () => history.forward());
      return { ok: true, state: await tabState(tabId) };
    }
    case 'reload': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await chrome.tabs.reload(tabId);
      return { ok: true, state: await tabState(tabId) };
    }
    case 'snapshot': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const snap = await executeScript(tabId, snapshotInPage);
      return { ok: true, snapshot: { ...snap, aria: '', truncated: false } };
    }
    case 'screenshot': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const base64 = dataUrl.split(',')[1] || '';
      return { ok: true, image: { base64, mimeType: 'image/png' } };
    }
    case 'click': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      if (command.ref) {
        const result = await executeScript(tabId, clickInPage, [command.ref]);
        return { ok: true, ...result };
      }
      return { ok: false, error: { code: 'execution_error', message: 'click requires ref for real Chrome extension' } };
    }
    case 'type': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const result = await executeScript(tabId, typeInPage, [command.ref, command.text, command.submit === true]);
      return { ok: true, ...result };
    }
    case 'select': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const result = await executeScript(tabId, selectInPage, [command.ref, command.values]);
      return { ok: true, ...result };
    }
    case 'press': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await executeScript(tabId, pressInPage, [command.ref, command.key]);
      return { ok: true };
    }
    case 'scroll': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      await executeScript(tabId, scrollInPage, [command.direction, command.amount, command.x, command.y]);
      return { ok: true };
    }
    case 'browserViewportSet': {
      const tab = command.tabId ? await chrome.tabs.get(Number(command.tabId)) : await chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]);
      await chrome.windows.update(tab.windowId, { width: command.width, height: command.height });
      return { ok: true };
    }
    case 'playwright': {
      const tabId = command.tabId ? Number(command.tabId) : (await activeTabId());
      const action = command.action;
      if (action.name === 'domSnapshot') {
        const snap = await executeScript(tabId, snapshotInPage);
        return { ok: true, value: snap.text };
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

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no active tab');
  return tab.id;
}

async function tabState(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url || '', title: tab.title || '', viewport: { width: 1280, height: 720 } };
}

// Listen for tab removal to clean agent marks.
chrome.tabs.onRemoved.addListener((tabId) => {
  void unmarkAgentTab(tabId);
});

connect();
