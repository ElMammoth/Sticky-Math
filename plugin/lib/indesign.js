/*
 * InDesign DOM access: reading the text context at the cursor and
 * inserting the formula as an inline anchored object.
 *
 * Absolute reliability rule: no InDesign DOM reference (InsertionPoint,
 * Rectangle...) may cross an async boundary. A reference invalidated by
 * a user action during an await can crash InDesign at the native level.
 * Everything here is synchronous; the selection is resolved at call
 * time, never earlier.
 */

const {
  app,
  AnchorPosition,
  FitOptions,
  MeasurementUnits,
  ScriptLanguage,
  UndoModes,
} = require("indesign");

const LABEL_KEY = "sticky-math";

/*
 * Current text selection resolved in a single pass:
 * { ip, pointSize, fontFamily }, or null outside a text context.
 */
function textContext() {
  try {
    const sel = app.selection;
    if (!sel || sel.length === 0) return null;
    let item = sel[0];
    if (
      item &&
      item.constructor &&
      item.constructor.name !== "InsertionPoint" &&
      item.insertionPoints &&
      item.insertionPoints.length > 0
    ) {
      item = item.insertionPoints.item(0);
    }
    if (!item || !item.constructor || item.constructor.name !== "InsertionPoint") return null;

    const ctx = { ip: item, pointSize: null, fontFamily: null };
    /* pointSize can come back as NaN or as a string depending on the
       context: keep only a finite, positive number */
    const ps = parseFloat(item.pointSize);
    if (isFinite(ps) && ps > 0) ctx.pointSize = ps;
    const font = item.appliedFont;
    /* depending on the context, a Font object or a "Family\tStyle" string */
    if (typeof font === "string") ctx.fontFamily = font.split("\t")[0];
    else if (font && font.fontFamily) ctx.fontFamily = font.fontFamily;
    else if (font && font.name) ctx.fontFamily = font.name.split("\t")[0];
    return ctx;
  } catch (e) {
    return null;
  }
}

/*
 * Placement sequence, called inside the transaction. Returns the table
 * diagnosis: a cell in overset hides ALL of its content (this is the
 * cause of formulas "vanishing" inside tables), so if the row cannot
 * grow we enable its auto-grow, which is undone along with the
 * insertion since everything sits in the same undo step.
 */
function performInsert(ip, params) {
  const doc = app.activeDocument;
  const rect = ip.rectangles.add();
  rect.geometricBounds = [0, 0, params.heightPt, params.widthPt];
  rect.strokeWeight = 0;
  try {
    rect.strokeColor = doc.swatches.itemByName("None");
  } catch (e) {
    /* a 0 pt stroke weight is enough */
  }
  rect.place(params.svgPath);
  rect.fit(FitOptions.FRAME_TO_CONTENT);

  const aos = rect.anchoredObjectSettings;
  aos.anchoredPosition = AnchorPosition.INLINE_POSITION;
  /* MathJax depth below the baseline; sign to confirm visually */
  aos.anchorYoffset = -params.depthPt;

  rect.label = params.label;
  rect.insertLabel(LABEL_KEY + ":tex", params.tex);

  const table = { inCell: false, autoGrowEnabled: false, stillOverflows: false };
  try {
    const parent = ip.parent;
    if (parent && parent.constructor && parent.constructor.name === "Cell") {
      table.inCell = true;
      if (parent.overflows) {
        const row = parent.parentRow;
        if (row && row.autoGrow === false) {
          row.autoGrow = true;
          table.autoGrowEnabled = true;
        }
        table.stillOverflows = !!parent.overflows;
      }
    }
  } catch (e) {
    /* table diagnosis is non-blocking */
  }
  return table;
}

/*
 * Full insertion: the insertion point is resolved AT call time, units
 * are forced to points, and the whole DOM sequence runs inside a
 * doScript ENTIRE_SCRIPT transaction: one logical recomposition, one
 * undo step. If doScript does not accept a function on this build, an
 * equivalent direct execution runs instead (without the single undo).
 */
function insertFormula(params) {
  if (!app.documents.length) return { ok: false, reason: "no-document" };
  const ctx = textContext();
  if (!ctx || !ctx.ip) return { ok: false, reason: "no-insertion-point" };

  const previousUnit = app.scriptPreferences.measurementUnit;
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    let table = null;
    let ran = false;
    const run = () => {
      ran = true;
      table = performInsert(ctx.ip, params);
    };
    try {
      app.doScript(run, ScriptLanguage.UXPSCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Insérer une formule Sticky Math");
    } catch (e) {
      if (ran) throw e; /* the insertion itself failed */
      run(); /* doScript unavailable: direct execution */
    }
    return { ok: true, table };
  } finally {
    app.scriptPreferences.measurementUnit = previousUnit;
  }
}

module.exports = { textContext, insertFormula, LABEL_KEY };
