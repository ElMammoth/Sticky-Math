/*
 * Sticky Math: UXP panel for InDesign 2026.
 *
 * WYSIWYG constraint: the SVG displayed in the preview webview is exactly
 * the one written to disk and then placed into InDesign. The only allowed
 * transformation is rewriting the width/height attributes (ex to pt), a
 * unit conversion, never a re-render.
 * See docs/adr/0001-rendering-engine.md.
 *
 * This file is nothing but UI wiring:
 * - supervised webview link: lib/webview-link.js;
 * - InDesign DOM access (synchronous): lib/indesign.js;
 * - persistent preferences and SVG writing: lib/prefs.js.
 */

const { entrypoints } = require("uxp");
const { createWebviewLink, WEBVIEW_SRC } = require("./lib/webview-link.js");
const prefs = require("./lib/prefs.js");
const indesign = require("./lib/indesign.js");

entrypoints.setup({ panels: { stickyMathPanel: { show() {} } } });

let ui = null; // DOM references, filled in once at DOMContentLoaded
let link = null;
let lastRender = null; // last "rendered" message from the webview
let debounceTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  ui = {
    tex: document.getElementById("tex"),
    fontSize: document.getElementById("fontSize"),
    scale: document.getElementById("scale"),
    mtextFont: document.getElementById("mtextFont"),
    insert: document.getElementById("insert"),
    destPath: document.getElementById("destPath"),
    bridge: document.getElementById("bridge"),
    status: document.getElementById("status"),
  };

  ui.mtextFont.value = prefs.getMtextFont();

  link = createWebviewLink({
    getWebview: () => document.getElementById("renderer"),
    replaceWebview,
    onConnected() {
      /* on every (re)connection, re-render the current state: covers
         startup AND silent reloads of the webview */
      if (ui.tex.value.trim()) requestRender();
    },
    onLost() {
      /* lastRender stays valid: insertion does not depend on the link */
    },
    onMessage: onWebviewMessage,
    onState: onLinkState,
  });
  link.start();

  ui.tex.addEventListener("input", () => scheduleRender(250));
  ui.mtextFont.addEventListener("input", () => {
    prefs.setMtextFont(ui.mtextFont.value.trim());
    scheduleRender(400);
  });

  document.getElementById("fromCursor").addEventListener("click", () => {
    const ctx = indesign.textContext();
    if (ctx && ctx.pointSize) {
      /* always a clean numeric string: sp-textfield displays "nan" if
         anything else is pushed into it */
      ui.fontSize.value = String(Math.round(ctx.pointSize * 100) / 100);
      setStatus("");
    } else {
      setStatus("Placez le curseur texte dans un bloc pour lire sa taille.");
    }
  });

  document.getElementById("mtextFromCursor").addEventListener("click", () => {
    const ctx = indesign.textContext();
    if (ctx && ctx.fontFamily) {
      ui.mtextFont.value = ctx.fontFamily;
      prefs.setMtextFont(ctx.fontFamily);
      setStatus("");
      requestRender();
    } else {
      setStatus("Placez le curseur texte dans un bloc pour lire sa police.");
    }
  });

  ui.insert.addEventListener("click", () => {
    insertFormula().catch((e) => setStatus("Échec de l'insertion : " + errText(e), true));
  });

  document.getElementById("chooseDest").addEventListener("click", () => {
    prefs
      .chooseDestFolder()
      .then((path) => {
        if (path) updateDestLabel();
      })
      .catch((e) => setStatus("Choix du dossier impossible : " + errText(e), true));
  });
  document.getElementById("resetDest").addEventListener("click", () => {
    prefs.resetDestFolder();
    updateDestLabel();
    setStatus("");
  });

  prefs.restoreDestFolder().then((res) => {
    updateDestLabel();
    if (!res.restored && res.lostPath) {
      setStatus(
        "Le dossier de destination mémorisé (" + res.lostPath + ") n'est plus accessible.\n" +
        "Retour au dossier temporaire ; re-choisissez une destination si besoin.",
        true
      );
    }
  });
});

/* ---------- webview link ---------- */

function replaceWebview() {
  const old = document.getElementById("renderer");
  const fresh = document.createElement("webview");
  fresh.id = "renderer";
  fresh.setAttribute("src", WEBVIEW_SRC);
  old.parentNode.replaceChild(fresh, old);
  return fresh;
}

/* The link status line only appears when something is wrong: in normal
   operation the panel stays silent. */
function onLinkState(state, detail) {
  if (state === "ready" || detail === "etablissement") {
    setBridge("");
    return;
  }
  if (detail === "perdue") setBridge("Aperçu déconnecté, reconnexion en cours...", true);
  if (detail === "escalade-hash") setBridge("Aperçu : canal de secours actif.", true);
  if (detail === "webview-recreee") {
    setBridge(
      "Aperçu bloqué, webview recréée. Si le blocage persiste, lisez le texte de la zone d'aperçu et vérifiez InDesign 21.0.0.192 minimum.",
      true
    );
  }
}

function onWebviewMessage(msg) {
  if (msg.type === "rendered") {
    lastRender = msg;
    ui.insert.disabled = false;
    setStatus("");
    return;
  }
  if (msg.type === "error") {
    lastRender = null;
    ui.insert.disabled = true;
    setStatus("Erreur LaTeX : " + msg.message, true);
  }
}

/* ---------- rendering ---------- */

function requestRender() {
  const tex = ui.tex.value.trim();
  if (!tex) {
    lastRender = null;
    ui.insert.disabled = true;
    if (link.isReady()) link.send({ type: "clear" });
    return;
  }
  /* link down: the render will be relaunched by onConnected */
  if (!link.isReady()) return;
  /* display mode is decided by the delimiters typed in ($$, \[ \]) */
  link.send({
    type: "render",
    tex,
    display: false,
    mtextFont: ui.mtextFont.value.trim(),
  });
}

function scheduleRender(delayMs) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(requestRender, delayMs);
}

/* ---------- insertion ---------- */

async function insertFormula() {
  if (!lastRender) return;

  const ctx = indesign.textContext();
  const corps = parseFloat(ui.fontSize.value) || (ctx && ctx.pointSize) || 12;
  const scalePct = parseFloat(ui.scale.value) || 100;

  /*
   * Converting MathJax units into InDesign points. The SVG is sized in
   * ex; exEm is the ex/em ratio measured by the webview.
   * 1 em = point size * scale, in pt.
   */
  const emPt = corps * (scalePct / 100);
  const exPt = lastRender.exEm * emPt;
  const widthPt = lastRender.widthEx * exPt;
  const heightPt = lastRender.heightEx * exPt;
  const depthPt = lastRender.depthEx * exPt;

  /* The only edit made to the SVG: physical dimensions in pt. */
  const svgText = lastRender.svg
    .replace(/width="[^"]*"/, 'width="' + widthPt.toFixed(4) + 'pt"')
    .replace(/height="[^"]*"/, 'height="' + heightPt.toFixed(4) + 'pt"');

  let file;
  try {
    file = await prefs.writeSvg(svgText);
  } catch (e) {
    const dest = prefs.destPath();
    setStatus(
      "Impossible d'écrire dans " + (dest ? "« " + dest + " »" : "le dossier temporaire") +
      " : " + errText(e) + (dest ? "\nRe-choisissez un dossier de destination." : ""),
      true
    );
    return;
  }

  const label = JSON.stringify({
    app: indesign.LABEL_KEY,
    v: 1,
    tex: lastRender.tex,
    display: lastRender.display,
    corps: corps,
    scalePct: scalePct,
    depthEx: lastRender.depthEx,
    exEm: lastRender.exEm,
    mtextFont: lastRender.mtextFont || "",
  });

  /*
   * The insertion point is resolved INSIDE insertFormula, after the
   * awaits: no InDesign DOM reference ever crosses an async boundary.
   */
  const res = indesign.insertFormula({
    svgPath: file.nativePath,
    widthPt: widthPt,
    heightPt: heightPt,
    depthPt: depthPt,
    label: label,
    tex: lastRender.tex,
  });

  if (!res.ok) {
    setStatus(
      res.reason === "no-document"
        ? "Ouvrez un document InDesign."
        : "Placez le curseur texte à l'endroit voulu, puis cliquez sur Insérer."
    );
    return;
  }

  /* silent on success: only useful warnings are displayed */
  let text = "";
  let warn = false;
  if (res.table && res.table.autoGrowEnabled) {
    text = "Rangée du tableau passée en hauteur automatique.";
  }
  if (res.table && res.table.stillOverflows) {
    text += (text ? "\n" : "") + "La cellule reste en excès : la formule peut être masquée.";
    warn = true;
  }
  setStatus(text, warn);
}

/* ---------- display ---------- */

function updateDestLabel() {
  const path = prefs.destPath();
  ui.destPath.textContent = path || "Dossier temporaire du plugin";
  ui.destPath.title = path || "";
}

function setStatus(text, isError) {
  ui.status.textContent = text;
  ui.status.className = isError ? "status error" : "status";
}

function setBridge(text, isError) {
  ui.bridge.textContent = text;
  ui.bridge.className = isError ? "bridge error" : "bridge";
}

function errText(e) {
  return e && e.message ? e.message : String(e);
}
