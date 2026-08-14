import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config as ConfigSchema, clientConfigOf } from '../lib/types/config.js'
import { handleClientConfig } from '../lib/types/host/http.js'

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

test('handleClientConfig: GET 下发客户端配置,no-store', () => {
  const res = fakeRes()
  handleClientConfig({ method: 'GET' }, res, config)
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), clientConfigOf(config))
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
