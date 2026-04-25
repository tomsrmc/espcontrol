# ESP Control Client

Node.js controller/client for the ESP32 firmware in the companion `esp` project.

This project is the host-side half of the system. It provides:

- a CLI for common device operations
- reusable modules for HTTP and WebSocket access
- hostname resolution for `.local` devices
- a persistent WebSocket client for long-lived UI sessions

For the specific controller board, driver, actuator, and setup requirements used with this client, see `../esp/HARDWARE.md` in the companion firmware project.

## Purpose

Use this project when you want a desktop app, local service, Electron app, or other host-side layer to control the ESP32 without talking to the device directly from every screen or component.

In practice, this project acts as a control adapter between a UI and the device firmware:

- the ESP32 exposes REST and WebSocket APIs
- `espcontrol` connects to those APIs
- your UI calls the exported helpers or wraps them in its own state layer

## What is in this project

### CLI entry point

- `index.js` — command-line interface published as `esp32`

### HTTP helper

- `esp32-client.js` — REST helpers for health, system info, LED blink, and stepper jog

### WebSocket helpers

- `esp32-ws-client.js` — one-shot WebSocket command helper
- `esp32-persistent-client.js` — reusable persistent client with request tracking and auto-reconnect

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

#### `step_pulse`

Removed legacy command. The CLI now prints a message directing callers to `stepper_jog` or `wsblink`.

### Global CLI flags

#### Connection flags

- `--host <host>` — target hostname or IP
- `--timeout <ms>` — request timeout in milliseconds

Defaults:

- host: `esp32.local`
- timeout: `5000`

#### Blink flags

- `--times <n>`
- `--onMs <ms>`
- `--offMs <ms>`

#### Stepper flags

- `--delta <steps>`
- `--speed <stepsPerSecond>`

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

##### `disconnect()`

Closes the connection and disables reconnect.

For commands without a convenience wrapper, call `sendCommand()` directly.

#### Extending for UI use

The class includes `handleServerMessage(message)`, which can be overridden to process unsolicited messages from the ESP32 if the firmware later starts sending broadcast JSON messages.

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

- add dedicated stepper convenience wrappers for the persistent client
- define shared command schemas between UI and firmware
- add device discovery/status refresh logic
- add completion/progress handling for long-running device actions
- add authentication if the device will operate on a less trusted network
