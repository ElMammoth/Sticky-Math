# Sticky Math

UXP plugin for Adobe InDesign 2026 (v21.x, UXP v8, macOS): write LaTeX in a panel, preview it live, insert the formula into the text at the cursor position, as an inline anchored object sitting on the baseline.

## Non-negotiable constraint: strict WYSIWYG

What the preview displays is exactly what gets inserted, down to the vector.

Rules that follow from it, never to be broken:

1. LaTeX is rendered ONCE ONLY, to SVG, by MathJax in the webview (`plugin/webview/renderer.js`). The preview is that DOM node; the inserted SVG is the serialization of that same node.
2. No second rendering engine touches the expression. In particular, InDesign's native MathML rendering is NOT used for final output (see docs/environment.md for what that API allows; it is reserved for a possible future opt-in editable-text mode).
3. The only transformation allowed on the SVG before placement: rewriting the `width` and `height` attributes (ex to pt) in `plugin/main.js`. Unit conversion only, never a change to the viewBox or to the paths.
4. `fontCache: "none"` is mandatory on the MathJax side: math glyphs as inline paths, no `<defs>/<use>`, for compatibility with InDesign's SVG importer. Accepted nuance: `\text{}` segments (and any character missing from the TeX fonts, accents included) come out as SVG `<text>` elements; the panel's "text font" option (MathJax's `mtextFont`, changeable on the fly) applies a user-chosen family to them, which must exist on the InDesign side. The fidelity of those `<text>` elements through the InDesign import has to be verified visually.
5. The preview's adjustment CSS must target ONLY the root SVG (`#preview mjx-container > svg`): stretchy characters (the braces of `\underbrace`, large delimiters) are assemblies of nested `<svg>` elements with explicit dimensions, which a global `height: auto` dislocates.
6. The LaTeX source, point size, scale, and depth are stored separately (a JSON label on the placed object) for re-editing; the visual remains the SVG that came out of the preview.

## Architecture

Decision recorded in docs/adr/0001-rendering-engine.md: MathJax with SVG output in a UXP webview (option B). Option A (headless mathjax-full in the panel) is rejected for the preview; its spike is kept in `spikes/option-a-liteadaptor/`.

Flow: LaTeX typed in the panel, postMessage to the webview, MathJax render displayed (the preview), the serialized SVG plus metrics (widthEx, heightEx, depthEx, exEm) returned to the panel, dimensions rewritten in pt, the SVG file written to the active destination, InDesign placement.

SVG destination: the plugin's temporary folder by default, or a folder chosen by the user (`localFileSystem: "request"`, `getFolder` picker). Access to a chosen folder is kept across sessions through a UXP persistent token (`createPersistentToken` / `getEntryForPersistentToken`) stored in localStorage alongside the display path. The folder is re-read on every insertion (a destination change takes effect immediately) and the plugin never deletes files there.

InDesign placement (`plugin/lib/indesign.js`):

- absolute reliability rule: no InDesign DOM reference may cross an `await` (an invalidated reference can crash the application natively); the insertion point is resolved at call time, after the file has been written, and the whole sequence is synchronous;
- the sequence runs inside `app.doScript(..., UndoModes.ENTIRE_SCRIPT)`: one transaction, a single undo step (falling back to direct execution if doScript refuses a function);
- `insertionPoint.rectangles.add()` creates the inline anchored rectangle, then `rect.place(svgPath)` and `fit(FRAME_TO_CONTENT)`;
- baseline: `anchoredObjectSettings.anchorYoffset = -depthPt` where depthPt comes from the MathJax `vertical-align` (depth below the baseline); the sign is to be confirmed visually on the first try in InDesign;
- tables: a cell in overset hides all of its content (the cause of "vanished" formulas); if insertion happens in an overset cell and the row does not grow, `row.autoGrow` is enabled in the same transaction and announced in the status line; if the overset persists, a warning is shown;
- units forced to points via `app.scriptPreferences.measurementUnit` (restored in a finally);
- label: `rect.label` = JSON `{ app: "sticky-math", v, tex, display, corps, scalePct, depthEx, exEm, mtextFont }` and `rect.insertLabel("sticky-math:tex", tex)`.

Panel/webview link (`plugin/lib/webview-link.js`): a state machine under permanent supervision, never "acquired". Continuous ping (1.5 s while establishing, 10 s once established), the link declared lost after 2 silent pings then re-established automatically, current content re-rendered on every (re)connection. Escalation on silence: a fallback channel through the URL fragment (builds where panel to webview postMessage is mute), cut as soon as a ping answers by postMessage, then recreation of the webview element as a last resort. The webview answers pings by reporting which channel they arrived on and re-announces itself when visibility resumes.

Unit conversion: the MathJax SVG is sized in ex. The ex/em ratio is MEASURED by the webview (`MathJax.getMetricsFor`, around 0.459, not 0.5). size in pt = valueEx * exEm * pointSize * (scale / 100).

## Repository structure

- `plugin/`: the UXP plugin, loadable as is in the UXP Developer Tool (manifest v5). `main.js` does nothing but UI wiring; the logic lives in `plugin/lib/` (webview-link.js: the supervised link; indesign.js: InDesign DOM, fully synchronous; prefs.js: persistent preferences and SVG writing).
- `plugin/webview/vendor/tex-svg-full.js`: MathJax 3 vendored (the complete tex-svg component), for offline operation. Do not replace it with a CDN load.
- `docs/`: architecture, installation, environment report, roadmap, and ADRs (one decision per numbered file).
- `spikes/`: exploratory code kept for reference, never imported by the plugin.

## Conventions

- Panel interface in Spectrum UXP components (`sp-textarea`, `sp-textfield`, `sp-slider`, `sp-action-button`, `sp-label`, `sp-divider`): native InDesign styling and automatic light/dark theme tracking. Accepted exception: the primary "Insert" button is a hand-rolled `button` (Adobe blue #1473e6, 26 px, 2 px corners), the CTA `sp-button` being too massive and too rounded. `styles.css` handles layout only, modelled on the native panels (label on the left, control on the right), fluid (vertical scrolling if the panel is short, never horizontal overflow). Careful: `sp-textfield` does not support `type="number"` (it displays "nan"); use text fields plus parseFloat in code.
- No "Display" checkbox: display mode is decided by the delimiters typed in (`$$...$$`, `\[...\]`), which are stripped before rendering.
- The panel is silent in normal operation: the status and link-state areas (hidden when empty via `:empty`) only appear for an error or a useful warning (invalid LaTeX, overset table cell, lost destination folder, broken webview link).

- Documentation and code comments in English.
- Code comments kept sober: only the non-obvious constraints.
- The panel's user-facing strings stay in French (labels, status messages, the InDesign undo step name). The interface is French; the documentation is not.
- The panel talks to the webview in stringified JSON in both directions (message types: render, clear, ready, rendered, error).
- No network dependency at runtime. Everything is embedded in `plugin/`.
- Testing the webview page outside InDesign: the Playwright harness used for validation is described in the environment report (a `window.uxpHost` stub, simulated message events).

## State and next steps

The minimal panel (input, preview, anchored insertion with baseline) is written and the rendering part is validated in Chromium. The first verification in real InDesign is still to be done (see the checklist in docs/roadmap.md). Next steps in docs/roadmap.md.
