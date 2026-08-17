# Architecture

## The constraint everything else follows from

The preview shown in the panel is exactly what gets inserted into the document, down to the vector.
Every rule below exists to protect that property.

1. **One render.** LaTeX is rendered once, to SVG, by MathJax inside the webview
   (`plugin/webview/renderer.js`). The preview is that DOM node; the inserted SVG is the
   serialization of the same node.
2. **No second engine.** Nothing re-processes the expression between preview and insertion. In
   particular, InDesign's native MathML rendering is not used for final output. See
   [`environment.md`](environment.md) for what that API can do; it is held in reserve for a possible
   future opt-in "editable text" mode, which would be explicitly outside the WYSIWYG guarantee.
3. **One permitted transformation.** Before placement, `plugin/main.js` rewrites the `width` and
   `height` attributes from `ex` to points. Unit conversion only, never the `viewBox` and never the
   paths.
4. **`fontCache: "none"`.** Required so math glyphs come out as inline paths rather than
   `<defs>`/`<use>`, which InDesign's SVG importer handles poorly. The accepted trade-off is that some
   text does not get outlined. Measured in Chromium:

   | Case | Output |
   |---|---|
   | `\text{somme}`, no font chosen | outlined paths, no `<text>` |
   | Character outside the TeX fonts (`é`), no font chosen | `<text font-family="serif">`, a presentation attribute |
   | Any `\text{}` with a font chosen in the panel | `<text>` inside `<g style="font-family: Georgia;">` |

   The third row is the fragile one: the chosen family travels as **inline CSS on the parent group**,
   not as an SVG presentation attribute, and SVG importers commonly drop inline style. If InDesign
   ignores it, the segment silently renders in another font while the preview showed the chosen one.
   The family must also exist in InDesign. This needs visual verification before the font option can
   be trusted; if the importer betrays it, the options are outlining those segments or rewriting the
   family onto the `<text>` element as a presentation attribute (which would need its own decision,
   since it edits the SVG beyond unit conversion).
5. **The preview CSS may only target the root SVG** (`#preview mjx-container > svg`). Stretchy
   characters, the braces of `\underbrace`, large delimiters, are assemblies of nested `<svg>`
   elements with explicit dimensions; a global `height: auto` dislocates them, producing an extension
   bar running through the text.
6. **Metadata is stored separately.** The LaTeX source, point size, scale, and depth live in a JSON
   label on the placed object, for future re-editing. The visual remains the SVG that came out of the
   preview.

## Data flow

```
panel (UXP)                             webview (Chromium)
───────────                             ──────────────────
LaTeX input
  │  postMessage {type: "render", tex, mtextFont}
  └────────────────────────────────────────▶ MathJax.tex2svgPromise
                                              │
                                              ├─▶ node appended to #preview
                                              │     (this is the preview)
                                              │
     {type: "rendered", svg, widthEx,         │
      heightEx, depthEx, exEm}                │
  ◀───────────────────────────────────────────┘  svg.outerHTML
  │
  ├─ rewrite width/height in points
  ├─ prefs.writeSvg() into the active destination
  └─ indesign.insertFormula(): synchronous placement
```

Messages are JSON strings in both directions. Types: `render`, `clear`, `ping` (panel to webview);
`ready`, `rendered`, `error` (webview to panel).

## Unit conversion

MathJax sizes its SVG in `ex`, so the ex-to-em ratio actually in effect is needed. It is *measured*
in the webview with `MathJax.getMetricsFor`, not assumed: the real value is around 0.459, not 0.5.

```
sizeInPoints = valueEx × exEm × pointSize × (scale / 100)
```

Depth below the baseline comes from the `vertical-align` MathJax puts on the SVG, and becomes the
anchored object's Y offset.

## InDesign placement (`plugin/lib/indesign.js`)

**The absolute reliability rule: no InDesign DOM reference may cross an `await`.** A reference
invalidated by a user action during an await can crash InDesign at the native level. The insertion
point is therefore resolved at call time, after the file has been written, and the entire sequence is
synchronous.

Beyond that:

- The sequence runs inside `app.doScript(…, UndoModes.ENTIRE_SCRIPT)`: one transaction, one undo
  step. It falls back to direct execution if `doScript` refuses a function on the current build.
- `insertionPoint.rectangles.add()` creates the inline anchored rectangle, then `rect.place(svgPath)`
  and `fit(FRAME_TO_CONTENT)`.
- Baseline: `anchoredObjectSettings.anchorYoffset = -depthPt`. The sign needs one visual confirmation
  on the first real insertion.
- Tables: a cell in overset hides *all* of its content, which is the cause of formulas appearing to
  vanish. If insertion happens in an overset cell and the row will not grow, `row.autoGrow` is
  enabled in the same transaction and reported in the status line. If overset persists, the panel
  warns.
- Measurement units are forced to points via `app.scriptPreferences.measurementUnit` and restored in
  a `finally`.
- Labels: `rect.label` holds
  `{ app: "sticky-math", v, tex, display, corps, scalePct, depthEx, exEm, mtextFont }` and
  `rect.insertLabel("sticky-math:tex", tex)` holds the source on its own.

## Panel-to-webview link (`plugin/lib/webview-link.js`)

The link is never treated as acquired. UXP can unload or reload the webview at any time: the panel
being hidden or redocked, a workspace change, a memory purge, sleep. So a state machine runs a
continuous heartbeat, fast during establishment (1.5 s) and light once established (10 s). After two
silent pings the link is declared lost and re-established automatically, and the current content is
re-rendered on every reconnection.

Escalation on continued silence:

1. A fallback channel using the URL fragment, for builds where panel-to-webview `postMessage` is mute
   (the InDesign 20.4 bug). It is cut as soon as a ping answers by `postMessage`, because every write
   to `src` can reload the page, and MathJax with it.
2. Recreating the webview element, as a last resort.

The webview answers pings by reporting which channel the ping arrived on, deduplicates messages by
sequence number since both channels can deliver the same one, and re-announces itself when visibility
resumes.

## Destination of SVG files

The plugin's temporary folder by default, or any folder the user chooses
(`localFileSystem: "request"`, `getFolder` picker). Access to a chosen folder survives across
sessions through a UXP persistent token (`createPersistentToken` / `getEntryForPersistentToken`)
stored in `localStorage` alongside the display path. The destination is re-read on every insertion, so
a change takes effect immediately, and the plugin never deletes files it has written.
