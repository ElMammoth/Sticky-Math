# ADR 0001: LaTeX to SVG rendering engine

Date: 2026-07-06
Status: accepted

## Context

Sticky Math has to render LaTeX to SVG exactly once, that single render serving both as the panel
preview and as the object inserted into InDesign. This is the project's WYSIWYG constraint: no second
engine may touch the expression between preview and insertion.

The UXP runtime is not a full browser. Two options were evaluated for running MathJax:

- **Option A**: mathjax-full with liteAdaptor, executed directly in the panel's JS, without a browser
  DOM.
- **Option B**: MathJax loaded into a UXP webview (a real Chromium environment), the render displayed
  in the webview, the SVG returned to the panel through `postMessage`.

## Spike results

### Option A (liteAdaptor, headless)

Spike kept in `spikes/option-a-liteadaptor/`.

- TeX to SVG rendering works without a DOM, baseline metrics included (`vertical-align` in `ex`).
- The esbuild bundle is 2.68 MB, with no Node dependency, IIFE format, executable as plain JS.
- Problem: `mathjax-full/js/components/version.js` contains `eval('require')`, and UXP forbids `eval`.
  It can be worked around with a stub at bundle time (proven in the spike), but it shows that
  mathjax-full is not designed for this runtime and that other surprises of the same kind are
  possible.
- **Blocking problem for WYSIWYG**: even with headless rendering working, the preview still has to be
  *displayed* in the panel. UXP's HTML/SVG engine is partial, an undocumented subset. The preview
  would therefore go through a third-party display engine, limited and different from anything the
  user sees elsewhere. That is a structural violation of the constraint.

### Option B (UXP webview)

- UXP v8 (InDesign 2026) allows local HTML from the plugin folder to be loaded into a webview
  (`allowLocalRendering: "yes"`, `plugin:/…` URL). Offline operation is guaranteed, with MathJax
  embedded in the plugin at `plugin/webview/vendor/tex-svg-full.js`.
- The message bridge works in both directions with `enableMessageBridge: "localAndRemote"`. The
  plugin-to-webview `postMessage` bug in InDesign 20.4 is officially fixed in InDesign 2026
  (v21.0.0.192 and later).
- `renderer.html` was tested end to end in Chromium, the same engine family as the UXP webview: ready
  handshake, render, extraction of the SVG and of the metrics (width, height, depth in `ex`, measured
  ex/em ratio), and the error path for invalid LaTeX.

## Decision

Option B: MathJax with SVG output inside a UXP webview.

Justification against the WYSIWYG constraint:

1. The displayed preview and the extracted SVG are literally the same DOM node. `renderer.js` inserts
   the result of `tex2svgPromise` into the page, which is the preview, then serializes that same
   element (`svg.outerHTML`) to send it to the panel. One render, one artifact.
2. The preview is displayed by a real Chromium engine, not by UXP's partial HTML engine. Preview
   fidelity is a browser's fidelity.
3. No network dependency: MathJax is vendored into the plugin.

Option A stays documented and its spike is kept: it could serve later for batch rendering, such as
re-exporting every formula in a document, where no preview is needed.

## Consequences and rules

- The SVG coming out of the webview is the canonical artifact. The only transformation allowed before
  writing to disk is rewriting the `width` and `height` attributes from `ex` to points. That is a unit
  conversion which modifies neither the `viewBox` nor the paths.
- `fontCache: "none"` is mandatory: every glyph becomes an inline path, with no `<defs>`/`<use>`, to
  maximize compatibility with InDesign's SVG importer.
- InDesign's native MathML rendering is not used for final output: it would be a second engine. See
  [`../environment.md`](../environment.md) for what that API allows; it is kept as a lead for a
  possible future opt-in editable-text mode.
- Accepted residual risk: InDesign's SVG importer is the last link in the chain. MathJax output in
  inline paths is very simple SVG (paths, `transform`, `viewBox`), so the risk of divergence is low,
  but it must be verified visually on the first test inside InDesign.
