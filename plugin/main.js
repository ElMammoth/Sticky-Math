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
const WEBVIEW_SRC = "plugin:/webview/renderer.html";

let webview = null;
let webviewReady = false;
let pendingRender = null;
let lastRender = null; // { tex, display, svg, widthEx, heightEx, depthEx, exEm }
let debounceTimer = null;
let msgSeq = 0;
let pingsSent = 0;
/*
 * Canal de secours : certains builds d'InDesign perdent les postMessage
 * du panneau vers la webview (bug connu de la 20.4, corrige en
 * 21.0.0.192). Quand les pings restent sans reponse, les messages
 * passent aussi par le fragment d'URL de la webview, que la page
 * ecoute via hashchange. Le sens webview vers panneau reste uxpHost.
 */
let hashFallback = false;

/*
 * Destination des SVG. Par defaut le dossier temporaire du plugin.
 * Quand l'utilisateur choisit un dossier, l'acces est conserve entre
 * les sessions via un jeton persistant UXP stocke en localStorage,
 * et les fichiers y restent jusqu'a suppression manuelle.
 */
const DEST_TOKEN_KEY = "sticky-math.destToken";
const DEST_PATH_KEY = "sticky-math.destPath";
let destFolder = null; // Entry dossier, ou null = temporaire

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

  const onWebviewMessage = (event) => {
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
      const firstReady = !webviewReady;
      webviewReady = true;
      if (pendingRender) {
        postToWebview(pendingRender);
        pendingRender = null;
      } else if (firstReady) {
        /* du LaTeX deja saisi pendant le demarrage : rendre maintenant */
        if (texInput.value.trim()) requestRender();
      }
      if (firstReady) {
        setBridge("Liaison webview : OK" + (hashFallback ? " (canal de secours actif : postMessage panneau vers webview muet)" : "") + ".");
      }
      return;
    }
    if (msg.type === "rendered") {
      lastRender = msg;
      insertBtn.disabled = false;
      /* la webview a pu forcer le mode via les delimiteurs saisis */
      displayInput.checked = msg.display;
      setStatus(
        (msg.stripped
          ? "Délimiteurs LaTeX retirés, mode " + (msg.display ? "display" : "inline") + " appliqué.\n"
          : "") +
        "Rendu prêt : " + msg.widthEx.toFixed(1) + " x " + msg.heightEx.toFixed(1) +
        " ex, profondeur " + msg.depthEx.toFixed(2) + " ex."
      );
      return;
    }
    if (msg.type === "error") {
      lastRender = null;
      insertBtn.disabled = true;
      setStatus("Erreur LaTeX : " + msg.message, true);
    }
  };
  /* selon les hotes UXP, l'evenement message arrive sur l'element ou sur window */
  webview.addEventListener("message", onWebviewMessage);
  window.addEventListener("message", onWebviewMessage);

  /*
   * Surveillance du demarrage de la webview. Le ping prouve le sens
   * panneau vers webview (la page affiche sa reception) ; le ready en
   * retour prouve le sens inverse. Sans ready au bout de 8 s, on
   * affiche un diagnostic plutot qu'un panneau silencieux.
   */
  const pingTimer = setInterval(() => {
    if (webviewReady) {
      clearInterval(pingTimer);
      return;
    }
    pingsSent++;
    if (pingsSent === 4 && !hashFallback) {
      hashFallback = true;
      setBridge("Liaison webview : postMessage sans réponse, bascule sur le canal de secours (hash)...");
    }
    sendToWebview({ type: "ping" });
  }, 1500);
  setTimeout(() => {
    if (!webviewReady) {
      setBridge(
        "Liaison webview : AUCUNE réponse, même par le canal de secours.\n" +
        "Lisez le texte affiché dans la zone d'aperçu :\n" +
        "- zone totalement vide : la webview n'a pas chargé renderer.html ;\n" +
        "- « Chargement du moteur... » : MathJax ne finit pas de charger ;\n" +
        "- « Moteur prêt... ping n°N reçu » : les messages du panneau arrivent, mais les réponses de la webview se perdent (sens webview vers panneau cassé) ;\n" +
        "- « Moteur prêt, en attente de saisie » sans mention de ping : rien n'atteint la webview.\n" +
        "Relevez aussi la version exacte d'InDesign (À propos, minimum 21.0.0.192).",
        true
      );
    }
  }, 8000);

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
    insertFormula().catch((e) => setStatus("Échec de l'insertion : " + (e && e.message ? e.message : e), true));
  });

  document.getElementById("chooseDest").addEventListener("click", () => {
    chooseDestFolder().catch((e) => setStatus("Choix du dossier impossible : " + (e && e.message ? e.message : e), true));
  });
  document.getElementById("resetDest").addEventListener("click", () => {
    destFolder = null;
    localStorage.removeItem(DEST_TOKEN_KEY);
    localStorage.removeItem(DEST_PATH_KEY);
    updateDestLabel();
    setStatus("Destination : dossier temporaire du plugin.");
  });

  restoreDestFolder();
});

function updateDestLabel() {
  const label = document.getElementById("destPath");
  if (destFolder) {
    label.textContent = destFolder.nativePath;
    label.title = destFolder.nativePath;
  } else {
    label.textContent = "Dossier temporaire du plugin (par défaut)";
    label.title = "";
  }
}

async function chooseDestFolder() {
  const folder = await uxpStorage.getFolder();
  if (!folder) return; // selection annulee
  const token = await uxpStorage.createPersistentToken(folder);
  localStorage.setItem(DEST_TOKEN_KEY, token);
  localStorage.setItem(DEST_PATH_KEY, folder.nativePath);
  destFolder = folder;
  updateDestLabel();
  setStatus("Destination des SVG : " + folder.nativePath);
}

/* Retrouve le dossier choisi lors d'une session precedente. */
async function restoreDestFolder() {
  const token = localStorage.getItem(DEST_TOKEN_KEY);
  if (!token) return;
  try {
    const entry = await uxpStorage.getEntryForPersistentToken(token);
    if (entry && entry.isFolder) {
      destFolder = entry;
      updateDestLabel();
      return;
    }
    throw new Error("entrée invalide");
  } catch (e) {
    localStorage.removeItem(DEST_TOKEN_KEY);
    const oldPath = localStorage.getItem(DEST_PATH_KEY);
    localStorage.removeItem(DEST_PATH_KEY);
    setStatus(
      "Le dossier de destination mémorisé" + (oldPath ? " (" + oldPath + ")" : "") +
      " n'est plus accessible. Retour au dossier temporaire ; re-choisissez une destination si besoin.",
      true
    );
  }
}

/* Nom de fichier horodate, lisible et sans collision. */
function svgFileName() {
  const d = new Date();
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  return (
    "sticky-math-" +
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) +
    "-" + pad(d.getMilliseconds(), 3) + ".svg"
  );
}

/*
 * Envoi brut vers la webview par les deux canaux. Le numero de sequence
 * permet a la page de dedupliquer quand postMessage ET le hash arrivent.
 */
function sendToWebview(msg) {
  msg.seq = ++msgSeq;
  const str = JSON.stringify(msg);
  try {
    webview.postMessage(str);
  } catch (e) {
    /* webview pas encore initialisee */
  }
  if (hashFallback) {
    try {
      webview.src = WEBVIEW_SRC + "#m=" + encodeURIComponent(str);
    } catch (e) {
      /* setter src indisponible : postMessage reste seul */
    }
  }
}

function postToWebview(msg) {
  if (!webviewReady) {
    if (msg.type === "render") pendingRender = msg;
    return;
  }
  sendToWebview(msg);
}

function setStatus(text, isError) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.className = isError ? "status error" : "status";
}

/* Etat de la liaison panneau/webview, affiche en permanence. */
function setBridge(text, isError) {
  const bridge = document.getElementById("bridge");
  bridge.textContent = text;
  bridge.className = isError ? "bridge error" : "bridge";
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

  /* destFolder est lu au moment de l'insertion : un changement de
     destination s'applique donc immediatement aux fichiers suivants */
  let file;
  try {
    const targetFolder = destFolder || (await uxpStorage.getTemporaryFolder());
    file = await targetFolder.createFile(svgFileName(), { overwrite: true });
    await file.write(svgText);
  } catch (e) {
    setStatus(
      "Impossible d'écrire dans " +
      (destFolder ? "« " + destFolder.nativePath + " »" : "le dossier temporaire") +
      " : " + (e && e.message ? e.message : e) +
      (destFolder ? "\nRe-choisissez un dossier de destination." : ""),
      true
    );
    return;
  }

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
      " pt, profondeur " + depthPt.toFixed(2) + " pt sous la baseline.\n" +
      "Fichier : " + file.name
    );
  } finally {
    app.scriptPreferences.measurementUnit = previousUnit;
  }
}
