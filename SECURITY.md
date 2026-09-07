# Security and privacy

## Data handling

HighLit reads eligible text in the configured root to anchor and render
highlights. Saving a highlight records its selected text, up to 32 characters
of preceding and following eligible text, offsets, colour/style, ID, pressure,
and creation time. The default location is `localStorage`, under `highlit:<pageKey>`.

The library has no telemetry, remote API, cookie, or network-upload implementation.
Its delete icon is embedded. A CDN installation downloads the script from that
CDN; a custom storage adapter can introduce additional network behaviour.

## Trust boundaries

- Local storage is plaintext and shared by scripts on the same origin. It is
  not an encrypted vault; page keys do not securely isolate users.
- Host-page XSS can read or modify HighLit records. HighLit cannot protect
  against code already running with the page's privileges.
- Restrict `root` and mark sensitive regions `data-highlit-ignore`. Surrounding
  context is stored too, not just the visibly highlighted words.
- Exclusions and overlay detection prevent accidental UI interference. They
  are not authorization controls.
- Records do not expire automatically. Define logout, retention, and deletion
  behaviour in the host application. `destroy()` preserves saved records;
  `clear()` clears only the current instance's page key.

## Untrusted configuration and stored data

Version 0.1.1 validates configured and restored colours with the browser's
colour parser, rejecting resource URLs, CSS indirection, escapes, and overlong
values. Invalid palette entries are dropped; an entirely invalid palette falls
back to built-in colours. Stored records with invalid colours are ignored.

**Published 0.1.0 does not contain this colour hardening.** Do not give it
untrusted colour strings or unvalidated remote highlight records. SVG paint
and CSS background values can accept resource URLs; arbitrary paint strings
are broader than actual colours.

Version 0.1.1 also excludes text hidden with CSS `display: none`,
`visibility: hidden/collapse`, or `content-visibility: hidden` from anchor context.
Version 0.1.0 excluded hidden attributes and ignored regions, but could include
CSS-hidden adjacent text. This is local storage exposure, not a network upload.
Existing records are not scrubbed retroactively; clear affected page records and
recreate highlights after updating. Restrict the root and mark sensitive content
explicitly: visual styling alone is never an access-control boundary.

Anchor fields are validated before rendering. Highlight text is not interpolated
into HTML; control markup is a fixed template. This is not a general-purpose
sanitizer. Custom adapters should bound the size and number of imported records:
very large collections can block rendering. There are no hard payload-size or
record-count limits today.

## Deployment

Pin dependencies and CDN versions, or self-host. Controls currently use an inline
style element, element styles, a static `innerHTML` template, and a data-URL SVG
icon. Strict Content Security Policy or Trusted Types enforcement may block
initialization or styling. Test your actual policy; do not broadly weaken it to
enable HighLit. Nonce/TrustedHTML integration is not exposed by the API today.

The npm package contains no runtime dependencies or install-time scripts.
Development tools have their own dependencies and audit surface. Audit both
the runtime and development tree before a release.

## Reporting a concern

Do not post credentials, private highlight text, or exploits against someone
else's site publicly. Use a minimal example with synthetic text and contact the
maintainer through a private channel you already have access to. The repository
is currently private; a public vulnerability-reporting channel is not configured.

## References

- [MDN: Web Storage and same-origin access](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [MDN: SVG/CSS fill accepts resource URLs](https://developer.mozilla.org/en-US/docs/Web/CSS/fill)
