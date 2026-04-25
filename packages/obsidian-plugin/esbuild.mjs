import esbuild from 'esbuild'

const isProd = process.argv.includes('--prod')
const isWatch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', 'node:*', '@codemirror/state', '@codemirror/view'],
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: isProd ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
}

if (isWatch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('Watching for changes…')
} else {
  await esbuild.build(options)
}
