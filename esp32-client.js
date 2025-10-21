// Named exports only (no default)

export const makeBaseUrl = host =>
  host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}`

const fetchText = async (url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) => {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal })
    const text = await res.text()
    return { status: res.status, body: text }
  } finally {
    clearTimeout(t)
  }
}

export const health = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/health`
  return fetchText(url, { method: 'GET', timeoutMs })
}

export const runAction = async (host, token, payload, { timeoutMs, includeTokenQuery = false } = {}) => {
  const base = makeBaseUrl(host)
  const url = new URL(`${base}/run`)
  if (includeTokenQuery && token) url.searchParams.set('token', token)

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})

  return fetchText(url, { method: 'POST', headers, body, timeoutMs })
}
