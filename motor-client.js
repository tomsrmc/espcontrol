import { ESP32WebSocketClient } from './esp32-persistent-client.js'

export class ESP32MotorClient {
  constructor(host, port = 81, transport) {
    this.transport = transport ?? new ESP32WebSocketClient(host, port)
  }

  async connect() {
    await this.transport.connect()
    return this.transport.welcomeMessage
  }

  async jog({ delta = 160, speed = 800, timeoutMs = 5000 } = {}) {
    return this.transport.sendCommand('stepper_jog', { delta, speed }, timeoutMs)
  }

  async getStatus({ timeoutMs = 5000 } = {}) {
    return this.transport.sendCommand('stepper_status', {}, timeoutMs)
  }

  async stop({ immediate = true, timeoutMs = 5000 } = {}) {
    return this.transport.sendCommand('stepper_stop', { immediate }, timeoutMs)
  }

  async getMotionConfig({ timeoutMs = 5000 } = {}) {
    return this.transport.sendCommand('stepper_config', {}, timeoutMs)
  }

  async setMotionConfig({ maxSpeed, acceleration, timeoutMs = 5000 } = {}) {
    const params = {}
    if (maxSpeed !== undefined) params.maxSpeed = maxSpeed
    if (acceleration !== undefined) params.acceleration = acceleration
    return this.transport.sendCommand('stepper_config', params, timeoutMs)
  }

  async getCapabilities({ timeoutMs = 5000 } = {}) {
    if (this.transport.welcomeMessage?.capabilities) {
      return {
        version: this.transport.welcomeMessage.version,
        status: 'ok',
        code: 'CONNECTED_CAPABILITIES',
        message: 'Capabilities from connect handshake',
        data: this.transport.welcomeMessage.capabilities,
      }
    }
    return this.transport.sendCommand('capabilities', {}, timeoutMs)
  }

  on(eventName, handler) {
    return this.transport.on(eventName, handler)
  }

  onMotionEvent(handler) {
    return this.transport.on('message', message => {
      if (message?.type === 'event' && String(message?.event || '').startsWith('stepper.')) {
        handler(message)
      }
    })
  }

  disconnect() {
    this.transport.disconnect()
  }
}