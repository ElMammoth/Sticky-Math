# Roadmap

## Immediate checks (first load in InDesign)

Nothing below has been done yet: this container has no InDesign. These are the checks that turn "the
render path works" into "the plugin works".

- [ ] Load `plugin/` in the UXP Developer Tool on the Mac, with InDesign 2026 open, and check that the
      panel appears and that the MathJax preview renders in the webview.
- [ ] Record the versions asked for in [`environment.md`](environment.md) (InDesign, UDT,
      `require("uxp").versions`).
- [ ] Insert an inline formula into a paragraph and check the baseline alignment. **Confirm the sign of
      `anchorYoffset`** in `plugin/lib/indesign.js`: if the formula is offset the wrong way, invert it
      to `+depthPt`.
- [ ] Visually check the fidelity of InDesign's SVG importer on a loaded formula (root, fraction,
      exponents) by comparing against the preview at high zoom.
- [ ] Check that the anchored rectangle has no stray stroke or fill.
- [ ] Check how the SVG's `<text>` elements import into InDesign (`\text{}` segments with a chosen
      font, accented characters): the font must be respected, with no substitution. **Priority check**,
      because the chosen family travels as inline CSS on the parent group
      (`<g style="font-family: …">`) rather than as an SVG presentation attribute, and importers
      commonly drop inline style. See the table in [`architecture.md`](architecture.md). If the
      importer betrays the render, the options are outlining those segments or moving the family onto
      the `<text>` element.

## Next functional steps

- [ ] Fine size control: prefill the point size from the cursor automatically on open and on selection
      change (an `afterSelectionChanged` listener), not only through the button.
- [ ] Re-editability: detect the selection of an existing formula (by its `sticky-math` label), reload
      its source into the panel, and replace the object in place, keeping its position and anchoring.
- [ ] Advanced baseline handling: check the behavior with fixed leading, vertical text offset, and
      display formulas. Expose a manual offset setting if needed.
- [ ] Preview at scale: reflect point size and scale in the preview's display size (the webview
      container's `font-size`) to judge optical harmony against the text.
- [ ] User LaTeX macros (a configurable preamble passed to MathJax) and a library of recent formulas.
- [x] SVG destination chosen by the user, persistent across sessions, files kept until deleted by hand
      (automatic cleanup is no longer wanted).
- [ ] Future option: embed the SVG in the document's data (embedding the InDesign link) for files left
      in the temporary folder.
- [x] Undo grouping: insertion wrapped in `app.doScript` with `UndoModes.ENTIRE_SCRIPT`, falling back
      to direct execution if unavailable.
- [x] Tables: detect an overset cell after insertion, enable `autoGrow` on the row in the same
      transaction, warn if the overset persists.
- [x] Webview link reliability: a state machine with a permanent heartbeat, automatic reconnection,
      re-render on reconnection, and webview recreation as a last resort.
- [ ] Verify the reconnection scenarios for real (hide and reshow the panel, change workspace, leave
      InDesign idle for a long time): the webview link line must clear on its own.
- [ ] Display versus inline mode: distinct typographic treatment (a display formula in its own
      paragraph, centered, with spacing).
- [ ] `.ccx` packaging and final icons.

## Later leads

- [ ] Opt-in "editable text" mode through the native MathML API (`Document.createFromMathML`), clearly
      flagged as outside the WYSIWYG guarantee. See [`environment.md`](environment.md).
- [ ] Headless batch rendering (the option A spike) to re-export every formula in a document at once.
- [ ] Export: check how placed SVGs behave on PDF/X export and in print (flattening, black overprint).
