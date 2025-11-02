import { WebSocket } from 'ws'
import { makeBaseUrl } from './esp32-client.js'

export const sendCommand = async (host, command, params = {}, { timeoutMs = 5000, port = 81 } = {}) => {
  return new Promise((resolve, reject) => {
    const base = makeBaseUrl(host)
    const wsUrl = base.replace(/^http/, 'ws') + `:${port}`
    
    const ws = new WebSocket(wsUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`WebSocket timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    let commandSent = false

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    ws.on('open', () => {
      // Wait a tiny bit before sending command to ensure we're ready
      setTimeout(() => {
        const message = JSON.stringify({ command, ...params })
        ws.send(message)
        commandSent = true
      }, 50)
    })

    ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString())
        
        // Skip the welcome message, wait for actual command response
        if (response.type === 'connected') {
          return
        }
        
        clearTimeout(timeout)
        ws.close()
        resolve(response)
      } catch (err) {
        clearTimeout(timeout)
        ws.close()
        reject(new Error('Invalid JSON response'))
      }
    })

    ws.on('close', () => {
      clearTimeout(timeout)
    })
  })
}

export const blinkLed = async (host, { onMs = 50, offMs = 50, times = 10, timeoutMs = 5000 } = {}) => {
  return sendCommand(host, 'blink', { onMs, offMs, times }, { timeoutMs })
}

export const getStatus = async (host, { timeoutMs = 5000 } = {}) => {
  return sendCommand(host, 'status', {}, { timeoutMs })
}
