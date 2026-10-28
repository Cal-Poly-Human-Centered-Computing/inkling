import { sveltekit } from '@sveltejs/kit/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    projects: [
      {
        // Plain logic, run in Node
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'node'
        }
      },
      {
        // Components and canvas code, run in a real browser (Fabric, Monaco and Vega need one)
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // the page is a two-column desktop layout
            viewport: { width: 1280, height: 800 },
            instances: [{ browser: 'firefox' }]
          }
        }
      }
    ]
  }
});
