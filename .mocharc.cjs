process.env.TS_NODE_PROJECT = 'tsconfig.test.json';

module.exports = {
	require: ['ts-node/register'],
	extensions: ['ts'],
	spec: 'test/**/*.test.ts',
	recursive: true,
	reporter: 'spec',
	timeout: 10000,
};
