/* eslint-disable */
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['test/**/*.test.ts'],
		testTimeout: 10000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			include: ['nodes/**/*.ts'],
			exclude: ['**/*.d.ts', 'test/**'],
		},
	},
});
