#!/usr/bin/env node
import { health, runAction } from './esp32-client.js'
import { resolveHostOnce } from './esp32-resolver.js'

const args = process.argv.slice(2)

// Defaults (override via flags or env)
let host = process.env.ESP32_HOST || 'esp32.local'
let token = process.env.ESP32_TOKEN || 'supersecret'
let timeoutMs = Number(process.env.ESP32_TIMEOUT_MS || 5000)

// simple flag parser
const flags = []
const positionals = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith('--host=')) host = a.split('=')[1]
  else if (a === '--host') host = args[++i]
  else if (a.startsWith('--token=')) token = a.split('=')[1]
  else if (a === '--token') token = args[++i]
  else if (a.startsWith('--timeout=')) timeoutMs = Number(a.split('=')[1]) || timeoutMs
  else if (a === '--timeout') timeoutMs = Number(args[++i]) || timeoutMs
  else if (a === '--help' || a === '-h') flags.push('help')
  else positionals.push(a)
}

const showHelp = () => {
  console.log(`Usage:
  esp32 health [--host <host>] [--token <token>] [--timeout <ms>]
  esp32 run <json|path> [--host <host>] [--token <token>] [--timeout <ms>]

Examples:
  esp32 health --host esp32.local
  esp32 run '{"job":"blink","strength":3}' --host 192.168.1.42 --token supersecret

Env vars:
  ESP32_HOST=esp32.local ESP32_TOKEN=supersecret ESP32_TIMEOUT_MS=8000 esp32 run '{"job":"blink"}'
`)
}

if (flags.includes('help') || positionals.length === 0) {
  showHelp()
  process.exit(0)
}

const cmd = positionals[0]

const readPayload = async input => {
  if (!input) return '{}'
  const trimmed = input.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const fs = await import('node:fs/promises')
    return await fs.readFile(input, 'utf8')
  }
  return input
}

const main = async () => {
  // Resolve .local to IPv4 once to avoid per-request DNS lag
  const { address: resolvedHost } = await resolveHostOnce(host)

  if (cmd === 'health') {
    const res = await health(resolvedHost, { timeoutMs })
    console.log(`HTTP ${res.status}`)
    console.log(res.body)
    return
  }

  if (cmd === 'run') {
    const bodyArg = positionals[1] || '{}'
    const body = await readPayload(bodyArg)
    const res = await runAction(resolvedHost, token, body, { timeoutMs })
    console.log(`HTTP ${res.status}`)
    console.log(res.body)
    return
  }

  showHelp()
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err))
  process.exit(1)
})
