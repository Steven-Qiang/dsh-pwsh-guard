import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/rules.ts'],
  format: 'esm',
  target: 'node18',
  dts: true,
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
