import http from 'node:http'
import { URL } from 'node:url'
import { WebSocketServer } from 'ws'
import { DeviceRegistry } from './device-registry.js'

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload, null, 2))
}

const readJsonBody = async req => {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) {
    return {}
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    return {}
  }
  return JSON.parse(raw)
}

const routeNotFound = res => {
  json(res, 404, { status: 'error', code: 'NOT_FOUND', message: 'Route not found' })
}

const routeError = (res, error) => {
  const statusCode = /Unknown device/.test(error.message) ? 404 : 400
  json(res, statusCode, {
    status: 'error',
    code: statusCode === 404 ? 'UNKNOWN_DEVICE' : 'REQUEST_FAILED',
    message: error.message,
  })
}

const getNumeric = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export class EspControlServer {
  constructor({
    host = '127.0.0.1',
    port = 4010,
    configPath,
    registry = new DeviceRegistry(configPath ? { configPath } : {}),
    defaultTimeoutMs = 5000,
  } = {}) {
    this.host = host
    this.port = port
    this.registry = registry
    this.defaultTimeoutMs = defaultTimeoutMs
    this.clients = new Set()
    this.updateListener = event => this.broadcast({ type: 'registry.update', ...event })

    this.httpServer = http.createServer((req, res) => {
      this.handleHttp(req, res).catch(error => routeError(res, error))
    })

    this.wsServer = new WebSocketServer({ noServer: true })
    this.wsServer.on('connection', ws => {
      this.clients.add(ws)
      ws.send(JSON.stringify({ type: 'snapshot', data: { devices: this.registry.listDevices() } }))
      ws.on('message', raw => {
        this.handleSocketMessage(ws, raw).catch(error => {
          ws.send(JSON.stringify({
            type: 'response',
            status: 'error',
            code: 'REQUEST_FAILED',
            message: error.message,
          }))
        })
      })
      ws.on('close', () => {
        this.clients.delete(ws)
      })
    })

    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
      if (url.pathname !== '/ws') {
        socket.destroy()
        return
      }

      this.wsServer.handleUpgrade(request, socket, head, ws => {
        this.wsServer.emit('connection', ws, request)
      })
    })
  }

  async start() {
    await this.registry.load()
    this.registry.on('update', this.updateListener)
    this.registry.startDiscoveryLoop()

    for (const device of this.registry.listDevices()) {
      if (!device.autoConnect) {
        continue
      }
      try {
        await this.registry.connectDevice(device.id)
      } catch (error) {
        this.broadcast({
          type: 'registry.update',
          ts: new Date().toISOString(),
          deviceId: device.id,
          data: { error: error.message },
        })
      }
    }

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(this.port, this.host, () => {
        this.httpServer.off('error', reject)
        const address = this.httpServer.address()
        if (typeof address === 'object' && address) {
          this.port = address.port
        }
        resolve()
      })
    })

    return {
      host: this.host,
      port: this.port,
    }
  }

  async close() {
    this.registry.off('update', this.updateListener)
    this.registry.stopDiscoveryLoop()

    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    for (const device of this.registry.listDevices()) {
      await this.registry.disconnectDevice(device.id)
    }

    await new Promise(resolve => this.wsServer.close(resolve))
    await new Promise(resolve => this.httpServer.close(resolve))
  }

  broadcast(payload) {
    const message = JSON.stringify(payload)
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message)
      }
    }
  }

  async handleHttp(req, res) {
    const method = req.method || 'GET'
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const segments = url.pathname.split('/').filter(Boolean)
    const timeoutMs = getNumeric(url.searchParams.get('timeoutMs'), this.defaultTimeoutMs)
    const transport = url.searchParams.get('transport') || 'ws'

    if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
      json(res, 200, await this.registry.getServiceHealth())
      return
    }

    if (segments.length === 1 && segments[0] === 'devices') {
      if (method === 'GET') {
        json(res, 200, { status: 'ok', data: { devices: this.registry.listDevices() } })
        return
      }
      if (method === 'POST') {
        const body = await readJsonBody(req)
        const device = await this.registry.registerDevice(body)
        json(res, 201, { status: 'ok', data: { device } })
        return
      }
    }

    if (segments.length >= 2 && segments[0] === 'devices') {
      const deviceId = decodeURIComponent(segments[1])

      if (segments.length === 2) {
        if (method === 'GET') {
          json(res, 200, { status: 'ok', data: { device: this.registry.getDevice(deviceId) } })
          return
        }
        if (method === 'DELETE') {
          await this.registry.removeDevice(deviceId)
          json(res, 200, { status: 'ok', data: { deviceId } })
          return
        }
      }

      if (segments.length === 3 && method === 'POST' && segments[2] === 'connect') {
        json(res, 200, { status: 'ok', data: { device: await this.registry.connectDevice(deviceId) } })
        return
      }

      if (segments.length === 3 && method === 'POST' && segments[2] === 'disconnect') {
        json(res, 200, { status: 'ok', data: { device: await this.registry.disconnectDevice(deviceId) } })
        return
      }

      if (segments.length === 3 && method === 'GET' && segments[2] === 'health') {
        json(res, 200, { status: 'ok', data: { device: await this.registry.refreshHealth(deviceId, { timeoutMs }) } })
        return
      }

      if (segments.length === 3 && method === 'GET' && segments[2] === 'system') {
        json(res, 200, { status: 'ok', data: await this.registry.refreshSystemInfo(deviceId, { timeoutMs }) })
        return
      }

      if (segments.length === 3 && method === 'GET' && segments[2] === 'capabilities') {
        json(res, 200, { status: 'ok', data: await this.registry.getCapabilities(deviceId, { timeoutMs }) })
        return
      }

      if (segments.length === 4 && segments[2] === 'motion' && segments[3] === 'status' && method === 'GET') {
        json(res, 200, { status: 'ok', data: await this.registry.getMotionStatus(deviceId, { timeoutMs, transport }) })
        return
      }

      if (segments.length === 4 && segments[2] === 'motion' && segments[3] === 'jog' && method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, {
          status: 'ok',
          data: await this.registry.jog(deviceId, {
            delta: getNumeric(body.delta, 160),
            speed: getNumeric(body.speed, 800),
            timeoutMs: getNumeric(body.timeoutMs, timeoutMs),
            transport: body.transport || transport,
          }),
        })
        return
      }

      if (segments.length === 4 && segments[2] === 'motion' && segments[3] === 'stop' && method === 'POST') {
        const body = await readJsonBody(req)
        json(res, 200, {
          status: 'ok',
          data: await this.registry.stop(deviceId, {
            immediate: body.immediate !== false,
            timeoutMs: getNumeric(body.timeoutMs, timeoutMs),
            transport: body.transport || transport,
          }),
        })
        return
      }

      if (segments.length === 4 && segments[2] === 'motion' && segments[3] === 'config') {
        if (method === 'GET') {
          json(res, 200, { status: 'ok', data: await this.registry.getMotionConfig(deviceId, { timeoutMs, transport }) })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          json(res, 200, {
            status: 'ok',
            data: await this.registry.setMotionConfig(deviceId, {
              maxSpeed: body.maxSpeed,
              acceleration: body.acceleration,
              timeoutMs: getNumeric(body.timeoutMs, timeoutMs),
              transport: body.transport || transport,
            }),
          })
          return
        }
      }
    }

    routeNotFound(res)
  }

  async handleSocketMessage(ws, raw) {
    const message = JSON.parse(raw.toString())
    const requestId = message.requestId ?? null

    if (message.action === 'subscribe') {
      ws.send(JSON.stringify({
        type: 'response',
        requestId,
        status: 'ok',
        data: { devices: this.registry.listDevices() },
      }))
      return
    }

    if (message.action === 'listDevices') {
      ws.send(JSON.stringify({
        type: 'response',
        requestId,
        status: 'ok',
        data: { devices: this.registry.listDevices() },
      }))
      return
    }

    if (message.action === 'command') {
      const data = await this.dispatchSocketCommand(message)
      ws.send(JSON.stringify({
        type: 'response',
        requestId,
        status: 'ok',
        data,
      }))
      return
    }

    throw new Error(`Unsupported action: ${message.action}`)
  }

  async dispatchSocketCommand(message) {
    const deviceId = message.deviceId
    const params = message.params || {}
    const timeoutMs = getNumeric(params.timeoutMs, this.defaultTimeoutMs)
    const transport = params.transport || 'ws'

    switch (message.command) {
      case 'registerDevice':
        return { device: await this.registry.registerDevice(params) }
      case 'removeDevice':
        await this.registry.removeDevice(deviceId)
        return { deviceId }
      case 'connect':
        return { device: await this.registry.connectDevice(deviceId) }
      case 'disconnect':
        return { device: await this.registry.disconnectDevice(deviceId) }
      case 'health':
        return { device: await this.registry.refreshHealth(deviceId, { timeoutMs }) }
      case 'system':
        return await this.registry.refreshSystemInfo(deviceId, { timeoutMs })
      case 'capabilities':
        return await this.registry.getCapabilities(deviceId, { timeoutMs })
      case 'motion.status':
        return await this.registry.getMotionStatus(deviceId, { timeoutMs, transport })
      case 'motion.jog':
        return await this.registry.jog(deviceId, {
          delta: getNumeric(params.delta, 160),
          speed: getNumeric(params.speed, 800),
          timeoutMs,
          transport,
        })
      case 'motion.stop':
        return await this.registry.stop(deviceId, {
          immediate: params.immediate !== false,
          timeoutMs,
          transport,
        })
      case 'motion.config.get':
        return await this.registry.getMotionConfig(deviceId, { timeoutMs, transport })
      case 'motion.config.set':
        return await this.registry.setMotionConfig(deviceId, {
          maxSpeed: params.maxSpeed,
          acceleration: params.acceleration,
          timeoutMs,
          transport,
        })
      default:
        throw new Error(`Unsupported command: ${message.command}`)
    }
  }
}

export const createEspControlServer = options => new EspControlServer(options)