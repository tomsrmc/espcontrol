#!/usr/bin/env node
import { Board, Led } from 'johnny-five'
import { EtherPortClient } from 'etherport-client'
import { resolveHostOnce } from './esp32-resolver.js'

const args = process.argv.slice(2)

// Defaults (override via flags or env)
let host = process.env.ESP32_HOST || 'esp32.local'
let port = Number(process.env.ESP32_PORT || 3030)
let timeoutMs = Number(process.env.ESP32_TIMEOUT_MS || 5000)

// Simple flag parser
const flags = []
const positionals = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith('--host=')) host = a.split('=')[1]
  else if (a === '--host') host = args[++i]
  else if (a.startsWith('--port=')) port = Number(a.split('=')[1]) || port
  else if (a === '--port') port = Number(args[++i]) || port
  else if (a.startsWith('--timeout=')) timeoutMs = Number(a.split('=')[1]) || timeoutMs
  else if (a === '--timeout') timeoutMs = Number(args[++i]) || timeoutMs
  else if (a === '--help' || a === '-h') flags.push('help')
  else positionals.push(a)
}

const showHelp = () => {
  console.log(`Usage:
  esp32 discover [--host <host>] [--port <port>] [--timeout <ms>]
  esp32 blink [--host <host>] [--port <port>] [--timeout <ms>]
  esp32 led <on|off|toggle> [--host <host>] [--port <port>] [--timeout <ms>]

Examples:
  esp32 discover --host esp32.local
  esp32 blink --host 192.168.1.42 --port 3030
  esp32 led on --host esp32.local

Env vars:
  ESP32_HOST=esp32.local ESP32_PORT=3030 ESP32_TIMEOUT_MS=8000 esp32 blink
`)
}

if (flags.includes('help') || positionals.length === 0) {
  showHelp()
  process.exit(0)
}

const cmd = positionals[0]

// Create board connection
const createBoard = async (resolvedHost, port) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Connection timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    console.log(`Connecting to ESP32 at ${resolvedHost}:${port}...`)
    
    const etherPort = new EtherPortClient({
      host: resolvedHost,
      port: port
    })

    const board = new Board({
      port: etherPort,
      repl: false
    })

    board.on('ready', () => {
      clearTimeout(timeout)
      console.log('Board connected!')
      resolve(board)
    })

    board.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

const main = async () => {
  try {
    // Resolve .local to IPv4 once to avoid per-request DNS lag
    const { address: resolvedHost } = await resolveHostOnce(host)

    if (cmd === 'discover') {
      console.log(`ESP32 host: ${host} → ${resolvedHost}:${port}`)
      const board = await createBoard(resolvedHost, port)
      console.log('✓ ESP32 discovered and connected via Firmata')
      board.samplingInterval(1000) // Test communication
      setTimeout(() => {
        console.log('Connection test complete')
        process.exit(0)
      }, 2000)
      return
    }

    if (cmd === 'blink') {
      const board = await createBoard(resolvedHost, port)
      
      // Use pin 2 (built-in LED on most ESP32 boards)
      const led = new Led(2)
      
      console.log('Starting blink sequence...')
      led.blink(500) // Blink every 500ms
      
      // Run for 10 seconds then exit
      setTimeout(() => {
        led.stop()
        console.log('Blink sequence complete')
        process.exit(0)
      }, 10000)
      return
    }

    if (cmd === 'led') {
      const action = positionals[1] || 'toggle'
      const board = await createBoard(resolvedHost, port)
      
      const led = new Led(2)
      
      switch (action.toLowerCase()) {
        case 'on':
          led.on()
          console.log('LED turned on')
          break
        case 'off':
          led.off()
          console.log('LED turned off')
          break
        case 'toggle':
          led.toggle()
          console.log('LED toggled')
          break
        default:
          console.log(`Unknown LED action: ${action}`)
          showHelp()
          process.exit(1)
      }
      
      setTimeout(() => process.exit(0), 1000)
      return
    }

    showHelp()
  } catch (err) {
    console.error('Error:', err?.message || String(err))
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err))
  process.exit(1)
})
