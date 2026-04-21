// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency used only for tests
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
