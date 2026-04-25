#!/usr/bin/env node
import readline from 'node:readline'
import process from 'node:process'
import { health, getSystemInfo, blinkLedRest, stepperJog } from './esp32-client.js'
import { resolveHostOnce } from './esp32-resolver.js'
import { blinkLed, sendCommand } from './esp32-ws-client.js'
import { ESP32WebSocketClient } from './esp32-persistent-client.js'

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
  else if (a.startsWith('--pulses=')) wsParams.pulses = Number(a.split('=')[1])
  else if (a === '--pulses') wsParams.pulses = Number(args[++i])
  else if (a.startsWith('--intervalUs=')) wsParams.intervalUs = Number(a.split('=')[1])
  else if (a === '--intervalUs') wsParams.intervalUs = Number(args[++i])
  else if (a.startsWith('--delta=')) wsParams.delta = Number(a.split('=')[1])
  else if (a === '--delta') wsParams.delta = Number(args[++i])
  else if (a.startsWith('--speed=')) wsParams.speed = Number(a.split('=')[1])
  else if (a === '--speed') wsParams.speed = Number(args[++i])
  else if (a === '--help' || a === '-h') flags.push('help')
  else positionals.push(a)
}

const showHelp = () => {
  console.log(`Usage:
  esp32 health [--host <host>] [--timeout <ms>]
  esp32 wsblink [--times <n>] [--onMs <ms>] [--offMs <ms>] [--host <host>] [--timeout <ms>]
  esp32 wsstatus [--host <host>] [--timeout <ms>]
  esp32 stepper_jog [--delta <steps>] [--host <host>] [--timeout <ms>]

Examples:
  esp32 health --host esp32.local
  esp32 wsblink --times 5 --onMs 100 --offMs 100
  esp32 wsstatus
  esp32 stepper_jog --delta 160

Env vars:
  ESP32_HOST=esp32.local ESP32_TIMEOUT_MS=8000 esp32 wsblink
`)
}

if (flags.includes('help') || positionals.length === 0) {
  showHelp();
  process.exit(0);
}

const cmd = positionals[0];

const main = async () => {
  // Resolve .local to IPv4 once to avoid per-request DNS lag
  const { address: resolvedHost } = await resolveHostOnce(host);

  if (cmd === 'health') {
    const res = await health(resolvedHost, { timeoutMs });
    console.log(`HTTP ${res.status}`);
    console.log(res.body);
    process.exit(0);
  }

  if (cmd === 'wsblink') {
    const res = await blinkLed(resolvedHost, { ...wsParams, timeoutMs });
    console.log('WebSocket response:');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (cmd === 'wsstatus') {
    const client = new ESP32WebSocketClient(resolvedHost);
    try {
      await client.connect();
      const res = await client.getStatus({ timeoutMs });
      console.log('WebSocket response:');
      console.log(JSON.stringify(res, null, 2));
      client.disconnect();
      process.exit(0);
    } catch (err) {
      client.disconnect();
      throw err;
    }
  }

  if (cmd === 'stepper_jog') {
    // Default delta: 160 (2mm if 80 steps/mm)
    const delta = Number(wsParams.delta || 160);
    const speed = Number(wsParams.speed || 800);
    const res = await sendCommand(resolvedHost, 'stepper_jog', { delta, speed }, { timeoutMs });
    console.log('WebSocket response:');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (cmd === 'step_pulse') {
    console.error('The step_pulse test command has been removed. Use stepper_jog or wsblink instead.');
    process.exit(1);
  }

  showHelp();
  process.exit(0);
};

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
