/// <reference types="vite/client" />

// Injected at build time from vite.config.ts.
declare const __BUILD_INFO__: {
  /** Commit count at build time — increments automatically on every release. */
  version: number
  /** Short git SHA of the deployed commit. */
  sha: string
  /** ISO timestamp of when the bundle was built. */
  builtAt: string
}
