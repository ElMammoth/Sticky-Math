/*
 * Sticky Math : panneau UXP pour InDesign 2026.
 *
 * Contrainte WYSIWYG : le SVG affiché dans la webview d'aperçu est
 * exactement celui qui est écrit sur disque puis placé dans InDesign.
 * La seule transformation autorisée est la réécriture des attributs
 * width/height (unités ex vers pt), qui est une conversion d'unités,
 * pas un re-rendu. Voir docs/adr/0001-moteur-de-rendu.md.
 */

const { entrypoints } = require("uxp");
const uxpStorage = require("uxp").storage.localFileSystem;
const { app, AnchorPosition, FitOptions, MeasurementUnits } = require("indesign");

const LABEL_KEY = "sticky-math";

let webview = null;
let webviewReady = false;
let pendingRender = null;
let lastRender = null; // { tex, display, svg, widthEx, heightEx, depthEx, exEm }
let debounceTimer = null;

entrypoints.setup({
  panels: {
    stickyMathPanel: {
      show() {},
    },
  },
});

document.addEventListener("DOMContentLoaded", () => {
  webview = document.getElementById("renderer");
  const texInput = document.getElementById("tex");
  const displayInput = document.getElementById("display");
  const scaleInput = document.getElementById("scale");
  const scaleValue = document.getElementById("scaleValue");
  const insertBtn = document.getElementById("insert");
  const fromCursorBtn = document.getElementById("fromCursor");

  webview.addEventListener("message", (event) => {
    let msg = event.data;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch (e) {
        return;
      }
    }
    if (!msg || !msg.type) return;

    if (msg.type === "ready") {
      webviewReady = true;
      if (pendingRender) {
        postToWebview(pendingRender);
        pendingRender = null;
      }
      return;
    }
    if (msg.type === "rendered") {
      lastRender = msg;
      insertBtn.disabled = false;
      setStatus("");
      return;
    }
    if (msg.type === "error") {
      lastRender = null;
      insertBtn.disabled = true;
      setStatus("Erreur LaTeX : " + msg.message);
    }
  });

  const requestRender = () => {
    const tex = texInput.value.trim();
    if (!tex) {
      lastRender = null;
      insertBtn.disabled = true;
      postToWebview({ type: "clear" });
      return;
    }
    postToWebview({ type: "render", tex, display: displayInput.checked });
  };

  texInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(requestRender, 250);
  });
  displayInput.addEventListener("change", requestRender);

  scaleInput.addEventListener("input", () => {
    scaleValue.textContent = scaleInput.value;
  });

  fromCursorBtn.addEventListener("click", () => {
    const size = cursorPointSize();
    if (size) {
      document.getElementById("fontSize").value = size;
      setStatus("Corps repris du curseur : " + size + " pt");
    } else {
      setStatus("Placez le curseur texte dans un bloc pour lire sa taille.");
    }
  });

  insertBtn.addEventListener("click", () => {
    insertFormula().catch((e) => setStatus("Échec de l'insertion : " + (e && e.message ? e.message : e)));
  });
});

function postToWebview(msg) {
  if (!webviewReady) {
    if (msg.type === "render") pendingRender = msg;
    return;
  }
  webview.postMessage(JSON.stringify(msg));
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

/* Taille de police au point d'insertion courant, en pt, ou null. */
function cursorPointSize() {
  try {
    const sel = app.selection;
    if (!sel || sel.length === 0) return null;
    const item = sel[0];
    if (typeof item.pointSize === "number") return item.pointSize;
    if (item.insertionPoints && item.insertionPoints.length > 0) {
      return item.insertionPoints.item(0).pointSize;
    }
  } catch (e) {
    /* pas de sélection texte */
  }
  return null;
}

/* Point d'insertion courant dans un texte, ou null. */
function currentInsertionPoint() {
  const sel = app.selection;
  if (!sel || sel.length === 0) return null;
  const item = sel[0];
  const name = item.constructor && item.constructor.name;
  if (name === "InsertionPoint") return item;
  if (item.insertionPoints && item.insertionPoints.length > 0) {
    return item.insertionPoints.item(0);
  }
  return null;
}

async function insertFormula() {
  if (!lastRender) return;
  if (!app.documents.length) {
    setStatus("Ouvrez un document InDesign.");
    return;
  }
  const ip = currentInsertionPoint();
  if (!ip) {
    setStatus("Placez le curseur texte à l'endroit voulu, puis cliquez sur Insérer.");
    return;
  }

  const fontSizeField = document.getElementById("fontSize");
  const corps = parseFloat(fontSizeField.value) || cursorPointSize() || 12;
  const scalePct = parseFloat(document.getElementById("scale").value) || 100;
  const scale = scalePct / 100;

  /*
   * Conversion des unités MathJax vers des points InDesign.
   * Le SVG sort dimensionné en "ex". exEm est le rapport ex/em mesuré
   * par MathJax dans la webview. 1 em = corps * échelle, en pt.
   */
  const emPt = corps * scale;
  const exPt = lastRender.exEm * emPt;
  const widthPt = lastRender.widthEx * exPt;
  const heightPt = lastRender.heightEx * exPt;
  const depthPt = lastRender.depthEx * exPt;

  /* Seule retouche du SVG : dimensions physiques en pt. */
  const svgText = lastRender.svg
    .replace(/width="[^"]*"/, 'width="' + widthPt.toFixed(4) + 'pt"')
    .replace(/height="[^"]*"/, 'height="' + heightPt.toFixed(4) + 'pt"');

  const tempFolder = await uxpStorage.getTemporaryFolder();
  const file = await tempFolder.createFile("sticky-math-" + Date.now() + ".svg", { overwrite: true });
  await file.write(svgText);

  const doc = app.activeDocument;
  const previousUnit = app.scriptPreferences.measurementUnit;
  app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
  try {
    const rect = ip.rectangles.add();
    rect.geometricBounds = [0, 0, heightPt, widthPt];
    rect.strokeWeight = 0;
    try {
      rect.strokeColor = doc.swatches.itemByName("None");
    } catch (e) {
      /* le contour à 0 pt suffit */
    }
    rect.place(file.nativePath);
    rect.fit(FitOptions.FRAME_TO_CONTENT);

    const aos = rect.anchoredObjectSettings;
    aos.anchoredPosition = AnchorPosition.INLINE_POSITION;
    /*
     * Baseline : MathJax renvoie la profondeur (partie sous la ligne de
     * base) via vertical-align. Offset négatif = l'objet descend sous la
     * baseline de depthPt. Signe à confirmer visuellement dans InDesign,
     * voir TODO.md.
     */
    aos.anchorYoffset = -depthPt;

    rect.label = JSON.stringify({
      app: LABEL_KEY,
      v: 1,
      tex: lastRender.tex,
      display: lastRender.display,
      corps: corps,
      scalePct: scalePct,
      depthEx: lastRender.depthEx,
      exEm: lastRender.exEm,
    });
    rect.insertLabel(LABEL_KEY + ":tex", lastRender.tex);

    setStatus(
      "Formule insérée : " + widthPt.toFixed(1) + " x " + heightPt.toFixed(1) +
      " pt, profondeur " + depthPt.toFixed(2) + " pt sous la baseline."
    );
  } finally {
    app.scriptPreferences.measurementUnit = previousUnit;
  }
}
