const areas = ['access', 'team', 'scheduling', 'patients', 'integrations', 'sites'];

module.exports = {
	forbidden: [
		{
			name: 'no-circular-runtime-dependencies', severity: 'error',
			from: {}, to: { circular: true, dependencyTypesNot: ['type-only'] }
		},
		{
			name: 'browser-cannot-import-server', severity: 'error',
			from: { path: '(?:/lib/client/|\\.svelte$|/\\+(?:page|layout)\\.ts$)' },
			to: { path: '(?:/lib/server/|\\.server\\.[jt]s$)', dependencyTypesNot: ['type-only'] }
		},
		...areas.map(area => ({
			name: `public-interface-of-${area}`, severity: 'error',
			from: { pathNot: `^apps/web/src/lib/server/${area}/` },
			to: { path: `^apps/web/src/lib/server/${area}/`, pathNot: '/index\\.ts$' }
		}))
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		exclude: { path: '(?:^|/)(?:node_modules|\\.svelte-kit|build)/' },
		tsConfig: { fileName: require('node:path').resolve(__dirname, 'apps/web/tsconfig.json') },
		tsPreCompilationDeps: true,
		enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['svelte', 'import', 'node', 'default'] }
	}
};
