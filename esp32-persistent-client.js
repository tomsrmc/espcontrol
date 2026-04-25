import { WebSocket } from 'ws'
import { makeBaseUrl } from './esp32-client.js'

export class ESP32WebSocketClient {
  constructor(host, port = 81) {
    this.host = host
    this.port = port
    this.ws = null
    this.isConnected = false
    this.welcomeMessage = null
    this.nextRequestId = 1
    this.pendingRequests = new Map() // id -> { resolve, reject, sendTime }
    this.listeners = new Map()
    this.reconnectDelay = 1000
    this.shouldReconnect = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      const base = makeBaseUrl(this.host)
      const wsUrl = base.replace(/^http/, 'ws') + `:${this.port}`
      
      this.ws = new WebSocket(wsUrl)
      this.shouldReconnect = true

      const timeout = setTimeout(() => {
        this.ws.close()
        reject(new Error('Connection timeout'))
      }, 5000)

      this.ws.on('error', (err) => {
        clearTimeout(timeout)
        if (!this.isConnected) {
          reject(err)
        } else {
          console.error('WebSocket error:', err)
          this.handleDisconnect()
        }
      })

      this.ws.on('open', () => {
        console.log(`Connected to ${this.host}`)
      })

      this.ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString())
          
          // Handle welcome message
          if (response.type === 'connected') {
            this.isConnected = true
            this.welcomeMessage = response
            clearTimeout(timeout)
            this.emit('connected', response)
            resolve()
            return
          }
          
          // Handle command responses
          const requestId = response.id
          if (requestId && this.pendingRequests.has(requestId)) {
            const { resolve: resolveRequest, sendTime } = this.pendingRequests.get(requestId)
            
            // Add round-trip time
            response.roundTripMs = Date.now() - sendTime
            
            this.pendingRequests.delete(requestId)
            resolveRequest(response)
          } else {
            // Unsolicited message from server
            this.handleServerMessage(response)
          }
        } catch (err) {
          console.error('Failed to parse message:', err)
        }
      })

      this.ws.on('close', () => {
        console.log('WebSocket closed')
        this.handleDisconnect()
      })
    })
  }

  handleDisconnect() {
    this.isConnected = false
    this.welcomeMessage = null
    this.emit('disconnected', { host: this.host, port: this.port })
    
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Connection closed'))
    }
    this.pendingRequests.clear()

    // Auto-reconnect if desired
    if (this.shouldReconnect) {
      console.log(`Reconnecting in ${this.reconnectDelay}ms...`)
      this.emit('reconnecting', { host: this.host, port: this.port, delayMs: this.reconnectDelay })
      setTimeout(() => {
        if (this.shouldReconnect) {
          this.connect().catch(err => {
            console.error('Reconnection failed:', err)
          })
        }
      }, this.reconnectDelay)
    }
  }

  handleServerMessage(message) {
    if (message?.type === 'event' && message?.event) {
      this.emit(message.event, message)
    }
    this.emit('message', message)
    console.log('Server message:', message)
  }

  on(eventName, handler) {
    const handlers = this.listeners.get(eventName) ?? new Set()
    handlers.add(handler)
    this.listeners.set(eventName, handlers)
    return () => this.off(eventName, handler)
  }

  off(eventName, handler) {
    const handlers = this.listeners.get(eventName)
    if (!handlers) {
      return
    }
    handlers.delete(handler)
    if (handlers.size === 0) {
      this.listeners.delete(eventName)
    }
  }

  emit(eventName, payload) {
    const handlers = this.listeners.get(eventName)
    if (!handlers) {
      return
    }
    for (const handler of handlers) {
      handler(payload)
    }
  }

  sendCommand(command, params = {}, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Not connected'))
        return
      }

      const requestId = this.nextRequestId++
      const sendTime = Date.now()
      
      const message = JSON.stringify({
        id: requestId,
        command,
        ...params
      })

      // Set up timeout
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Command timeout after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout)
          resolve(response)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        sendTime
      })

      // Send the command immediately
      this.ws.send(message)
    })
  }

  async blink({ onMs = 50, offMs = 50, times = 10, timeoutMs = 5000 } = {}) {
    return this.sendCommand('blink', { onMs, offMs, times }, timeoutMs)
  }

  async getStatus({ timeoutMs = 5000 } = {}) {
    return this.sendCommand('status', {}, timeoutMs)
  }

  async getCapabilities({ timeoutMs = 5000 } = {}) {
    return this.sendCommand('capabilities', {}, timeoutMs)
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
    }
  }
}

// Convenience function for single operations (backwards compatible)
export const connectAndExecute = async (host, callback, port = 81) => {
  const client = new ESP32WebSocketClient(host, port)
  try {
    await client.connect()
    const result = await callback(client)
    client.disconnect()
    return result
  } catch (err) {
    client.disconnect()
    throw err
  }
}
