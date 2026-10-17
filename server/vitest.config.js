import { defineConfig } from 'vitest/config';

// Starting the in-memory Postgres (PGlite) can take over 10 s on a busy laptop.
export default defineConfig({
  test: { hookTimeout: 60000, testTimeout: 30000 },
});
