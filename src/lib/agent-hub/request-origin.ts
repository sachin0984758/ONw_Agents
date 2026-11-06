import { isIP } from 'node:net'

type OriginRequest = {
  headers: Headers
  url: string
}

function normalizedLoopbackHost(host: string, protocol: string): string | null {
  if (!host || host.length > 255 || !['http:', 'https:'].includes(protocol)) return null
  try {
    const parsed = new URL(`${protocol}//${host}`)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const loopback = hostname === 'localhost'
      || (isIP(hostname) === 4 && hostname.startsWith('127.'))
      || (isIP(hostname) === 6 && hostname === '::1')
    if (!loopback) return null
    const port = parsed.port || (protocol === 'https:' ? '443' : '80')
    return `${hostname}:${port}`
  } catch {
    return null
  }
}

/**
 * Require a loopback host and reject browser cross-site requests. Origin-less
 * CLI calls remain supported, but DNS-rebinding hostnames do not: checking an
 * Origin against an attacker-controlled Host header alone is insufficient.
 * This is a local request boundary, not user authentication.
 */
export function isCrossOrigin(request: OriginRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true

  let protocol: string
  let urlHost: string | null
  let urlPort: string
  try {
    const url = new URL(request.url)
    protocol = url.protocol
    urlHost = normalizedLoopbackHost(url.host, protocol)
    urlPort = url.port || (protocol === 'https:' ? '443' : '80')
  } catch {
    return true
  }

  const rawHost = request.headers.get('host') ?? ''
  const requestHost = normalizedLoopbackHost(rawHost, protocol)
  let requestPort: string
  try {
    const parsedHost = new URL(`${protocol}//${rawHost}`)
    requestPort = parsedHost.port || (protocol === 'https:' ? '443' : '80')
  } catch {
    return true
  }
  // Next may canonicalize request.url to localhost while the actual Host is
  // 127.0.0.1 (or vice versa); require both to be loopback and the port equal.
  if (!urlHost || !requestHost || requestPort !== urlPort) return true

  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return true
    const originHost = normalizedLoopbackHost(parsed.host, parsed.protocol)
    return parsed.protocol !== protocol || !originHost || originHost !== requestHost
  } catch {
    return true
  }
}
