/** One rule per row of the package layout table in docs/engineering/stack-decisions.md. */
const layout = [
  { path: 'packages/contracts', mayImport: [] },
  { path: 'packages/domain', mayImport: ['packages/contracts'] },
  { path: 'packages/api-client', mayImport: ['packages/contracts'] },
  { path: 'apps/api', mayImport: ['packages/contracts', 'packages/domain'] },
  { path: 'apps/web', mayImport: ['packages/contracts', 'packages/domain', 'packages/api-client'] },
  { path: 'apps/runner', mayImport: ['packages/contracts', 'packages/domain'] },
];

function packageName(dir) {
  return dir.startsWith('packages/') ? `@plangineer/${dir.slice('packages/'.length)}` : dir;
}

function layoutComment({ path: dir, mayImport }) {
  const allowed =
    mayImport.length === 0 ? 'no workspace package' : mayImport.map(packageName).join(' and ');
  return `${packageName(dir)} may import only ${allowed}. Move this code to the app that needs it.`;
}

function layoutRule(entry) {
  const own = [entry.path, ...entry.mayImport].join('|');
  return {
    name: `layout-${entry.path.replace('/', '-')}`,
    comment: layoutComment(entry),
    severity: 'error',
    from: { path: `^${entry.path}/` },
    to: { path: '^(packages|apps)/', pathNot: `^(${own})/` },
  };
}

module.exports = {
  forbidden: [
    ...layout.map(layoutRule),
    {
      name: 'no-circular',
      comment: 'Break the cycle by moving the shared code into the module both sides import.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-relative-import-into-another-package',
      comment:
        'Import another workspace package through its name, such as @plangineer/contracts, never through a relative path into its files.',
      severity: 'error',
      from: { path: '^(packages|apps)/([^/]+)/' },
      to: { dependencyTypes: ['local'], path: '^(packages|apps)/', pathNot: '^$1/$2/' },
    },
  ],
  options: {
    parser: 'swc',
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['apps/web/src/routeTree[.]gen[.]ts$', 'apps/api/drizzle/', 'apps/web/dist/'],
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs'],
    },
  },
};
