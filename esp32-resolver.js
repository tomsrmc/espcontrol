import dns from 'node:dns/promises'
import http from 'node:http'

const resolveCache = new Map()

export async function resolveHostOnce(h) {
  const isLocal = h.endsWith('.local') || h.endsWith('.local.')
  if (!isLocal) return { address: h, hostHeader: null }

  const cached = resolveCache.get(h)
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached

  const { address } = await dns.lookup(h, { family: 4, verbatim: true })
  const out = { address, hostHeader: h, ts: Date.now() }
  resolveCache.set(h, out)
  return out
}

export const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 4 })
