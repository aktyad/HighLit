# Changelog

## 0.1.1

- Exclude CSS-hidden text from saved surrounding context.
- Reject resource URLs and CSS indirection in configured and restored colours.
- Update development tooling to a patched esbuild version.
- Expand setup, API, privacy, integration, and troubleshooting documentation.
- Remove the demo folder; retain the isolated browser regression page.

## 0.1.0

Initial release of HighLit, a zero-runtime-dependency text highlighter.

- Circular colour picker and organic SVG marker strokes.
- Animated application and wet-to-dry ink for short selections; long selections appear immediately.
- Local persistence, custom storage, text anchoring, and highlight removal.
- Form and editor exclusions, modal suppression, and conservative overlay/scroll clipping.
- ESM, CommonJS, TypeScript declarations, and a standalone browser script.
- Reduced-motion support and graceful handling of unavailable storage.

Complex stacking contexts and custom overlays need integration testing. This
release has been tested in the Codex browser; separate Firefox, Safari, and
physical mobile-device testing is still outstanding.
