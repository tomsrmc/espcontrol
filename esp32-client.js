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

const fetchJson = async (url, options = {}) => {
  const res = await fetchText(url, options)
  if (!res.body) {
    return { status: res.status, json: null }
  }
  try {
    return { status: res.status, json: JSON.parse(res.body) }
  } catch (err) {
    throw new Error('Invalid JSON response')
  }
}

export const health = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/health`
  return fetchText(url, { method: 'GET', timeoutMs })
}

export const getSystemInfo = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/system/info`
  return fetchJson(url, { method: 'GET', timeoutMs })
}

const postJson = (url, payload, { timeoutMs } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
  return fetchJson(url, { method: 'POST', headers, body, timeoutMs })
}

export const blinkLedRest = async (host, params = {}, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/led/blink`
  return postJson(url, params, { timeoutMs })
}

export const stepperJog = async (host, params = {}, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/stepper/jog`
  return postJson(url, params, { timeoutMs })
}

export const getStepperStatus = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/stepper/status`
  return fetchJson(url, { method: 'GET', timeoutMs })
}

export const stopStepper = async (host, params = {}, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/stepper/stop`
  return postJson(url, params, { timeoutMs })
}

export const getStepperConfig = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/stepper/config`
  return fetchJson(url, { method: 'GET', timeoutMs })
}

export const setStepperConfig = async (host, params = {}, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/stepper/config`
  return postJson(url, params, { timeoutMs })
}

export const getCapabilities = async (host, { timeoutMs } = {}) => {
  const base = makeBaseUrl(host)
  const url = `${base}/system/capabilities`
  return fetchJson(url, { method: 'GET', timeoutMs })
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
