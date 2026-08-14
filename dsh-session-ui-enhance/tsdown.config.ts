/**
 * Build faces for dsh-session-ui-enhance.
 *
 * Node half (lib/index.js): bundled from lib/types/index.js, the tsc output
 * of tsconfig.host.json.
 *
 * Client half (lib/client.js): the browser plugin bundle, emitted with the
 * official dsh client-loader handoff — `window.__ModuleLoader__.load({ id,
 * factory })` — a self-contained port of the upstream preset
 * `packages/client/tsdown.client.ts` (deepseek-harness @ 47f9438), trimmed to
 * what a single standalone plugin needs:
 *
 * - Platform modules (react, the shell's shared UI packages, …) stay
 *   external: the frozen loader module table answers their require calls at
 *   runtime. Everything else inlines.
 * - CSS Modules compile through lightningcss inside the bundle; the css text
 *   auto-injects one <style data-plugin="dsh-session-ui-enhance"> tag at factory
 *   execution, and the loader removes plugin-owned tags on unload.
 * - The purity gate mirrors the runtime edge rules: any @deepseek-ai value
 *   import outside the platform table is a build error.
 *
 * @module dsh-session-ui-enhance/tsdown.config
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const ID = 'dsh-session-ui-enhance'

/**
 * Browser platform modules the shell shares into the frozen module table —
 * the exact seed list of packages/client/web/src/platform.ts upstream.
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Externals resolved from the loader module table: the platform seeds plus the runtime store exemption. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

// Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline:
// the suffix must not end in `.css`, or tsdown's guard intercepts it.
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

function clientConfig(): UserConfig {
  return {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    // Browser bundle lands next to the node half (single lib/ artifact dir);
    // clean stays off so the client pass never wipes the node-half output.
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    // mermaid 全量注册表体积大,压缩后约 1/3;loader 对内容透明。
    minify: true,
    deps: {
      // Loader module table entries stay external (neverBundle wins over the
      // auto-externalization and over the alwaysBundle rule below).
      neverBundle: [...CLIENT_EXTERNALS],
      // Anything NOT in the loader module table must inline instead — a
      // require() the table cannot answer is a guaranteed runtime throw.
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    // tsdown auto-externalizes package dependencies (peers here); anything
    // NOT in the loader module table must inline instead — a require() the
    // table cannot answer is a guaranteed runtime throw.
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules):
      // platform seed entries stay external, everything else under
      // @deepseek-ai is a build error — cross-plugin value imports are
      // forbidden; collaborate through cordis services instead (type-only
      // imports are erased and never reach this gate).
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        const isModule = source.endsWith('.module.css')
        // Plain .css (global, non-module) stylesheets take the same inline
        // path, minus class hashing: they inject as-is and export nothing.
        const isPlain = !isModule && source.endsWith('.css')
        if (!isModule && !isPlain) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + (isModule ? CSS_VIRTUAL_SUFFIX : '.plain' + CSS_VIRTUAL_SUFFIX)
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const plain = virtualId.endsWith('.plain' + CSS_VIRTUAL_SUFFIX)
        const fileId = virtualId.slice(
          CSS_VIRTUAL_PREFIX.length,
          plain ? -('.plain' + CSS_VIRTUAL_SUFFIX).length : -CSS_VIRTUAL_SUFFIX.length,
        )
        // The virtual id otherwise hides the physical stylesheet from the watch graph.
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: plain ? false : { pattern: '[hash]_[local]' },
          minify: true,
        })
        // Iterate sorted keys: lightningcss emits `exports` with hash-map key
        // order, which would otherwise make every build byte-different and
        // break the byte-consistency verification of published bundles.
        const classMap: Record<string, string> = {}
        const exportsMap = cssExports ?? {}
        for (const local of Object.keys(exportsMap).sort()) classMap[local] = exportsMap[local].name
        // One <style data-plugin> per module file; idempotent under re-evaluation.
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // mermaid 的图类型按需动态 import;client bundle 契约是单文件
      // (loader 只取 client.js),动态分块必须全部内联回入口。
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  {
    name: ID,
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  clientConfig(),
]
