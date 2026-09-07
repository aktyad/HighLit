import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/auto.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    minify: true,
    clean: false,
    loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  },
  {
    entry: { auto: 'src/auto.ts' },
    format: ['iife'],
    globalName: 'HighLit',
    minify: true,
    clean: false,
    loader: { '.svg': 'dataurl', '.png': 'dataurl' },
    outExtension: () => ({ js: '.global.js' }),
  },
])
