import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@golive/core'] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { resolve: { alias: { '@golive/core': resolve(__dirname, '../../packages/core/src/index.ts') } }, plugins: [react()] }
})
