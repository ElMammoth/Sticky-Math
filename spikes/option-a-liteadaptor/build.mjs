import { build } from 'esbuild';
import path from 'path';

await build({
  entryPoints: ['entry.js'],
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  outfile: 'bundle.js',
  plugins: [{
    name: 'stub-mathjax-version',
    setup(b) {
      b.onResolve({ filter: /components\/version\.js$/ }, () => ({
        path: path.resolve('version-stub.js'),
      }));
    },
  }],
});
console.log('built');
