import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-browser-use'

/**
 * Browser platform modules the shell shares into the frozen module table —
 * the same seed list as dsh-session-ui-enhance, plus the conversation client
 * types are type-only and never reach this gate.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

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

const clientBundle: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  minify: true,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-browser-use-client-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source as (typeof CLIENT_EXTERNALS)[number])) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    inlineDynamicImports: true,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [hostBundle, clientBundle] satisfies UserConfig[]
