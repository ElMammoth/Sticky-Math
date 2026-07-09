/*
 * Sticky Math : panneau UXP pour InDesign 2026.
 *
 * Contrainte WYSIWYG : le SVG affiché dans la webview d'aperçu est
 * exactement celui qui est écrit sur disque puis placé dans InDesign.
 * Seule transformation autorisée : la réécriture des attributs
 * width/height (ex vers pt), conversion d'unités, pas de re-rendu.
 * Voir docs/adr/0001-moteur-de-rendu.md.
 *
 * Ce fichier ne fait que le câblage de l'interface :
 * - liaison webview surveillée : lib/webview-link.js ;
 * - accès au DOM InDesign (synchrone) : lib/indesign.js ;
 * - préférences persistantes et écriture des SVG : lib/prefs.js.
 */

const { entrypoints } = require("uxp");
const { createWebviewLink, WEBVIEW_SRC } = require("./lib/webview-link.js");
const prefs = require("./lib/prefs.js");
const indesign = require("./lib/indesign.js");

entrypoints.setup({ panels: { stickyMathPanel: { show() {} } } });

let ui = null; // references DOM, remplies une fois a DOMContentLoaded
let link = null;
let lastRender = null; // dernier message "rendered" de la webview
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
      /* a chaque (re)connexion, re-rendre l'etat courant : couvre le
         demarrage ET les rechargements silencieux de la webview */
      if (ui.tex.value.trim()) requestRender();
    },
    onLost() {
      /* lastRender reste valide : l'insertion ne depend pas de la liaison */
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
      /* toujours une chaine numerique propre : sp-textfield affiche
         "nan" si on lui pousse autre chose */
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

/* ---------- liaison webview ---------- */

function replaceWebview() {
  const old = document.getElementById("renderer");
  const fresh = document.createElement("webview");
  fresh.id = "renderer";
  fresh.setAttribute("src", WEBVIEW_SRC);
  old.parentNode.replaceChild(fresh, old);
  return fresh;
}

/* La ligne d'etat de liaison n'apparait qu'en cas de probleme :
   en fonctionnement normal, le panneau reste muet. */
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

/* ---------- rendu ---------- */

function requestRender() {
  const tex = ui.tex.value.trim();
  if (!tex) {
    lastRender = null;
    ui.insert.disabled = true;
    if (link.isReady()) link.send({ type: "clear" });
    return;
  }
  /* liaison coupee : le rendu sera relance par onConnected */
  if (!link.isReady()) return;
  /* le mode display est decide par les delimiteurs saisis ($$, \[ \]) */
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
   * Conversion des unités MathJax vers des points InDesign. Le SVG est
   * dimensionné en ex ; exEm est le rapport ex/em mesuré par la
   * webview. 1 em = corps * échelle, en pt.
   */
  const emPt = corps * (scalePct / 100);
  const exPt = lastRender.exEm * emPt;
  const widthPt = lastRender.widthEx * exPt;
  const heightPt = lastRender.heightEx * exPt;
  const depthPt = lastRender.depthEx * exPt;

  /* Seule retouche du SVG : dimensions physiques en pt. */
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
   * Le point d'insertion est resolu DANS insertFormula, apres les
   * await : aucune reference DOM InDesign ne traverse d'asynchrone.
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

  /* succes silencieux : seuls les avertissements utiles s'affichent */
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

/* ---------- affichage ---------- */

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
