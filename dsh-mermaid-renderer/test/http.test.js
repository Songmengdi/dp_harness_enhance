import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config as ConfigSchema, clientConfigOf } from '../lib/config.js'
import { handleClientConfig, handleRender } from '../lib/host/http.js'

/** 极简 ServerResponse 假件:捕获 writeHead/end。 */
function fakeRes() {
  return {
    headersSent: false,
    status: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
      this.headersSent = true
    },
    end(body) {
      this.body = body
    },
  }
}

const config = ConfigSchema({})

test('handleClientConfig: GET 下发客户端配置子集,no-store', () => {
  const res = fakeRes()
  handleClientConfig({ method: 'GET' }, res, config)
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), clientConfigOf(config))
  // 客户端子集不得携带 host 侧字段
  assert.equal('krokiBaseUrl' in JSON.parse(res.body), false)
})

test('handleClientConfig: HEAD 同样放行', () => {
  const res = fakeRes()
  handleClientConfig({ method: 'HEAD' }, res, config)
  assert.equal(res.status, 200)
})

test('handleClientConfig: 非 GET/HEAD → 405 带 Allow 头', () => {
  const res = fakeRes()
  handleClientConfig({ method: 'POST' }, res, config)
  assert.equal(res.status, 405)
  assert.equal(res.headers.allow, 'GET, HEAD')
})

test('handleRender: 非 POST → 405 带 Allow 头(不触网)', async () => {
  const res = fakeRes()
  await handleRender({ method: 'GET' }, res, config)
  assert.equal(res.status, 405)
  assert.equal(res.headers.allow, 'POST')
})

test('handleRender: 请求体超限 → 413(不触网)', async () => {
  const { Readable } = await import('node:stream')
  const big = '{"diagram_source":"' + 'x'.repeat(config.maxBodyBytes) + '"}'
  const req = Readable.from([big])
  req.method = 'POST'
  req.setEncoding = () => {}
  const res = fakeRes()
  await handleRender(req, res, config)
  assert.equal(res.status, 413)
})

test('handleRender: 非法 JSON → 400(不触网)', async () => {
  const { Readable } = await import('node:stream')
  const req = Readable.from(['{nope'])
  req.method = 'POST'
  req.setEncoding = () => {}
  const res = fakeRes()
  await handleRender(req, res, config)
  assert.equal(res.status, 400)
})
