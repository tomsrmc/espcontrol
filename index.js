#!/usr/bin/env node
import { health } from './esp32-client.js'
import { blinkLed, getStatus } from './esp32-ws-client.js'
import { ESP32WebSocketClient } from './esp32-persistent-client.js'
import { resolveHostOnce } from './esp32-resolver.js'

const args = process.argv.slice(2)

// Defaults (override via flags or env)
let host = process.env.ESP32_HOST || 'esp32.local'
let timeoutMs = Number(process.env.ESP32_TIMEOUT_MS || 5000)

// simple flag parser
const flags = []
const positionals = []
let wsParams = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith('--host=')) host = a.split('=')[1]
  else if (a === '--host') host = args[++i]
  else if (a.startsWith('--timeout=')) timeoutMs = Number(a.split('=')[1]) || timeoutMs
  else if (a === '--timeout') timeoutMs = Number(args[++i]) || timeoutMs
  else if (a.startsWith('--times=')) wsParams.times = Number(a.split('=')[1])
  else if (a === '--times') wsParams.times = Number(args[++i])
  else if (a.startsWith('--onMs=')) wsParams.onMs = Number(a.split('=')[1])
  else if (a === '--onMs') wsParams.onMs = Number(args[++i])
  else if (a.startsWith('--offMs=')) wsParams.offMs = Number(a.split('=')[1])
  else if (a === '--offMs') wsParams.offMs = Number(args[++i])
  else if (a === '--help' || a === '-h') flags.push('help')
  else positionals.push(a)
}

const showHelp = () => {
  console.log(`Usage:
  esp32 health [--host <host>] [--timeout <ms>]
  esp32 wsblink [--times <n>] [--onMs <ms>] [--offMs <ms>] [--host <host>] [--timeout <ms>]
  esp32 wsstatus [--host <host>] [--timeout <ms>]

Examples:
  esp32 health --host esp32.local
  esp32 wsblink --times 5 --onMs 100 --offMs 100
  esp32 wsstatus

Env vars:
  ESP32_HOST=esp32.local ESP32_TIMEOUT_MS=8000 esp32 wsblink
`)
}

if (flags.includes('help') || positionals.length === 0) {
  showHelp()
  process.exit(0)
}

const cmd = positionals[0]

const main = async () => {
  // Resolve .local to IPv4 once to avoid per-request DNS lag
  const { address: resolvedHost } = await resolveHostOnce(host)

  if (cmd === 'health') {
    const res = await health(resolvedHost, { timeoutMs })
    console.log(`HTTP ${res.status}`)
    console.log(res.body)
    return
  }

  if (cmd === 'wsblink') {
    const res = await blinkLed(resolvedHost, { ...wsParams, timeoutMs })
    console.log('WebSocket response:')
    console.log(JSON.stringify(res, null, 2))
    return
  }

  if (cmd === 'wsstatus') {
    const client = new ESP32WebSocketClient(resolvedHost)
    try {
      await client.connect()
      const res = await client.getStatus({ timeoutMs })
      console.log('WebSocket response:')
      console.log(JSON.stringify(res, null, 2))
      client.disconnect()
    } catch (err) {
      client.disconnect()
      throw err
    }
    return
  }

  showHelp()
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err))
  process.exit(1)
})
