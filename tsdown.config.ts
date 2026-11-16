import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

const shared = ['react', 'react-dom', 'react/jsx-runtime', '@dsh-plugin/dsh-loader/client'];
export default defineConfig({
  entry: { client: './src/client/index.tsx' }, outDir: './lib', format: 'cjs', platform: 'browser',
  target: 'es2022', dts: false, sourcemap: true, clean: false,
  deps: { neverBundle: shared, alwaysBundle: [/^(?!react(?:-dom)?(?:\/|$)|@dsh-plugin\/dsh-loader\/client$)/] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });', codeSplitting: false,
  },
});
