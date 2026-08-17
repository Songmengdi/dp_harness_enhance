import type { BrowserUseConfig } from './config.js'

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
])

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fd[0-9a-f]{2}:)/i

/** Normalize a host pattern: lower-case, strip trailing dot, keep '*' wildcard. */
function normalizePattern(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

function matchesPattern(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  const p = normalizePattern(pattern)
  if (p === '*') return true
  if (p.startsWith('*.')) {
    const suffix = p.slice(1)
    return h.endsWith(suffix) || h === p.slice(2)
  }
  return h === p || h.endsWith('.' + p)
}

export function isAllowedUrl(raw: string, config: BrowserUseConfig): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = raw.trim()
  if (trimmed === 'about:blank') return { ok: true, url: trimmed }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: `不是合法 URL: ${trimmed}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `只允许 http/https（拒绝 ${parsed.protocol}//）` }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')

  // 云元数据 / 回环黑洞永远拒绝。
  if (BLOCKED_METADATA_HOSTS.has(hostname)) {
    return { ok: false, reason: `拒绝访问云元数据地址: ${hostname}` }
  }

  // 用户显式黑名单优先。
  if (config.blockedHosts?.some((p) => matchesPattern(hostname, p))) {
    return { ok: false, reason: `域名在黑名单中: ${hostname}` }
  }

  // 用户显式白名单：若配置了，则只放行白名单。
  if (config.allowedHosts && config.allowedHosts.length > 0) {
    if (!config.allowedHosts.some((p) => matchesPattern(hostname, p))) {
      return { ok: false, reason: `域名不在白名单中: ${hostname}` }
    }
    return { ok: true, url: parsed.href }
  }

  // 私有地址策略。
  if (!config.allowPrivate && PRIVATE_HOST_RE.test(hostname)) {
    return { ok: false, reason: `默认禁止访问内网/回环地址（allowPrivate=false）: ${hostname}` }
  }

  return { ok: true, url: parsed.href }
}
