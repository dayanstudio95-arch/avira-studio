import { defineConfig } from 'vitest/config';

// Coverage (fix plan P88-b) runs with every `npm test` and fails under these floors: the first
// measurement (2026-09-30: statements 77.3, branches 66.9, functions 80.6, lines 81.0) minus 5.
// Raise them when coverage grows; never lower them to make a change pass.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['worker/**', 'shared/**'],
      reporter: ['text-summary'],
      thresholds: { statements: 72, branches: 61, functions: 75, lines: 75 },
    },
  },
});
