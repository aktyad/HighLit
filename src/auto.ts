import { createHighlit, HighLit } from './index'

let instance: HighLit | undefined

export function start(): HighLit {
  return instance ??= createHighlit()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}

export { createHighlit, HighLit }
