# HighLit

A tiny, human-feeling text highlighter for any web page. Zero runtime dependencies.

## Install

```bash
npm install highlit-marker
```

```ts
import { createHighlit } from 'highlit-marker'

const highlit = createHighlit()
```

Or add one script tag—HighLit starts automatically:

```html
<script src="https://cdn.jsdelivr.net/npm/highlit-marker"></script>
```

Select text normally, then choose a colour from the floating toolbar. Highlights
are stored privately in the visitor's `localStorage` and restored on reload.

## Options

```ts
const highlit = createHighlit({
  pageKey: '/article/my-stable-id',
  colors: ['#ff7bc3', '#55bed8'],
})

highlit.enable()
highlit.disable()
highlit.clear()
highlit.destroy()
```

`pageKey` defaults to `location.pathname`, so each page keeps its own highlights.
Pass any browser-compatible `Storage` implementation with the `storage` option
if the host application needs different persistence.

## Development

```bash
npm install
npm test
npm run build
```

Open `demo/index.html` through a local web server after building.

## Browser support

HighLit uses standard DOM Range, SVG, Shadow DOM, and localStorage APIs. It is
intended for current versions of Chrome, Edge, Firefox, and Safari.

## License

MIT
