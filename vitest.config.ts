import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			include: ['nodes/**/*.ts'],
			exclude: ['**/*.d.ts'],
		},
	},
});
