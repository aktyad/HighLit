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
<script src="https://cdn.jsdelivr.net/npm/highlit-marker@0.1.0/dist/auto.global.js"></script>
```

Select text normally, then choose a colour from the floating toolbar. Highlights
are stored locally in the visitor's `localStorage` and restored on reload.
HighLit sends no highlight data to a server. Other scripts on the same origin
can access that browser storage.

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
Call `createHighlit()` after the page body exists. In server-rendered applications,
initialize it on the client and call `destroy()` when its view unmounts.
Selecting text opens a compact colour picker; choosing a colour applies the highlight immediately.
`enable()` switches to direct marking on selection; `disable()` returns to the
normal colour-picker interaction. Use `destroy()` to remove all HighLit UI and
listeners; saved highlights remain available when mounted again.
The first entry in `styles` chooses the marker tip (`chisel`, `round`, or `brush`).
Pass any browser-compatible `Storage` implementation with the `storage` option
if the host application needs different persistence.
Add `data-highlit-ignore` to any application-specific region that should never offer highlighting.

Highlights stay in the current browser and do not sync between devices. When
browser storage is blocked or full, highlighting still works for the current
session, but changes cannot be saved. Reduced-motion preferences disable the
stroke reveal animation.
Selections of more than three lines, or whose full sweep-and-dry animation
would exceed five seconds, appear immediately in their settled colour.

Form controls, links, editable content, dialogs, popovers, and inert or hidden
regions are excluded. Visible modals temporarily hide HighLit. Covered text
lines are conservatively hidden and restored when the covering UI moves away.
For custom overlays or editors, mark their container `data-highlit-ignore`.
HighLit uses low stacking levels (ink: 1, controls: 2); complex stacking contexts
and unusual overlays should be checked in the host application.

## Development

```bash
npm install
npm test
npm run build
```

Open `demo/index.html` through a local web server after building.
Open `tests/browser.html` through the same server and click **Run browser checks**
to verify real layout, form exclusions, overlays, native dialogs/popovers,
scroll clipping, persistence, and cleanup. These checks use temporary in-memory
storage and do not change your saved demo highlights. Run this page in each
target browser; the DOM-based unit tests do not replace browser testing.

`npm pack` runs type checking, tests, and a clean production build before
packaging. Published JavaScript is minified; source maps are omitted to keep
the download small.

## Browser support

HighLit uses standard DOM Range, SVG, Shadow DOM, and localStorage APIs. It is
intended for current versions of Chrome, Edge, Firefox, and Safari.

## License

MIT
