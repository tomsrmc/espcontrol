import { EventEmitter } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getCapabilities as getCapabilitiesRest,
  getStepperConfig,
  getStepperStatus,
  getSystemInfo,
  health,
  setStepperConfig,
  stopStepper as stopStepperRest,
  stepperJog as stepperJogRest,
} from './esp32-client.js'
import { ESP32MotorClient } from './motor-client.js'
import { ESP32WebSocketClient } from './esp32-persistent-client.js'
import { resolveHostOnce } from './esp32-resolver.js'
import { getKnownBridgeDefaults } from './bridge-defaults.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_CONFIG_PATH = path.join(__dirname, '.espcontrol-devices.json')
const DEFAULT_DISCOVERY_INTERVAL_MS = 30_000

const inferMotionState = eventName => {
  switch (eventName) {
    case 'stepper.started':
      return 'moving'
    case 'stepper.completed':
    case 'stepper.stopped':
      return 'idle'
    case 'stepper.fault':
      return 'fault'
    default:
      return null
  }
}

const clone = value => JSON.parse(JSON.stringify(value))

export class DeviceRegistry extends EventEmitter {
  constructor({ configPath = DEFAULT_CONFIG_PATH, discoveryIntervalMs = DEFAULT_DISCOVERY_INTERVAL_MS } = {}) {
    super()
    this.configPath = configPath
    this.discoveryIntervalMs = discoveryIntervalMs
    this.devices = new Map()
    this.discoveryTimer = null
    this.isLoaded = false
  }

  async load() {
    if (this.isLoaded) {
      return this.listDevices()
    }

    try {
      const raw = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(raw)
      for (const item of parsed.devices ?? []) {
        this.devices.set(item.id, this.#createRecord(item))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }

    await this.#ensureBootstrappedDevice()

    this.isLoaded = true
    return this.listDevices()
  }

  startDiscoveryLoop() {
    if (this.discoveryTimer) {
      return
    }
    this.discoveryTimer = setInterval(() => {
      this.refreshKnownHosts().catch(error => {
        this.emit('error', error)
      })
    }, this.discoveryIntervalMs)
    this.discoveryTimer.unref?.()
  }

  stopDiscoveryLoop() {
    if (!this.discoveryTimer) {
      return
    }
    clearInterval(this.discoveryTimer)
    this.discoveryTimer = null
  }

  async refreshKnownHosts() {
    const snapshots = []
    for (const record of this.devices.values()) {
      const snapshot = await this.#refreshResolution(record)
      snapshots.push(snapshot)
    }
    return snapshots
  }

  listDevices() {
    return Array.from(this.devices.values(), record => this.#toSnapshot(record))
  }

  getDevice(deviceId) {
    const record = this.#requireRecord(deviceId)
    return this.#toSnapshot(record)
  }

  async registerDevice({ id, host, autoConnect = false } = {}) {
    if (!id || !host) {
      throw new Error('Device registration requires id and host')
    }

    const existing = this.devices.get(id)
    const record = existing ?? this.#createRecord({ id, host, autoConnect })
    record.host = host
    record.autoConnect = Boolean(autoConnect)
    this.devices.set(id, record)

    await this.#refreshResolution(record)
    await this.save()
    this.#emitUpdate('device.registered', record)

    if (record.autoConnect) {
      await this.connectDevice(id)
    }

    return this.#toSnapshot(record)
  }

  async removeDevice(deviceId) {
    const record = this.#requireRecord(deviceId)
    await this.disconnectDevice(deviceId)
    this.devices.delete(deviceId)
    await this.save()
    this.emit('update', {
      type: 'device.removed',
      ts: new Date().toISOString(),
      deviceId,
    })
  }

  async connectDevice(deviceId) {
    const record = this.#requireRecord(deviceId)
    await this.#refreshResolution(record)

    if (record.transport?.isConnected) {
      return this.#toSnapshot(record)
    }

    this.#teardownTransport(record)

    const transport = new ESP32WebSocketClient(record.resolvedHost || record.host)
    const motorClient = new ESP32MotorClient(record.resolvedHost || record.host, 81, transport)

    this.#attachTransport(record, transport)
    record.transport = transport
    record.motorClient = motorClient
    record.connectionState = 'connecting'
    this.#emitUpdate('device.connecting', record)

    try {
      await motorClient.connect()
      record.connectionState = 'connected'
      record.lastConnectedAt = new Date().toISOString()
      record.lastError = null

      try {
        record.capabilities = await motorClient.getCapabilities()
      } catch (error) {
        record.lastError = error.message
      }

      this.#emitUpdate('device.connected', record)
      await this.save()
      return this.#toSnapshot(record)
    } catch (error) {
      record.connectionState = 'error'
      record.lastError = error.message
      this.#emitUpdate('device.error', record, { error: error.message })
      throw error
    }
  }

  async disconnectDevice(deviceId) {
    const record = this.#requireRecord(deviceId)
    if (record.motorClient) {
      record.motorClient.disconnect()
    }
    this.#teardownTransport(record)
    record.transport = null
    record.motorClient = null
    record.connectionState = 'disconnected'
    this.#emitUpdate('device.disconnected', record)
    return this.#toSnapshot(record)
  }

  async getServiceHealth() {
    const devices = await Promise.all(this.listDevices().map(async device => {
      try {
        const healthResult = await this.refreshHealth(device.id)
        return healthResult
      } catch (error) {
        return this.getDevice(device.id)
      }
    }))

    return {
      status: 'ok',
      data: {
        service: 'espcontrol-server',
        deviceCount: devices.length,
        connectedCount: devices.filter(device => device.connectionState === 'connected').length,
        devices,
      },
    }
  }

  async refreshHealth(deviceId, { timeoutMs = 5000 } = {}) {
    const record = this.#requireRecord(deviceId)
    await this.#refreshResolution(record)
    const result = await health(record.resolvedHost || record.host, { timeoutMs })
    record.lastHealth = result
    this.#emitUpdate('device.health', record, { lastHealth: result })
    return this.#toSnapshot(record)
  }

  async refreshSystemInfo(deviceId, { timeoutMs = 5000 } = {}) {
    const record = this.#requireRecord(deviceId)
    await this.#refreshResolution(record)
    const result = await getSystemInfo(record.resolvedHost || record.host, { timeoutMs })
    record.lastSystemInfo = result
    this.#emitUpdate('device.system', record, { lastSystemInfo: result })
    return result
  }

  async getCapabilities(deviceId, { timeoutMs = 5000, preferConnection = true } = {}) {
    const record = this.#requireRecord(deviceId)
    if (preferConnection && record.motorClient) {
      const result = await record.motorClient.getCapabilities({ timeoutMs })
      record.capabilities = result
      this.#emitUpdate('device.capabilities', record, { capabilities: result })
      return result
    }
    await this.#refreshResolution(record)
    const result = await getCapabilitiesRest(record.resolvedHost || record.host, { timeoutMs })
    record.capabilities = result
    this.#emitUpdate('device.capabilities', record, { capabilities: result })
    return result
  }

  async getMotionStatus(deviceId, { timeoutMs = 5000, transport = 'ws' } = {}) {
    const record = this.#requireRecord(deviceId)
    let result
    if (transport === 'http') {
      await this.#refreshResolution(record)
      result = await getStepperStatus(record.resolvedHost || record.host, { timeoutMs })
    } else {
      await this.#ensureConnected(record)
      result = await record.motorClient.getStatus({ timeoutMs })
    }
    record.lastStatus = result
    this.#emitUpdate('device.motionStatus', record, { lastStatus: result })
    return result
  }

  async jog(deviceId, { delta = 160, speed = 800, timeoutMs = 5000, transport = 'ws' } = {}) {
    const record = this.#requireRecord(deviceId)
    let result
    if (transport === 'http') {
      await this.#refreshResolution(record)
      result = await stepperJogRest(record.resolvedHost || record.host, { delta, speed }, { timeoutMs })
    } else {
      await this.#ensureConnected(record)
      result = await record.motorClient.jog({ delta, speed, timeoutMs })
    }
    record.motionState = 'moving'
    record.lastCommand = { command: 'stepper_jog', delta, speed, transport, ts: new Date().toISOString() }
    this.#emitUpdate('device.command', record, { lastCommand: record.lastCommand, result })
    return result
  }

  async stop(deviceId, { immediate = true, timeoutMs = 5000, transport = 'ws' } = {}) {
    const record = this.#requireRecord(deviceId)
    let result
    if (transport === 'http') {
      await this.#refreshResolution(record)
      result = await stopStepperRest(record.resolvedHost || record.host, { immediate }, { timeoutMs })
    } else {
      await this.#ensureConnected(record)
      result = await record.motorClient.stop({ immediate, timeoutMs })
    }
    record.lastCommand = { command: 'stepper_stop', immediate, transport, ts: new Date().toISOString() }
    this.#emitUpdate('device.command', record, { lastCommand: record.lastCommand, result })
    return result
  }

  async getMotionConfig(deviceId, { timeoutMs = 5000, transport = 'ws' } = {}) {
    const record = this.#requireRecord(deviceId)
    let result
    if (transport === 'http') {
      await this.#refreshResolution(record)
      result = await getStepperConfig(record.resolvedHost || record.host, { timeoutMs })
    } else {
      await this.#ensureConnected(record)
      result = await record.motorClient.getMotionConfig({ timeoutMs })
    }
    record.lastConfig = result
    this.#emitUpdate('device.config', record, { lastConfig: result })
    return result
  }

  async setMotionConfig(deviceId, { maxSpeed, acceleration, timeoutMs = 5000, transport = 'ws' } = {}) {
    const record = this.#requireRecord(deviceId)
    let result
    if (transport === 'http') {
      await this.#refreshResolution(record)
      result = await setStepperConfig(record.resolvedHost || record.host, { maxSpeed, acceleration }, { timeoutMs })
    } else {
      await this.#ensureConnected(record)
      result = await record.motorClient.setMotionConfig({ maxSpeed, acceleration, timeoutMs })
    }
    record.lastConfig = result
    record.lastCommand = {
      command: 'stepper_config',
      maxSpeed,
      acceleration,
      transport,
      ts: new Date().toISOString(),
    }
    this.#emitUpdate('device.command', record, { lastCommand: record.lastCommand, result })
    return result
  }

  async save() {
    const dir = path.dirname(this.configPath)
    await mkdir(dir, { recursive: true })
    const payload = {
      devices: this.listDevices().map(device => ({
        id: device.id,
        host: device.host,
        autoConnect: device.autoConnect,
      })),
    }
    await writeFile(this.configPath, JSON.stringify(payload, null, 2))
  }

  async #ensureBootstrappedDevice() {
    if (this.devices.size > 0) {
      return
    }

    const defaults = await getKnownBridgeDefaults()
    if (!defaults?.device) {
      return
    }

    const record = this.#createRecord(defaults.device)
    this.devices.set(record.id, record)

    try {
      await this.#refreshResolution(record)
      record.lastError = null
    } catch (error) {
      record.lastError = error.message
    }

    await this.save()
    this.#emitUpdate('device.registered', record, {
      bootstrap: true,
      firmware: defaults.firmware,
    })
  }

  #createRecord({ id, host, autoConnect = false }) {
    return {
      id,
      host,
      autoConnect,
      resolvedHost: null,
      connectionState: 'disconnected',
      motionState: 'unknown',
      capabilities: null,
      lastHealth: null,
      lastSystemInfo: null,
      lastStatus: null,
      lastConfig: null,
      lastCommand: null,
      lastEvent: null,
      lastError: null,
      lastResolvedAt: null,
      lastConnectedAt: null,
      transport: null,
      motorClient: null,
      listeners: [],
    }
  }

  #attachTransport(record, transport) {
    const subscriptions = []
    subscriptions.push(transport.on('connected', message => {
      record.connectionState = 'connected'
      this.#emitUpdate('device.connected', record, { welcome: message })
    }))
    subscriptions.push(transport.on('disconnected', () => {
      record.connectionState = 'disconnected'
      this.#emitUpdate('device.disconnected', record)
    }))
    subscriptions.push(transport.on('reconnecting', ({ delayMs }) => {
      record.connectionState = 'reconnecting'
      this.#emitUpdate('device.reconnecting', record, { delayMs })
    }))
    subscriptions.push(transport.on('message', message => {
      if (message?.type === 'event') {
        const nextMotionState = inferMotionState(message.event)
        if (nextMotionState) {
          record.motionState = nextMotionState
        }
        record.lastEvent = message
        this.#emitUpdate('device.event', record, { event: message })
      }
    }))
    record.listeners = subscriptions
  }

  #teardownTransport(record) {
    for (const unsubscribe of record.listeners ?? []) {
      unsubscribe()
    }
    record.listeners = []
  }

  async #ensureConnected(record) {
    if (record.transport?.isConnected && record.motorClient) {
      return
    }
    await this.connectDevice(record.id)
  }

  async #refreshResolution(record) {
    const resolved = await resolveHostOnce(record.host)
    record.resolvedHost = resolved.address
    record.lastResolvedAt = new Date().toISOString()
    this.#emitUpdate('device.resolved', record, { resolvedHost: record.resolvedHost })
    return this.#toSnapshot(record)
  }

  #requireRecord(deviceId) {
    const record = this.devices.get(deviceId)
    if (!record) {
      throw new Error(`Unknown device: ${deviceId}`)
    }
    return record
  }

  #toSnapshot(record) {
    return clone({
      id: record.id,
      host: record.host,
      resolvedHost: record.resolvedHost,
      autoConnect: record.autoConnect,
      connectionState: record.connectionState,
      motionState: record.motionState,
      capabilities: record.capabilities,
      lastHealth: record.lastHealth,
      lastSystemInfo: record.lastSystemInfo,
      lastStatus: record.lastStatus,
      lastConfig: record.lastConfig,
      lastCommand: record.lastCommand,
      lastEvent: record.lastEvent,
      lastError: record.lastError,
      lastResolvedAt: record.lastResolvedAt,
      lastConnectedAt: record.lastConnectedAt,
    })
  }

  #emitUpdate(type, record, data = {}) {
    this.emit('update', {
      type,
      ts: new Date().toISOString(),
      deviceId: record.id,
      data: {
        device: this.#toSnapshot(record),
        ...clone(data),
      },
    })
  }
}