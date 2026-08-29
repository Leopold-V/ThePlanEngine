import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@sim': resolve('src/sim'),
      '@engine': resolve('src/engine')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
