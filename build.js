import * as esbuild from 'esbuild';
import cssModulesPlugin from 'esbuild-plugin-css-modules';

// Common build options
const commonOptions = {
  bundle: true,
  sourcemap: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2015',
  minify: !process.argv.includes('--watch'),
};

// JavaScript build configuration
const jsBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/main.mjs'],
  outfile: 'public/bundle.mjs',
  loader: {
    '.mjs': 'jsx'
  },
  define: {
    'process.env.NODE_ENV': process.argv.includes('--watch') ? '"development"' : '"production"',
    'global': 'window',
  },
};

// CSS build configuration
const cssBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/styles/index.css'],
  outfile: 'public/bundle.css',
  plugins: [cssModulesPlugin()],
};

async function build() {
  try {
    if (process.argv.includes('--watch')) {
      // Watch mode
      const jsContext = await esbuild.context(jsBuildOptions);
      const cssContext = await esbuild.context(cssBuildOptions);
      
      await Promise.all([
        jsContext.watch(),
        cssContext.watch()
      ]);
      
      console.log('Watching for changes...');
    } else {
      // Single build
      await Promise.all([
        esbuild.build(jsBuildOptions),
        esbuild.build(cssBuildOptions)
      ]);
      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();