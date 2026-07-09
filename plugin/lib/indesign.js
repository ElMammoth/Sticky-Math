/*
 * Acces au DOM InDesign : lecture du contexte texte au curseur et
 * insertion de la formule en objet ancre inline.
 *
 * Regle de fiabilite absolue : aucune reference DOM InDesign
 * (InsertionPoint, Rectangle...) ne doit traverser une frontiere
 * asynchrone. Une reference invalidee par une action utilisateur
 * pendant un await peut faire planter InDesign au niveau natif.
 * Tout ici est synchrone ; la resolution de la selection se fait au
 * moment de l'appel, jamais avant.
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
 * Selection texte courante resolue en une passe :
 * { ip, pointSize, fontFamily }, ou null hors contexte texte.
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
    /* pointSize peut revenir NaN ou sous forme de chaine selon le
       contexte : ne garder qu'un nombre fini et positif */
    const ps = parseFloat(item.pointSize);
    if (isFinite(ps) && ps > 0) ctx.pointSize = ps;
    const font = item.appliedFont;
    /* selon le contexte, Font object ou chaine "Famille\tStyle" */
    if (typeof font === "string") ctx.fontFamily = font.split("\t")[0];
    else if (font && font.fontFamily) ctx.fontFamily = font.fontFamily;
    else if (font && font.name) ctx.fontFamily = font.name.split("\t")[0];
    return ctx;
  } catch (e) {
    return null;
  }
}

/*
 * Sequence de placement, appelee dans la transaction. Retourne le
 * diagnostic tableau : une cellule en exces masque TOUT son contenu
 * (c'est la cause des formules "disparues" dans les tableaux), donc
 * si la rangee ne peut pas grandir on active son auto-grandissement,
 * annulable avec l'insertion puisque tout est dans le meme pas d'undo.
 */
function performInsert(ip, params) {
  const doc = app.activeDocument;
  const rect = ip.rectangles.add();
  rect.geometricBounds = [0, 0, params.heightPt, params.widthPt];
  rect.strokeWeight = 0;
  try {
    rect.strokeColor = doc.swatches.itemByName("None");
  } catch (e) {
    /* le contour a 0 pt suffit */
  }
  rect.place(params.svgPath);
  rect.fit(FitOptions.FRAME_TO_CONTENT);

  const aos = rect.anchoredObjectSettings;
  aos.anchoredPosition = AnchorPosition.INLINE_POSITION;
  /* profondeur MathJax sous la baseline ; signe a confirmer visuellement */
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
    /* diagnostic tableau non bloquant */
  }
  return table;
}

/*
 * Insertion complete : resolution du point d'insertion AU MOMENT de
 * l'appel, unites forcees en points, et toute la sequence DOM dans une
 * transaction doScript ENTIRE_SCRIPT : une seule recomposition logique,
 * un seul pas d'annulation. Si doScript n'accepte pas de fonction sur
 * ce build, execution directe equivalente (sans le pas d'undo unique).
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
      if (ran) throw e; /* l'insertion elle-meme a echoue */
      run(); /* doScript indisponible : execution directe */
    }
    return { ok: true, table };
  } finally {
    app.scriptPreferences.measurementUnit = previousUnit;
  }
}

module.exports = { textContext, insertFormula, LABEL_KEY };
