import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'

const root = resolve(process.argv[2] ?? '.')
const require = createRequire(pathToFileURL(`${root}/package.json`))
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
for (const entry of Object.values(pkg.exports)) {
  const esm = await import(pathToFileURL(resolve(root, entry.import)))
  const cjs = require(resolve(root, entry.require))
  assert.equal(typeof esm.createHighlit, 'function')
  assert.equal(typeof cjs.createHighlit, 'function')
  assert.ok(readFileSync(resolve(root, entry.types)).length)
}

const dom = new JSDOM('<main>Keep these words.</main>', {
  url: 'https://highlit.example/article',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
})
try {
  const { window } = dom
  window.Range.prototype.getClientRects = () => [
    { x: 20, y: 30, left: 20, top: 30, right: 150, bottom: 52, width: 130, height: 22 },
  ]
  new Script(readFileSync(resolve(root, pkg.unpkg), 'utf8')).runInContext(dom.getInternalVMContext())
  const instance = window.HighLit.start()
  assert.equal(window.HighLit.start(), instance)
  instance.enable()
  const range = window.document.createRange()
  range.selectNodeContents(window.document.querySelector('main').firstChild)
  window.getSelection().addRange(range)
  window.document.dispatchEvent(new window.Event('pointerup'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(window.document.querySelector('svg[data-highlit-ui] path'))
  assert.match(window.localStorage.getItem('highlit:/article'), /Keep these words/)
  instance.clear()
  assert.equal(window.document.querySelector('svg[data-highlit-ui] path'), null)
  instance.destroy()
  assert.equal(window.document.querySelector('[data-highlit-ui]'), null)
  assert.equal(window.HighLit.start(), instance)
  assert.equal(window.document.querySelectorAll('[data-highlit-ui]').length, 2)
  instance.destroy()
} finally {
  dom.window.close()
}
console.log('Package checks passed: ESM, CommonJS, declarations, and standalone highlighting.')
