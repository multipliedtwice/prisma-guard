import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { 'generator/index': 'src/generator/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'runtime/index': 'src/runtime/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
  },
])