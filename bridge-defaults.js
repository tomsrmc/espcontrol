import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_FIRMWARE_SECRETS_PATH = path.resolve(__dirname, '../esp/src/config/secrets.h')

const parseBoolean = (value, fallback) => {
  if (value === undefined) {
    return fallback
  }

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return fallback
}

const parseDefine = (source, name) => {
  const match = source.match(new RegExp(`#define\\s+${name}\\s+"([^"]+)"`))
  return match?.[1] ?? null
}

const readFirmwareHostname = async firmwareSecretsPath => {
  try {
    const source = await readFile(firmwareSecretsPath, 'utf8')
    return parseDefine(source, 'MDNS_HOSTNAME')
  } catch {
    return null
  }
}

export const getKnownBridgeDefaults = async () => {
  const bootstrapDevice = parseBoolean(process.env.ESP32_BOOTSTRAP_DEVICE, true)
  if (!bootstrapDevice) {
    return null
  }

  const firmwareSecretsPath = process.env.ESP32_FIRMWARE_SECRETS_PATH || DEFAULT_FIRMWARE_SECRETS_PATH
  const configuredHostname = process.env.ESP32_MDNS_HOSTNAME || await readFirmwareHostname(firmwareSecretsPath)
  const mdnsHostname = configuredHostname || 'esp32'
  const host = process.env.ESP32_HOST || `${mdnsHostname}.local`
  const deviceId = process.env.ESP32_DEVICE_ID || mdnsHostname
  const autoConnect = parseBoolean(process.env.ESP32_AUTO_CONNECT, true)

  return {
    device: {
      id: deviceId,
      host,
      autoConnect,
    },
    firmware: {
      secretsPath: firmwareSecretsPath,
      mdnsHostname,
    },
  }
}