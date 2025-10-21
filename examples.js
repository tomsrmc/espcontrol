#!/usr/bin/env node
/**
 * ESP32 Johnny-Five Examples
 * Demonstrates various components and capabilities
 */

import { Led, Button, Sensor, Servo, Motor } from 'johnny-five'
import { ESP32Board } from './esp32-board.js'
import { resolveHostOnce } from './esp32-resolver.js'

const examples = {
  async blinkPattern() {
    console.log('🔥 Starting blink pattern example...')
    const esp32 = new ESP32Board()
    await esp32.connect()
    
    const led = new Led(2) // Built-in LED
    
    // Complex blink pattern
    const pattern = [200, 200, 200, 800, 500, 300, 200, 1000]
    let index = 0
    
    const blink = () => {
      led.toggle()
      setTimeout(blink, pattern[index++ % pattern.length])
    }
    
    blink()
    
    // Run for 15 seconds
    setTimeout(() => {
      led.off()
      esp32.disconnect()
      console.log('✓ Blink pattern complete')
      process.exit(0)
    }, 15000)
  },

  async multiLed() {
    console.log('💡 Starting multi-LED example...')
    const esp32 = new ESP32Board()
    await esp32.connect()
    
    const leds = [
      new Led(2),  // Built-in LED
      new Led(4),  // External LED 1
      new Led(16), // External LED 2
      new Led(17)  // External LED 3
    ]
    
    // Knight Rider style sweep
    const sweep = async () => {
      for (let i = 0; i < leds.length; i++) {
        leds[i].on()
        await new Promise(resolve => setTimeout(resolve, 150))
        leds[i].off()
      }
      
      for (let i = leds.length - 2; i > 0; i--) {
        leds[i].on()
        await new Promise(resolve => setTimeout(resolve, 150))
        leds[i].off()
      }
    }
    
    // Run sweep 10 times
    for (let i = 0; i < 10; i++) {
      await sweep()
    }
    
    esp32.disconnect()
    console.log('✓ Multi-LED sweep complete')
    process.exit(0)
  },

  async buttonLed() {
    console.log('🔘 Starting button + LED example...')
    console.log('   Connect a button to pin 18 (pullup enabled)')
    console.log('   Press button to control LED on pin 2')
    
    const esp32 = new ESP32Board()
    await esp32.connect()
    
    const led = new Led(2)
    const button = new Button({
      pin: 18,
      isPullup: true
    })
    
    button.on('press', () => {
      led.on()
      console.log('Button pressed - LED ON')
    })
    
    button.on('release', () => {
      led.off()
      console.log('Button released - LED OFF')
    })
    
    console.log('Listening for button presses... (Ctrl+C to exit)')
    
    // Keep alive
    process.on('SIGINT', () => {
      console.log('\n✓ Button + LED example stopped')
      esp32.disconnect()
      process.exit(0)
    })
  },

  async analogSensor() {
    console.log('📊 Starting analog sensor example...')
    console.log('   Connect a potentiometer or sensor to analog pin A0')
    
    const esp32 = new ESP32Board()
    await esp32.connect()
    
    const sensor = new Sensor({
      pin: 'A0',
      freq: 250  // Read every 250ms
    })
    
    const led = new Led(2)
    
    sensor.on('data', (value) => {
      // Map sensor value (0-1023) to LED brightness via PWM
      const brightness = Math.map(value, 0, 1023, 0, 255)
      led.brightness(brightness)
      console.log(`Sensor: ${value.toFixed(0)}, LED brightness: ${brightness.toFixed(0)}`)
    })
    
    console.log('Reading sensor values... (Ctrl+C to exit)')
    
    process.on('SIGINT', () => {
      console.log('\n✓ Analog sensor example stopped')
      esp32.disconnect()
      process.exit(0)
    })
  },

  async pwmLed() {
    console.log('🌈 Starting PWM LED fade example...')
    const esp32 = new ESP32Board()
    await esp32.connect()
    
    const led = new Led(2)
    
    // Smooth fade in and out
    const fade = () => {
      led.fadeIn(2000, () => {
        led.fadeOut(2000, fade)
      })
    }
    
    fade()
    
    // Run for 20 seconds
    setTimeout(() => {
      led.off()
      esp32.disconnect()
      console.log('✓ PWM fade complete')
      process.exit(0)
    }, 20000)
  }
}

// CLI interface
const command = process.argv[2]

if (!command || !examples[command]) {
  console.log(`Usage: node examples.js <command>

Available examples:
  blinkPattern  - Complex LED blink patterns
  multiLed      - Multiple LED Knight Rider sweep  
  buttonLed     - Button controls LED (needs button on pin 18)
  analogSensor  - Analog sensor controls LED brightness (needs sensor on A0)
  pwmLed        - Smooth PWM LED fading

Example: node examples.js blinkPattern`)
  process.exit(1)
}

// Run the selected example
examples[command]().catch(err => {
  console.error('Example failed:', err.message)
  process.exit(1)
})