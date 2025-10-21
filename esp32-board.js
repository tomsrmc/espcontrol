import { Board } from 'johnny-five'
import { EtherPortClient } from 'etherport-client'

/**
 * ESP32 Board connection utilities for Johnny-Five over WiFi Firmata
 */

export class ESP32Board {
  constructor(options = {}) {
    this.host = options.host || 'esp32.local'
    this.port = options.port || 3030
    this.timeout = options.timeout || 10000
    this.board = null
  }

  /**
   * Connect to the ESP32 board
   * @returns {Promise<Board>} Johnny-Five board instance
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.timeout}ms`))
      }, this.timeout)

      console.log(`Connecting to ESP32 at ${this.host}:${this.port}...`)
      
      const etherPort = new EtherPortClient({
        host: this.host,
        port: this.port
      })

      this.board = new Board({
        port: etherPort,
        repl: false,
        debug: false
      })

      this.board.on('ready', () => {
        clearTimeout(timeout)
        console.log('✓ ESP32 board connected via WiFi Firmata')
        resolve(this.board)
      })

      this.board.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`Board connection failed: ${err.message}`))
      })

      this.board.on('disconnect', () => {
        console.log('ESP32 board disconnected')
      })
    })
  }

  /**
   * Test board connectivity
   * @returns {Promise<boolean>}
   */
  async test() {
    try {
      if (!this.board) {
        await this.connect()
      }
      
      // Test by setting sampling interval
      this.board.samplingInterval(1000)
      return true
    } catch (err) {
      console.error('Board test failed:', err.message)
      return false
    }
  }

  /**
   * Disconnect from the board
   */
  disconnect() {
    if (this.board) {
      this.board.transport.close()
      this.board = null
    }
  }

  /**
   * Get the connected board instance
   * @returns {Board|null}
   */
  getBoard() {
    return this.board
  }
}

/**
 * Quick connection helper
 * @param {string} host - ESP32 host/IP
 * @param {number} port - Firmata port (default 3030)
 * @param {number} timeout - Connection timeout in ms
 * @returns {Promise<Board>}
 */
export async function connectToESP32(host = 'esp32.local', port = 3030, timeout = 10000) {
  const esp32 = new ESP32Board({ host, port, timeout })
  return await esp32.connect()
}

/**
 * Create a board with automatic retry
 * @param {Object} options - Connection options
 * @returns {Promise<Board>}
 */
export async function createBoardWithRetry(options = {}) {
  const { retries = 3, retryDelay = 2000, ...boardOptions } = options
  
  for (let i = 0; i < retries; i++) {
    try {
      return await connectToESP32(boardOptions.host, boardOptions.port, boardOptions.timeout)
    } catch (err) {
      console.log(`Connection attempt ${i + 1}/${retries} failed: ${err.message}`)
      if (i < retries - 1) {
        console.log(`Retrying in ${retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      } else {
        throw err
      }
    }
  }
}