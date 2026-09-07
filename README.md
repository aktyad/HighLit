# HighLit

**Give readers a highlighter that feels like marking paper.**

HighLit adds a complete highlighting interaction to your website: select words,
choose a colour, and come back to them later. Soft, slightly irregular marker
strokes and a brief wet-to-dry effect make saved passages feel personal.

No framework required. No runtime dependencies. No account or backend needed.

```bash
npm install highlit-marker
```

## Why use HighLit?

For a blog, lesson, or reading app, highlighting gives readers a simple way to
keep passages they care about. HighLit supplies the interaction and visual
treatment together, so you do not have to build a picker, draw overlays, and
wire up local saving yourself.

| You need | HighLit provides |
| --- | --- |
| A ready-to-use reading interaction | Text selection, a six-colour picker, and click-to-delete controls |
| A natural marker appearance | Slightly uneven SVG strokes, pressure-sensitive direct marking, and wet-to-dry ink |
| Highlights that survive a reload | Local saving and text anchors that can recover from some markup changes |
| Straightforward integration | An npm API or one standalone script; no framework dependency |
| Respect for existing UI | Form/editor exclusions, modal suppression, and conservative checks for covered text |

HighLit is for **reader-selected passages**. It does not provide keyword search,
syntax highlighting, notes, collaboration, cloud sync, or a browser extension.

## Try it in a page

Put this near the end of your HTML, before `</body>`:

```html
<script src="https://cdn.jsdelivr.net/npm/highlit-marker@0.1.1/dist/auto.global.js"></script>
```

The script starts automatically once the page is ready. Select text, pick a
colour, then reload to see it restored. Click a highlight to reveal its remove
button. The URL is pinned to a version; for more deployment control, install
with npm or serve `dist/auto.global.js` from your own site.

## Integrate with your application

Initialize HighLit in the browser after the target element exists:

```html
<article id="article">
  <h1>A passage worth keeping</h1>
  <p>Select a few words in this article to highlight them.</p>
</article>
```

```ts
import { createHighlit } from 'highlit-marker'

const article = document.querySelector<HTMLElement>('#article')
if (!article) throw new Error('Article element not found')

const highlit = createHighlit({
  root: article,
  pageKey: 'article:introduction',
})

// When your application removes this view:
// highlit.destroy()
```

Prefer an explicit `root` to keep highlighting inside your reading content.
Using the standalone script and calling `createHighlit()` on the same page can
create duplicate instances; choose one initialization method.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `document.body` | Element containing the text readers can highlight |
| `pageKey` | `location.pathname` | Stable identity for saving and restoring this page's highlights |
| `colors` | Six built-in colours | Palette; the picker shows the first six entries |
| `styles` | `['chisel']` | First entry chooses `chisel`, `round`, or `brush`; there is no style picker |
| `storage` | `window.localStorage` | Synchronous adapter with `getItem(key)` and `setItem(key, value)` |

```ts
const highlit = createHighlit({
  root: article,
  pageKey: 'lesson:reading-01',
  colors: ['#f3cf4f', '#53c8e5', '#a178e4'],
  styles: ['chisel'],
})
```

Use literal CSS colours such as hex, named colours, `rgb()`, or `hsl()`. Treat
configuration and custom storage as trusted application inputs. Version 0.1.1
rejects resource URLs and CSS variable references in colours; upgrade from
`0.1.0` to receive this validation.

### Methods

| Method | Behaviour |
| --- | --- |
| `enable()` | Direct marking: completing a selection applies the first configured colour |
| `disable()` | Return to the normal select-then-choose-colour interaction |
| `clear()` | Remove this instance's saved highlights for its page key |
| `destroy()` | Remove UI, observers, and listeners; keep saved highlights |
| `mount()` | Mount a destroyed instance again; harmless if already mounted |

`disable()` does **not** turn off every interaction. Use `destroy()` when the
feature should disappear. Picking a colour in the normal picker does not change
the first configured colour used by direct marking.

## Common integrations

### Single-page and server-rendered applications

Call `createHighlit()` in your client-side mount lifecycle and `destroy()` in
cleanup. On a route change, destroy the old instance and create a new one with
the new article element and page key. HighLit does not track your router.

The default key ignores query strings and URL fragments. Give documents that
share a pathname distinct keys. For different signed-in users, include a
non-sensitive user identifier in the key and decide what to clear on logout.
A page key separates records; it is not an access-control mechanism.

### Exclude private or interactive regions

```html
<article id="article">
  <p>Readers can highlight this paragraph.</p>
  <section data-highlit-ignore>
    <p>Exclude this section from highlighting and anchoring.</p>
  </section>
</article>
```

HighLit already excludes common inputs, textareas, editable regions, links,
buttons, dialogs, popovers, inert/hidden regions, and several ARIA control roles.
Use `data-highlit-ignore` on custom editors, menus, and sensitive content too.

### Keep highlights only for the current session

```ts
const highlit = createHighlit({ root: article, storage: window.sessionStorage })
```

For no browser-storage persistence, use an in-memory adapter:

```ts
const memory = new Map<string, string>()
const highlit = createHighlit({
  root: article,
  storage: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value) },
  },
})
```

Adapters are synchronous; do not pass async functions or `fetch()` directly.
Built-in cross-tab updates apply to default local storage, not custom adapters.

## Appearance and motion

Short selections sweep on one line at a time, with slightly uneven movement.
Fresh ink starts richer, briefly holds, then settles into a softer colour. The
shape stays stable rather than wobbling on each animation frame.

Selections longer than three lines, or estimated to take more than five seconds
including drying, appear immediately. Reduced-motion preferences also skip the
effect. Saved highlights restore dry without replaying the animation.

## Saving and privacy

HighLit stores selected text, up to 32 characters of surrounding context on each
side, text offsets, colour/style, an ID, pressure, and creation time. The default
storage key is `highlit:<pageKey>`.

HighLit does not send highlight data to a server, use analytics, or set cookies.
A CDN installation still makes a normal request to download the script.

Local storage is **not encrypted or private from other scripts on your origin**.
Records persist until cleared or removed by the browser. They do not automatically
expire or sync between devices. If storage is blocked or full, marking continues
in memory, but changes may not survive reload.

Scope HighLit to appropriate reading content. Do not use it to store passwords,
credentials, or confidential records. See [Security and privacy](SECURITY.md).

## Limitations and troubleshooting

| Symptom | Check |
| --- | --- |
| No picker appears | Selection may be excluded, covered, or outside `root` |
| Ink disappears near an overlay or clipped edge | Covered lines are hidden conservatively, rather than always partially clipped |
| A modal hides all highlights | Intentional; highlights return when it closes |
| A saved highlight is missing | Check page key/storage; substantial edits or repeated text can make anchors unresolved or ambiguous |
| Highlighting stops after navigation | Recreate the instance after the new route mounts |
| Two pickers appear | Initialize once for the reading area |
| The test page does not run | Use a local HTTP server, not a `file://` URL |

The overlay uses stacking levels 1 for ink and 2 for controls. Complex stacking
contexts, transformed ancestors, unusual overlays, and moving content need host
application testing. Exclusion and occlusion checks are not security boundaries.
PDF/canvas text and nested shadow-root/iframe content are not supported by the
default document integration.

HighLit uses modern DOM Range, SVG, Shadow DOM, and storage APIs. It has been
exercised in the Codex in-app browser. Independent Safari, Firefox, physical
mobile-device, and assistive-technology testing remain outstanding; unit tests
alone do not establish compatibility.

## Development and verification

```bash
npm ci
npm test
npm run build
python3 -m http.server 5174 --bind 127.0.0.1
```

Open `http://127.0.0.1:5174/tests/browser.html` and click **Run browser checks**.
The browser checks use temporary in-memory data and do not change saved highlights.

`npm pack` runs type checking, tests, a clean minified build, and package checks
for ESM, CommonJS, declarations, and the standalone script. Source maps and
development dependencies are not included in the distributed package.

## License

MIT. See [LICENSE](LICENSE).
