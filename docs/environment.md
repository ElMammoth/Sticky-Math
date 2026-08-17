# Environment report

Date: 2026-07-06

## Context of this session

This work was done in a remote Linux container, with neither InDesign nor the UXP Developer Tool
installed. The exact versions on your machine therefore have to be recorded on your Mac, using the
procedure below. Everything that was verifiable outside the application was verified:

- headless MathJax rendering (option A spike) validated under Node 22;
- the webview render page validated end to end in Chromium (handshake, render, metrics, errors);
- the option A bundle validated as free of `eval` and of any Node dependency.

## Target versions (per Adobe documentation)

| Item | Value |
|---|---|
| InDesign | 2026, v21.x |
| UXP | v8 (local webview, `plugin:` protocol) |
| Manifest | version 5 |
| Manifest host id | `"ID"`, `minVersion` `"21.0.0"` |

Platform facts confirmed by Adobe documentation and forums:

- UXP v8 allows local HTML (the `plugin`, `plugin-data`, and `plugin-temp` folders) to be loaded into a
  webview through `requiredPermissions.webview.allowLocalRendering: "yes"`. Before UXP v8, only remote
  content was accepted.
- Bidirectional panel/webview communication requires `enableMessageBridge: "localOnly"` or
  `"localAndRemote"`. On the panel side: `webview.postMessage()` and the `message` event on the webview
  element. On the page side: `window.uxpHost.postMessage()` and the `message` event on `window`.
- Known bug: plugin-to-webview `postMessage` is broken in InDesign 20.4 and officially fixed in
  InDesign 2026 (v21.0.0.192 and later). Our v21 target is not affected, but check that your build is
  really 21.0.0.192 or newer.

## To record on your machine (5 minutes)

1. InDesign: **InDesign → About InDesign**, note the full version (expected 21.x, at least 21.0.0.192).
2. UXP Developer Tool: the **About** menu, note the UDT version and the UXP version it reports for
   InDesign once the plugin is loaded.
3. In the UDT console for the loaded plugin, run `require("uxp").versions` and note the result, which
   is the runtime's exact UXP version.
4. Check that the Sticky Math panel loads and that the preview appears. See
   [`installation.md`](installation.md) for the loading procedure.

## Testing the webview page outside InDesign

`plugin/webview/renderer.html` can be opened in Chromium directly, which is how the render path was
validated. Two things are needed to stand in for the UXP host:

- a stub for `window.uxpHost` exposing a `postMessage` function, which collects what the page would
  send back to the panel;
- simulated `message` events on `window` carrying the JSON strings the panel would send
  (`{"type":"render","tex":"…"}`).

Driven through Playwright, this covers the ready handshake, rendering, extraction of the SVG and its
metrics, and the invalid-LaTeX error path. It does not cover anything on the InDesign side.

## InDesign's native math API (MathML by script)

InDesign 20 (2025) introduced native MathML support. A piquant detail: InDesign's internal rendering
engine for those objects is itself MathJax (source: Indiscripts, "InDesign 20 Goes to MathML", March
2025).

What the scripting API allows (ExtendScript and UXP):

- `Document.createFromMathML(mml, page, layer, [x, y])`: creates and places a MathObject from a MathML
  string.
- `Rectangle.mathObjects.add(mml, …)`: documented but inconsistent in practice, as the object does not
  parent itself correctly to the target rectangle according to Indiscripts.
- MathObject properties: `mathmlDescription` (the MathML source), `appliedMathMLFontSize` (in points),
  `appliedMathMLSwatch`, `appliedMathMLRgbColor`, `tintValue`.
- The Document exposes `mathObjects` (a collection) and defaults (`appliedMathMLFontSize`, and so on).

Known limitations:

- Very slow API, because of the complex data flow between the InDesign DOM and the UXP layer. Bulk
  operations of the `everyItem()` kind can cause fatal errors.
- No access to the underlying SVG InDesign generates.
- No access to transformations; rotation by script is impossible.
- The container has to remain a Rectangle, otherwise `mathObjects` access breaks and export becomes
  unreliable.

Conclusion for Sticky Math: this API confirms that an opt-in "editable text" mode through native
MathML is technically possible, converting LaTeX to MathML and then calling `createFromMathML`, but it
would introduce a render we neither control nor see in the preview. It stays off the default path, in
line with the WYSIWYG constraint. The lead is kept in [`roadmap.md`](roadmap.md).

## Sources

- https://developer.adobe.com/indesign/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/indesign/uxp/reference/uxp-api/reference-js/Global%20Members/HTML%20Elements/HTMLWebViewElement/
  (Photoshop mirror: https://adobedocs.github.io/uxp-photoshop/uxp-api/reference-js/Global%20Members/HTML%20Elements/HTMLWebViewElement/)
- https://indesign.uservoice.com/forums/913162-adobe-indesign-sdk-scripting-bugs-and-features/suggestions/50184291-uxp-indesign-webview-postmessage-does-not-work-i
- https://indiscripts.com/post/2025/03/indesign-20-goes-to-mathml-2
