import { config } from '@n8n/node-cli/eslint';

// ESLint 10 removed the deprecated `context.getFilename()` and related methods
// in favor of direct properties like `context.filename`. `eslint-plugin-n8n-nodes-base`
// (bundled with @n8n/node-cli) still uses the old API, so shim the legacy
// methods back onto the rule context until upstream catches up.
const shimContext = (context) =>
	new Proxy(context, {
		get(target, prop, receiver) {
			switch (prop) {
				case 'getFilename':
					return () => target.filename;
				case 'getPhysicalFilename':
					return () => target.physicalFilename;
				case 'getSourceCode':
					return () => target.sourceCode;
				case 'getCwd':
					return () => target.cwd;
				case 'getScope':
					return () => target.sourceCode.getScope(target.sourceCode.ast);
				case 'getAncestors':
					return () => target.sourceCode.getAncestors(target.sourceCode.ast);
				default:
					return Reflect.get(target, prop, receiver);
			}
		},
	});

for (const entry of config) {
	const plugin = entry?.plugins?.['n8n-nodes-base'];
	if (!plugin?.rules) continue;
	for (const rule of Object.values(plugin.rules)) {
		if (typeof rule?.create !== 'function' || rule.__eslint10ContextShimmed) continue;
		const originalCreate = rule.create;
		rule.create = function shimmedCreate(context, ...args) {
			return originalCreate.call(this, shimContext(context), ...args);
		};
		rule.__eslint10ContextShimmed = true;
	}
}

export default config;
