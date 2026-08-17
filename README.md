# Sticky Math

A UXP panel plugin for Adobe InDesign 2026 that lets you write LaTeX in a panel, preview it live, and
insert the result into the text flow at the cursor as an inline anchored object sitting on the
baseline.

InDesign has no native LaTeX input. Its MathML support (added in InDesign 2025) renders through an
engine you cannot see or control, and the usual workaround, rendering formulas somewhere else and
importing the files by hand, breaks down as soon as a formula needs a correction. Sticky Math keeps
the whole loop inside InDesign: type, look at the preview, insert at the cursor with the right point
size and the right baseline offset.

## The WYSIWYG constraint

The preview is not an approximation of the result. It *is* the result.

LaTeX is rendered exactly once, to SVG, by MathJax running inside a UXP webview. The preview is that
SVG DOM node. What gets written to disk and placed in the document is the serialization of that same
node. No second engine ever touches the expression, and the only transformation allowed before
placement is rewriting the `width` and `height` attributes from `ex` to points, a unit conversion
that leaves the `viewBox` and every path untouched.

This constraint drove the main architectural decision (see
[`docs/adr/0001-rendering-engine.md`](docs/adr/0001-rendering-engine.md)) and it is the reason the
plugin does *not* use InDesign's native MathML rendering, which would be a second engine producing
output the preview never showed you.

## Requirements

- macOS
- Adobe InDesign 2026, version 21.0.0.192 or newer
- [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) (UDT),
  installable from Creative Cloud Desktop

No build step and no dependency installation. MathJax is vendored into the plugin, and there is
nothing to fetch at runtime.

## Running it

1. Open InDesign 2026.
2. Open the UXP Developer Tool.
3. **Add Plugin**, and select `plugin/manifest.json` from this repository.
4. On the plugin's row, click **Load**. The *Sticky Math* panel appears in InDesign.
5. After editing any file, use **Actions → Reload** to pick up the change.

For permanent installation as a `.ccx` package, and for the Creative Cloud installer errors you may
hit along the way, see [`docs/installation.md`](docs/installation.md).

## Usage

1. Open a document and place the text cursor where the formula should go.
2. Type LaTeX into the panel. The preview updates as you type. Wrapping delimiters are optional and
   determine the mode: `$$…$$` and `\[…\]` render as display, `$…$` and `\(…\)` as inline.
3. Set the point size, or click **Curseur** to read it from the text at the cursor. Adjust the scale
   percentage if the optical weight needs tuning against the surrounding text.
4. Click **Insérer au curseur**. The formula is placed as an inline anchored rectangle, offset onto
   the baseline using the depth MathJax reports.

Two optional settings:

- **Police \text{}** applies a font of your choice to `\text{}` segments. Left empty, MathJax uses
  its own TeX fonts. The chosen font must exist in InDesign, because these segments are inserted as
  SVG text rather than outlines.
- **Destination** controls where the SVG files are written. The default is the plugin's temporary
  folder; choosing another folder is remembered across sessions through a UXP persistent token. The
  plugin never deletes files it has written.

Each placed object carries a JSON label with the LaTeX source, point size, scale, and depth, in
preparation for re-editing (see [limitations](#status-and-limitations)).

## Repository structure

```
plugin/                     the loadable UXP plugin, manifest v5
  manifest.json             entry point: panel declaration, permissions, host version
  index.html                panel markup, Spectrum UXP components
  main.js                   UI wiring only; no business logic
  styles.css                panel layout
  lib/
    webview-link.js         supervised panel <-> webview link, state machine
    indesign.js             InDesign DOM access; fully synchronous, see the file header
    prefs.js                persistent preferences and SVG file writing
  webview/
    renderer.html           the preview page loaded in the webview
    config.js               MathJax configuration, loaded before MathJax itself
    renderer.js             render, extract metrics, return the SVG to the panel
    vendor/tex-svg-full.js  MathJax 3, vendored for offline use
docs/
  architecture.md           how the pieces fit together and which rules cannot be broken
  installation.md           UDT loading, .ccx packaging, installer troubleshooting
  environment.md            target versions, InDesign's native MathML API, what to check locally
  roadmap.md                verification checklist and planned work
  adr/                      architecture decision records
spikes/
  option-a-liteadaptor/     rejected alternative, kept as the evidence behind ADR 0001
```

`spikes/` is intentionally unused code. It is never imported by the plugin and exists because ADR
0001 rejects an approach, and the reasoning is only credible with the experiment attached.

## How it works

```
panel                                webview
─────                                ───────
LaTeX input
  │  postMessage {type: "render"}
  └──────────────────────────────────▶ MathJax tex2svgPromise
                                        │
                                        ├─▶ SVG node appended to the page  (this is the preview)
                                        │
     {type: "rendered", svg, metrics}   │
  ◀─────────────────────────────────────┘   svg.outerHTML + widthEx, heightEx,
  │                                         depthEx, exEm
  ├─ convert ex to points
  ├─ write the SVG file to the active destination
  └─ place it: insertionPoint.rectangles.add(), place(), fit to content,
     anchorYoffset = -depthPt
```

Two details carry most of the engineering weight:

**Unit conversion.** MathJax sizes its SVG in `ex`, so the plugin needs the ex-to-em ratio actually
in effect. It is measured in the webview with `MathJax.getMetricsFor` rather than assumed, because the
real value is about 0.459, not the 0.5 you would guess. The final size is
`valueEx × exEm × pointSize × (scale / 100)`.

**Placement reliability.** No InDesign DOM reference may cross an `await`. A reference invalidated by
a user action mid-await can crash InDesign at the native level, so the insertion point is resolved
after the file is written and the entire placement sequence runs synchronously inside
`app.doScript(…, UndoModes.ENTIRE_SCRIPT)`, which also makes the whole insertion a single undo step.

The panel-to-webview link is treated as unreliable by design: UXP can unload or reload a webview at
any time, so a heartbeat runs continuously, the link is declared lost after two silent pings, and the
current formula is re-rendered on every reconnection. Full detail in
[`docs/architecture.md`](docs/architecture.md).

## Status and limitations

The plugin is written and the rendering path is validated, but it has not yet been through its first
run inside real InDesign. Being straightforward about what that means:

- **Verified.** The webview render path, end to end, in Chromium (the same engine family as the UXP
  webview): handshake, render, SVG and metric extraction, and the invalid-LaTeX error path. Headless
  MathJax rendering was separately validated under Node 22 during the ADR 0001 spike.
- **Not yet verified.** Everything requiring InDesign or the UXP Developer Tool. The checklist is in
  [`docs/roadmap.md`](docs/roadmap.md).
- **The sign of `anchorYoffset`** needs one visual confirmation. If the first inserted formula sits
  on the wrong side of the baseline, the fix is a single character in `plugin/lib/indesign.js`.
- **`\text{}` segments** can leave MathJax as SVG `<text>` elements rather than outlines, and their
  fidelity through InDesign's SVG importer is unverified. Measured behavior, with `fontCache: "none"`
  in effect: characters covered by the TeX fonts are outlined normally; characters outside them,
  accented ones in particular, become `<text font-family="serif">`; and when a font is chosen in the
  panel, the whole segment becomes a `<text>` whose family rides on the parent group as
  `<g style="font-family: …">`, an inline CSS declaration rather than an SVG presentation attribute.
  If InDesign's importer drops that inline style, those segments will silently fall back to another
  font while the preview showed the chosen one. This is the most likely place for the WYSIWYG
  guarantee to break, and it is the first thing to check on a real document.
- **Re-editing a placed formula is not implemented.** The JSON label is written in preparation for it,
  and nothing reads it back yet.
- **Tables.** A cell in overset hides all of its content, which is what makes formulas appear to
  vanish. The plugin detects this and enables `autoGrow` on the row within the same transaction, but
  the behavior has not been exercised against real tables.
- **Icons are placeholders.**
- **Scope.** macOS and InDesign 2026 only. There is no automated test suite; the webview page is
  validated with a Playwright harness described in [`docs/environment.md`](docs/environment.md).

The panel interface is in French.

## License

MIT, see [`LICENSE`](LICENSE).
