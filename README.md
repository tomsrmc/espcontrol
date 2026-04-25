# ESP Control Client

Node.js controller/client for the ESP32 firmware in the companion `esp` project.

This project is the host-side half of the system. It provides:

- a CLI for common device operations
- a local server mode for browser and app clients
- reusable modules for HTTP and WebSocket access
- hostname resolution for `.local` devices
- a persistent WebSocket client for long-lived UI sessions
- a motor domain client that hides raw protocol commands behind a stable host-side API
- a shared device registry with persistence and background host refresh

For the specific controller board, driver, actuator, and setup requirements used with this client, see `../esp/HARDWARE.md` in the companion firmware project.

## Purpose

Use this project when you want a desktop app, local service, Electron app, or other host-side layer to control the ESP32 without talking to the device directly from every screen or component.

In practice, this project acts as a control adapter between a UI and the device firmware:

- the ESP32 exposes REST and WebSocket APIs
- `espcontrol` connects to those APIs
- your UI can call the exported helpers directly or talk to the built-in host service over HTTP and WebSocket

## What is in this project

### CLI entry point

- `index.js` — command-line interface published as `esp32`

### Server foundation

- `server.js` — local HTTP and WebSocket bridge for UI clients
- `device-registry.js` — shared device state, persistence, discovery refresh, and command orchestration

### HTTP helper

- `esp32-client.js` — REST helpers for health, system info, LED blink, and stepper jog

### WebSocket helpers

- `esp32-ws-client.js` — one-shot WebSocket command helper
- `esp32-persistent-client.js` — reusable persistent client with request tracking and auto-reconnect

### Motor domain client

- `motor-client.js` — stable motor API for `jog`, `getStatus`, `stop`, `setMotionConfig`, `getMotionConfig`, and event subscription

### Discovery helper

- `esp32-resolver.js` — resolves `.local` hostnames to IPv4 addresses and caches results

## Requirements

- Node.js `18+` recommended
- access to the same local network as the ESP32
- companion firmware from the `esp` project flashed and running

`Node.js 18+` is recommended because the project relies on the built-in `fetch()` API.

## Install

From the `espcontrol` folder:

```bash
npm install
```

## Package summary

- package name: `controller`
- package type: ES modules
- CLI binary: `esp32`
- external dependency: `ws`
- persisted device config: `.espcontrol-devices.json`

## Quick start

### Run the health check

```bash
node index.js health --host esp32.local
```

### Or use the package script

```bash
npm run health
```

### Blink the onboard LED over WebSocket

```bash
node index.js wsblink --times 5 --onMs 100 --offMs 100 --host esp32.local
```

### Get runtime status over WebSocket

```bash
node index.js wsstatus --host esp32.local
```

### Jog the stepper over WebSocket

```bash
node index.js stepper_jog --delta 160 --speed 800 --host esp32.local
```

### Read live stepper state

```bash
node index.js stepper_status --host esp32.local
```

### Stop motion immediately

```bash
node index.js stepper_stop --host esp32.local
```

### Update runtime motion config

```bash
node index.js stepper_config --speed 1200 --acceleration 900 --host esp32.local
```

### Inspect firmware capabilities

```bash
node index.js capabilities --host esp32.local
```

### Start the local control server

```bash
npm run server
```

`npm start` now launches the bridge in server mode as well.

By default the server listens on `127.0.0.1:4010` and persists registered devices to `.espcontrol-devices.json` in the project folder.

When the persisted registry is empty, the bridge now bootstraps a default device automatically from the known firmware configuration:

- device id: `esp32` by default, or the current firmware mDNS hostname
- host: `esp32.local` by default, or `http://<ESP32_HOST>` if `ESP32_HOST` is set
- auto-connect: enabled by default so the bridge will attach to the ESP on startup when reachable

The bootstrap device is derived from `../esp/src/config/secrets.h` when available, specifically `MDNS_HOSTNAME`, with environment-variable overrides.

## Motor protocol model

The firmware now exposes a versioned single-axis motor contract. `espcontrol` keeps transport details here, and higher layers should depend on the host-side motor client instead of raw command names.

Key properties of the current contract:

- request/response correlation through WebSocket `id`
- a shared response envelope with `status`, `code`, `message`, `id`, and `data`
- capability discovery at connect time and through the `capabilities` command
- unsolicited lifecycle events for `stepper.started`, `stepper.completed`, `stepper.stopped`, and `stepper.fault`
- runtime tuning through `stepper_config` while firmware still enforces safe min/max bounds

The new host service builds on that same contract and rebroadcasts device state changes to browser or app clients through a single local WebSocket.

## Server mode

Run the service with:

```bash
node index.js server --server-host 127.0.0.1 --port 4010
```

Environment variables:

- `ESP32_SERVER_HOST`
- `ESP32_SERVER_PORT`
- `ESP32_CONFIG_PATH`
- `ESP32_DEVICE_ID`
- `ESP32_AUTO_CONNECT`
- `ESP32_BOOTSTRAP_DEVICE`
- `ESP32_FIRMWARE_SECRETS_PATH`
- `ESP32_MDNS_HOSTNAME`
- `ESP32_HOST`

### What the server does

- keeps a registry of known ESP32 devices by `id` and `host`
- persists that registry to `.espcontrol-devices.json`
- refreshes known `.local` host resolutions in the background
- opens one persistent WebSocket per connected device when you request WebSocket-backed control
- exposes a local HTTP API for browser, desktop, or Next.js server-side callers
- exposes a local WebSocket bridge at `/ws` that broadcasts registry and motion events

### HTTP API

Base URL example:

```text
http://127.0.0.1:4010
```

Core routes:

- `GET /health` — host service health and known device summary
- `GET /devices` — list registered devices and cached state
- `POST /devices` — register a device with `{ "id": "bench", "host": "esp32.local", "autoConnect": true }`
- `GET /devices/:id` — get one device snapshot
- `DELETE /devices/:id` — remove a device from the registry
- `POST /devices/:id/connect` — open the persistent device WebSocket
- `POST /devices/:id/disconnect` — close the persistent device WebSocket
- `GET /devices/:id/health` — run the firmware `/health` check
- `GET /devices/:id/system` — fetch firmware system info
- `GET /devices/:id/capabilities` — fetch or reuse firmware capability data
- `GET /devices/:id/motion/status` — read live motion state
- `POST /devices/:id/motion/jog` — enqueue motion with `{ "delta": 160, "speed": 800 }`
- `POST /devices/:id/motion/stop` — stop motion with `{ "immediate": true }`
- `GET /devices/:id/motion/config` — read motion config
- `POST /devices/:id/motion/config` — update motion config with `{ "maxSpeed": 1200, "acceleration": 900 }`

The motion routes accept `transport=ws` or `transport=http`. WebSocket is the default for the host service because it supports request correlation and broadcast events.

### HTTP API example

Register a device and auto-connect it:

```bash
curl -X POST http://127.0.0.1:4010/devices \
  -H "Content-Type: application/json" \
  -d '{"id":"bench","host":"esp32.local","autoConnect":true}'
```

Jog the axis through the host server:

```bash
curl -X POST http://127.0.0.1:4010/devices/bench/motion/jog \
  -H "Content-Type: application/json" \
  -d '{"delta":160,"speed":800}'
```

### WebSocket bridge

Connect UI clients to:

```text
ws://127.0.0.1:4010/ws
```

The server sends an initial snapshot with all known devices, then broadcasts updates such as `device.connected`, `device.event`, `device.command`, and `device.health` whenever local state changes.

Client messages use a small command envelope:

```json
{
  "requestId": 1,
  "action": "command",
  "deviceId": "bench",
  "command": "motion.jog",
  "params": {
    "delta": 160,
    "speed": 800
  }
}
```

Supported WebSocket actions:

- `subscribe`
- `listDevices`
- `command`

Supported WebSocket commands:

- `registerDevice`
- `removeDevice`
- `connect`
- `disconnect`
- `health`
- `system`
- `capabilities`
- `motion.status`
- `motion.jog`
- `motion.stop`
- `motion.config.get`
- `motion.config.set`

## CLI usage

The CLI accepts a command followed by optional flags. It resolves `.local` hostnames before opening HTTP or WebSocket connections.

### Available commands

#### `health`

Calls the firmware REST endpoint:

- `GET /health`

Example:

```bash
esp32 health --host esp32.local --timeout 5000
```

#### `wsblink`

Opens a WebSocket connection to port `81`, waits for the `connected` event, then sends a `blink` command.

Example:

```bash
esp32 wsblink --times 5 --onMs 100 --offMs 100 --host esp32.local
```

#### `wsstatus`

Creates a persistent WebSocket client, connects, requests `status`, prints the response, then disconnects.

Example:

```bash
esp32 wsstatus --host esp32.local
```

#### `stepper_jog`

Sends a `stepper_jog` WebSocket command.

Example:

```bash
esp32 stepper_jog --delta 160 --speed 800 --host esp32.local
```

#### `stepper_status`

Reads the current stepper status over the shared motor protocol.

#### `stepper_stop`

Stops active motion. Use `--no-immediate` to request a controlled stop instead of the default immediate stop.

#### `stepper_config`

Without flags, reads the current motion config and safety limits. With `--speed` and/or `--acceleration`, updates runtime motion config over WebSocket.

#### `capabilities`

Prints the capability handshake and current protocol limits seen by the host.

#### `server`

Starts the local HTTP and WebSocket bridge.

Example:

```bash
esp32 server --server-host 127.0.0.1 --port 4010
```

#### `step_pulse`

Removed legacy command. The CLI now prints a message directing callers to `stepper_jog` or `wsblink`.

### Global CLI flags

#### Connection flags

- `--host <host>` — target hostname or IP
- `--timeout <ms>` — request timeout in milliseconds

Defaults:

- host: `esp32.local`
- timeout: `5000`

#### Server flags

- `--server-host <host>`
- `--port <port>`
- `--config <path>`

#### Blink flags

- `--times <n>`
- `--onMs <ms>`
- `--offMs <ms>`

#### Stepper flags

- `--delta <steps>`
- `--speed <stepsPerSecond>`
- `--acceleration <stepsPerSecondSquared>`
- `--immediate`
- `--no-immediate`

### Environment variables

You can set defaults with environment variables:

- `ESP32_HOST`
- `ESP32_TIMEOUT_MS`

Example:

```bash
ESP32_HOST=esp32.local ESP32_TIMEOUT_MS=8000 esp32 wsblink
```

## CLI examples and expected behavior

### `health`

Example output:

```text
HTTP 200
{"status":"ok"}
```

### `wsblink`

Example output:

```json
{
  "status": "ok",
  "command": "blink",
  "onMs": 100,
  "offMs": 100,
  "times": 5,
  "roundTripMs": 18
}
```

### `wsstatus`

Example output:

```json
{
  "status": "ok",
  "uptime": 123456,
  "freeHeap": 215432,
  "ip": "192.168.1.42",
  "rssi": -55,
  "roundTripMs": 7
}
```

### `stepper_jog`

Example output:

```json
{
  "status": "ok",
  "command": "stepper_jog",
  "delta": 160,
  "speed": 800,
  "roundTripMs": 9
}
```

## How the client talks to the ESP32

### REST paths

The HTTP helper can build requests such as:

- `http://<host>/health`
- `http://<host>/system/info`
- `http://<host>/led/blink`
- `http://<host>/stepper/jog`

### WebSocket path

The WebSocket helpers build:

- `ws://<host>:81`

The server sends an initial message like:

```json
{
  "type": "connected",
  "client": 0
}
```

The one-shot client waits for that welcome message before it sends the actual command.

## Module documentation

### `esp32-client.js`

Exports:

#### `makeBaseUrl(host)`

Normalizes a host string into an HTTP base URL.

Examples:

- `esp32.local` -> `http://esp32.local`
- `http://192.168.1.42` -> unchanged

#### `health(host, options)`

Calls `GET /health`.

Returns:

```js
{ status, body }
```

#### `getSystemInfo(host, options)`

Calls `GET /system/info` and parses the JSON response.

Returns:

```js
{ status, json }
```

#### `blinkLedRest(host, params, options)`

Posts JSON to `POST /led/blink`.

Typical payload:

```js
{ onMs: 100, offMs: 100, times: 3 }
```

#### `stepperJog(host, params, options)`

Posts JSON to `POST /stepper/jog`.

Typical payload:

```js
{ delta: 160, speed: 800 }
```

#### `runAction(host, token, payload, options)`

Posts JSON to `/run`.

Important: this helper still exists in the client code, but the current firmware does not expose `/run`, so treat it as legacy or forward-looking.

### `esp32-ws-client.js`

Exports:

#### `sendCommand(host, command, params, options)`

Creates a short-lived WebSocket connection, waits for the welcome frame, sends one command, waits for one JSON response, then closes the connection.

Options:

- `timeoutMs` default `5000`
- `port` default `81`

Adds `roundTripMs` to the parsed response before resolving.

#### `blinkLed(host, options)`

Convenience wrapper around command `blink`.

Option defaults:

- `onMs = 50`
- `offMs = 50`
- `times = 10`

#### `getStatus(host, options)`

Convenience wrapper around command `status`.

#### `stepper_jog`

There is no dedicated convenience wrapper yet. Use the generic helper:

```js
await sendCommand(host, 'stepper_jog', { delta: 160, speed: 800 }, { timeoutMs: 5000 })
```

### `esp32-persistent-client.js`

Exports the `ESP32WebSocketClient` class.

This class is intended for a UI or long-running process that wants to keep a WebSocket open and send multiple commands over one session.

#### Constructor

```js
new ESP32WebSocketClient(host, port = 81)
```

#### Key features

- persistent connection
- numeric request IDs
- pending request tracking
- per-command timeouts
- unsolicited server message hook
- connection handshake capture
- event subscription with `on()` and `off()`
- auto-reconnect after disconnect

#### Main methods

##### `connect()`

Connects to the ESP32 and resolves after the server sends the `connected` message.

##### `sendCommand(command, params, timeoutMs)`

Sends a JSON command with an auto-generated `id`.

##### `blink(options)`

Wrapper for `sendCommand('blink', ...)`.

##### `getStatus(options)`

Wrapper for `sendCommand('status', ...)`.

##### `getCapabilities(options)`

Wrapper for `sendCommand('capabilities', ...)`.

##### `disconnect()`

Closes the connection and disables reconnect.

For commands without a convenience wrapper, call `sendCommand()` directly.

#### Extending for UI use

The class includes `handleServerMessage(message)` and event listeners via `on(eventName, handler)`, so UIs can react to broadcast lifecycle events without parsing raw sockets in every view.

Example:

```js
import { ESP32WebSocketClient } from './esp32-persistent-client.js'

class UIClient extends ESP32WebSocketClient {
  handleServerMessage(message) {
    console.log('UI update', message)
  }
}
```

### `esp32-resolver.js`

Exports:

#### `resolveHostOnce(host)`

If the host ends with `.local`, it resolves the hostname to IPv4 using Node DNS and caches the result for 5 minutes.

This avoids repeated mDNS lookup delays for every request.

Returns an object like:

```js
{ address, hostHeader, ts }
```

For non-`.local` hosts, it returns the original host as `address`.

#### `keepAliveAgent`

Creates an HTTP keep-alive agent. It is exported but not currently used by the shipped CLI.

## Using this project from a UI

The cleanest approach is to import the modules into your local app layer and keep all ESP-specific transport logic here.

If you are building a browser UI or a Next.js app, prefer talking to the local server mode from your app server or route handlers so the browser never needs to open raw sockets to the ESP32 directly.

### Example: use the motor domain client

```js
import { ESP32MotorClient } from './motor-client.js'

const motor = new ESP32MotorClient('esp32.local')
await motor.connect()

const unsubscribe = motor.onMotionEvent(event => {
  console.log('motion event', event.event, event.data?.stepper)
})

await motor.setMotionConfig({ maxSpeed: 1200, acceleration: 900 })
await motor.jog({ delta: 160 })

unsubscribe()
motor.disconnect()
```

### Example: fetch device info over REST

```js
import { getSystemInfo } from './esp32-client.js'

const info = await getSystemInfo('esp32.local', { timeoutMs: 5000 })
console.log(info.json)
```

### Example: jog the stepper over REST

```js
import { stepperJog } from './esp32-client.js'

await stepperJog('esp32.local', { delta: 160, speed: 800 }, { timeoutMs: 5000 })
```

### Example: one-shot WebSocket button action

```js
import { blinkLed, sendCommand } from './esp32-ws-client.js'

await blinkLed('esp32.local', { times: 3, onMs: 100, offMs: 100 })
await sendCommand('esp32.local', 'stepper_jog', { delta: 160, speed: 800 })
```

### Example: persistent status panel

```js
import { ESP32WebSocketClient } from './esp32-persistent-client.js'

const client = new ESP32WebSocketClient('esp32.local')
await client.connect()
const status = await client.getStatus({ timeoutMs: 5000 })
console.log(status)
```

### Suggested UI architecture

A practical integration pattern is:

1. on app startup, resolve and health-check the device
2. fetch initial system info over REST
3. create one persistent WebSocket client per device if the UI is interactive
4. wrap commands in higher-level UI actions
5. keep device state in a store
6. surface timeout and connectivity errors in the UI

## Relationship to the firmware project

This project assumes the companion `esp` firmware exposes:

### Supported today

- `GET /health`
- `GET /system/info`
- `GET /system/status`
- `POST /led/blink`
- `POST /stepper/jog`
- WebSocket command `blink`
- WebSocket command `status`
- WebSocket command `stepper_jog`

### Referenced here but not implemented in current firmware

- `POST /run`

## Limitations

1. No authentication is enforced by the current firmware.
2. Transport is plain HTTP and plain WebSocket.
3. The one-shot WebSocket helper expects exactly one useful JSON response per command.
4. `.local` discovery depends on local mDNS support.
5. There is no dedicated convenience wrapper for WebSocket `stepper_jog`; use `sendCommand()`.
6. The firmware currently does not echo WebSocket request `id` values for `stepper_jog`.
7. `runAction()` remains a legacy helper until `/run` exists again.

## Troubleshooting

### `esp32.local` does not resolve on Windows

Try one of the following:

- install Bonjour if mDNS is unavailable
- use the IP address shown by the ESP32 serial monitor
- confirm the host machine and ESP32 are on the same network

### HTTP works but WebSocket times out

- confirm the firmware is running the WebSocket server on port `81`
- confirm local firewall rules allow the connection
- make sure the device is reachable at the same host used for HTTP

### `UNKNOWN_COMMAND` response

The client reached the ESP32 successfully, but the device does not recognize the command. This usually means the firmware on the board is older than the client code or is missing the command handler.

### `fetch is not defined`

Use a newer Node.js release, preferably `18+`.

### `stepper_jog` returns `ok` but the axis does not move

- a successful response means the ESP32 accepted the command, not that physical motion completed
- the documented firmware currently targets a BIGTREETECH TMC2209 V1.3 in standalone STEP/DIR/EN mode
- the current hardware example uses an OpenBuilds belt-driven V-slot NEMA17 actuator, so travel distance depends on axis calibration and microstep settings
- verify motor supply power, current limit, common ground, and enable polarity on the driver
- if the firmware logs show the move being queued, inspect the STEP line electrically rather than the CLI path

## Recommended next steps

If this project is going to back a UI, the next improvements are:

- move the host service and clients to TypeScript
- define shared Zod schemas for the host API, bridge messages, and firmware envelopes
- add a Next.js App Router frontend that talks to this local service instead of the ESP32 directly
- add Auth.js and role-based command authorization before exposing the service beyond localhost
- persist historical device and job records in MongoDB once you need audit trails or multi-user coordination
