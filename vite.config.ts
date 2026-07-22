import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

function buildInfo() {
  // Version is the commit count, so it increments on every release without
  // manual bumps. Falls back gracefully outside a git checkout (e.g. CI tarball).
  let sha = 'dev'
  let version = 0
  try {
    sha = execSync('git rev-parse --short HEAD').toString().trim()
    version = Number(execSync('git rev-list --count HEAD').toString().trim())
  } catch {
    // keep fallbacks
  }
  return { version, sha, builtAt: new Date().toISOString() }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: true })],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
