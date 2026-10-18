const areas = ['access', 'team', 'scheduling', 'patients', 'integrations', 'sites'];

module.exports = {
	forbidden: [
		{
			name: 'no-circular-dependencies', severity: 'error',
			from: {}, to: { circular: true }
		},
		{
			name: 'browser-cannot-import-server', severity: 'error',
			from: { path: '(?:^apps/web/src/lib/(?!server/)|\\.svelte$|/\\+(?:page|layout)\\.ts$)', pathNot: '\\.(?:test|office\\.test)\\.ts$' },
			to: { path: '(?:/lib/server/|\\.server\\.[jt]s$)' }
		},
		...areas.map(area => ({
			name: `public-interface-of-${area}`, severity: 'error',
			from: { pathNot: `^apps/web/src/lib/(?:server/)?${area}/` },
			to: { path: `^apps/web/src/lib/server/${area}/`, pathNot: `^apps/web/src/lib/server/${area}/public/[^/]+\\.ts$` }
		})),
		...areas.map(area => ({
			name: `shared-interface-of-${area}`, severity: 'error',
			from: { pathNot: `^apps/web/src/lib/(?:server/)?${area}/` },
			to: { path: `^apps/web/src/lib/${area}/internal/` }
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
