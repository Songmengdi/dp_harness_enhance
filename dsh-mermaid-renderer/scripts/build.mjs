/**
 * dsh-mermaid-renderer 构建脚本(两个 tsc program + esbuild 客户端打包)。
 *
 * 1. host 半边:tsc(NodeNext,ESM)→ lib/index.js + lib/shared/* + lib/host/*,
 *    附带 .d.ts 与 sourcemap。
 * 2. client 半边:esbuild 把 src/client.ts(+ shared 纯函数)打成单文件 CJS,
 *    react / react-dom/client 保持 external(运行时由 web shell 的平台模块表
 *    提供);用 esbuild banner/footer 包成 `window.__ModuleLoader__.load(...)`
 *    工厂形式(与官方 client bundle 相同的惰性 CJS 装载契约)——banner/footer
 *    参与 sourcemap 生成,inline map 落在文件真实末尾且行映射不漂移(手写
 *    模板包裹会把 sourceMappingURL 注释埋进文件中段,浏览器不识别)。
 *
 * 产物契约:lib/index.js(lib/index.d.ts)与 lib/client.js 必须真实存在,
 * 与 package.json 的 exports/files 一致。
 */
import { execSync } from 'node:child_process'
import { rmSync, statSync } from 'node:fs'
import { build } from 'esbuild'

const CLIENT_ID = 'dsh-mermaid-renderer'

rmSync('lib', { recursive: true, force: true })

execSync('npx tsc -p tsconfig.host.json', { stdio: 'inherit' })

await build({
  entryPoints: ['src/client.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['react', 'react-dom/client'],
  outfile: 'lib/client.js',
  sourcemap: 'inline',
  banner: {
    js: `window.__ModuleLoader__.load({
  id: ${JSON.stringify(CLIENT_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;`,
  },
  footer: {
    js: `    return module.exports;
  },
});`,
  },
  logLevel: 'warning',
})

console.log(`[build] host → lib/index.js; client → lib/client.js (${statSync('lib/client.js').size} bytes)`)
