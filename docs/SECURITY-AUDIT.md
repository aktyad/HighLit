# HighLit security review

Date: 2026-09-07. Baseline: published `highlit-marker@0.1.0`, Git commit
`e6fee49f7c8620931150c8d5ac366d1bc04a5c1d`. Fixes below are included in version
0.1.1; they are not present in the audited 0.1.0 archive.

## Scope and conclusion

Reviewed runtime source, text anchoring, rendering sinks, local storage,
configuration, package contents, reachable Git history, and dependency advisories.
This is a focused code review with regression tests, not an independent penetration
test or proof that the library has no vulnerabilities.

No intentional highlight-data transmission, telemetry, cookie handling, or
credential-like matches were found. The review identified two runtime hardening
issues and one development dependency advisory, addressed locally below.

## Findings

### CSS-hidden text could be saved as context

Risk: local privacy exposure when a selected passage is adjacent to hidden,
sensitive text inside the configured root. Anchor creation saves up to 32
characters on either side. Previously, CSS-only visibility did not exclude that
text; hidden attributes and explicitly ignored regions were excluded.

Fix: the eligibility check now excludes `display: none`, `visibility:
hidden/collapse`, and `content-visibility: hidden` ancestors. Anchor collection
uses this shared check and caches per-parent eligibility during each traversal.
Tests cover hidden surrounding content and direct hidden selection.

Limits: existing stored context is not retroactively erased. Clear affected page
keys and recreate highlights after updating. A same-origin script can already
read the original DOM; this issue unnecessarily copied hidden text into longer-lived
storage rather than granting a new cross-origin read capability.

### Colour inputs accepted broader CSS paint syntax

Risk: application-supplied or imported colours could contain resource URLs or
CSS variable references. Palette backgrounds and SVG paint attributes accept
more than just colours, potentially causing unintended resource requests. This
review did not demonstrate automatic exfiltration of selected text or script
execution through this path.

Fix: validate colours with the browser's colour parser, rejecting URL/variable/
environment/attribute indirection, escapes, and values longer than 256 characters.
The same check covers options and restored records. Invalid entries are ignored;
an entirely invalid palette uses the defaults. Regression tests exercise hostile
paint strings and valid hex/named/RGB colours.

### Development-only esbuild advisory

The audit initially found one low-severity advisory in esbuild 0.27.7:
[GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr), concerning
file reads when its development server runs on Windows. HighLit has no runtime
dependencies and does not ship esbuild to consumers.

A normal compatible audit fix did not resolve it. Added an esbuild `^0.28.1`
override and refreshed the lockfile. The patched build passes type checking,
tests, and package checks. A fresh dependency audit reports zero known advisories.

## Data and injection review

- Selected text, prefix/suffix context, offsets, ID, colour/style, pressure, and
  creation time are stored as JSON; page identity appears in the storage key.
- Storage is plaintext, origin-scoped, and persistent. There is no encryption,
  automatic expiration, authenticated-user isolation, or automatic logout cleanup.
- The `innerHTML` control template is static. Selected/stored text is not
  interpolated into markup. IDs used for SVG references are derived through hashing.
- No network-upload or analytics API was found in the runtime. CDN downloads and
  application-provided storage adapters are separate network surfaces.
- CSS occlusion and interaction exclusions are not security controls.

## Package and credential inspection

Inspected the 14-file archive published as 0.1.0, SHA-1
`9369de8e8301272eac0c7f60f95e7c4af4421c1f`. No `.git`, `.env`, `.npmrc`, or
`node_modules` paths were present. It contains no runtime dependencies or
install-time lifecycle scripts.

Scanned that archive and all reachable Git revisions for common private-key,
GitHub token, npm token, and AWS access-key patterns. No matches were found.
Pattern scans do not detect every password, custom secret format, deleted
unreachable object, or secret outside this repository. User credential stores
were not printed or inspected.

## Remaining boundaries

- Large custom-storage payloads and many highlights have no hard size/count
  limits; synchronous parsing and rendering can stall the page.
- Strict CSP and Trusted Types configurations may reject inline styles or the
  static HTML template. Do not weaken host policies without an integration review.
- Browser-specific behaviour, unusual overlays, CSS-only hiding techniques beyond
  those explicitly checked, and assistive-technology support need further testing.
- The GitHub repository remains private, so npm repository/support links are not
  useful to unauthenticated readers. A publicly accessible confidential-reporting channel is not
  configured; the maintainer should choose a contact channel before promoting it.

## Release status

Validation: 38 automated tests and 14 real-browser scenarios pass, including
hostile colour inputs and CSS-hidden context. All four TypeScript documentation
examples compile. Type checking, the minified build, ESM/CommonJS and standalone
package checks, and a fresh full dependency audit pass. These browser checks
were run in the Codex in-app browser, not across all supported browser engines.

The documentation and fixes are included in version 0.1.1. npm 0.1.0 remains
unchanged; consumers must update to receive the fixes.
