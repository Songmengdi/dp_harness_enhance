import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-browser-use'

/** Host bundle: tsc already emitted lib/types/index.js; bundle it to lib/index.js. */
const hostBundle: UserConfig = {
  name: PLUGIN_ID,
  entry: {
    index: 'lib/types/index.js',
    'mcp/server': 'lib/types/mcp/server.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default [hostBundle] satisfies UserConfig[]
