import * as esbuild from 'esbuild';

// Check if we're in watch mode
const watch = process.argv.includes('--watch');

// Common build options
const buildOptions = {
  entryPoints: ['src/main.mjs'],
  bundle: true,
  sourcemap: true,
  format: 'iife',
  outfile: 'public/bundle.mjs',
  platform: 'browser',
  target: 'es2015',  // Changed from specific browsers to ES2015 target which supports destructuring
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    'global': 'window',
  },
  minify: !watch,
  loader: {
    '.mjs': 'jsx'
  }
};

if (watch) {
  // Watch mode
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  // Single build
  await esbuild.build(buildOptions);
  console.log('Build complete');
}