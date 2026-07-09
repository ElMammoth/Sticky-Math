/*
 * Page de rendu Sticky Math (webview UXP).
 *
 * Reçoit { type: "render", tex, display } du panneau, rend avec MathJax
 * en sortie SVG, affiche le résultat (c'est l'aperçu), puis renvoie au
 * panneau la sérialisation du même nœud SVG plus ses métriques.
 * Un seul rendu, un seul artefact : la garantie WYSIWYG est ici.
 */

var preview = document.getElementById("preview");
var errBox = document.getElementById("err");
var renderSeq = 0;
var engineReady = false;

function boot(text, isError) {
  stickyBoot(text, isError); // defini dans config.js
}

function send(obj) {
  if (!window.uxpHost || typeof window.uxpHost.postMessage !== "function") {
    boot("Pont de messages indisponible (window.uxpHost absent). Vérifier enableMessageBridge dans le manifest et la version d'InDesign.", true);
    return;
  }
  try {
    window.uxpHost.postMessage(JSON.stringify(obj));
  } catch (e) {
    boot("Échec d'envoi vers le panneau : " + (e && e.message ? e.message : e), true);
  }
}

/*
 * tex2svg attend du TeX nu : les delimiteurs LaTeX englobants sont
 * retires. \[ \] et $$ $$ forcent le mode display, \( \) et $ $ le mode
 * inline. Sans delimiteurs, le mode demande par le panneau s'applique.
 */
function normalizeTex(raw, display) {
  var tex = raw.trim();
  var wrappers = [
    { open: /^\\\[/, close: /\\\]$/, display: true },
    { open: /^\$\$/, close: /\$\$$/, display: true },
    { open: /^\\\(/, close: /\\\)$/, display: false },
    { open: /^\$/, close: /\$$/, display: false },
  ];
  for (var i = 0; i < wrappers.length; i++) {
    var w = wrappers[i];
    if (w.open.test(tex) && w.close.test(tex.replace(w.open, ""))) {
      tex = tex.replace(w.open, "").replace(w.close, "").trim();
      return { tex: tex, display: w.display, stripped: true };
    }
  }
  return { tex: tex, display: !!display, stripped: false };
}

function render(rawTex, displayRequested, mtextFont) {
  var seq = ++renderSeq;
  var norm = normalizeTex(rawTex, displayRequested);
  var tex = norm.tex;
  var display = norm.display;
  /*
   * Police des segments \text{} : les glyphes sortent alors en <text>
   * SVG portant cette famille, mesures par le vrai moteur de la
   * webview. Modifiable a chaud sans rechargement : verifie, les
   * metriques restent exactes. Vide = police TeX de MathJax (les
   * caracteres qu'elle ne couvre pas, accents notamment, sortent deja
   * en <text> avec la police de secours serif).
   */
  MathJax.startup.document.outputJax.options.mtextFont = mtextFont || "";
  MathJax.startup.promise
    .then(function () {
      MathJax.texReset();
      MathJax.typesetClear();
      return MathJax.tex2svgPromise(tex, { display: !!display });
    })
    .then(function (node) {
      if (seq !== renderSeq) return; // un rendu plus récent est en cours
      errBox.textContent = "";
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      preview.appendChild(node); // l'aperçu EST ce nœud

      var svg = node.querySelector("svg");
      if (!svg) throw new Error("MathJax n'a pas produit de SVG");

      /* Rapport ex/em réellement utilisé par MathJax dans ce contexte. */
      var metrics = MathJax.getMetricsFor(preview, !!display);
      var exEm = metrics.ex / metrics.em;

      var widthEx = parseFloat(svg.getAttribute("width"));
      var heightEx = parseFloat(svg.getAttribute("height"));
      var styleAttr = svg.getAttribute("style") || "";
      var va = /vertical-align:\s*(-?[\d.]+)ex/.exec(styleAttr);
      var depthEx = va ? -parseFloat(va[1]) : 0;

      /* Le SVG d'erreur MathJax (data-mjx-error) signale un LaTeX invalide. */
      var errNode = svg.querySelector("[data-mjx-error]");
      if (errNode) {
        var message = errNode.getAttribute("data-mjx-error") || "expression invalide";
        errBox.textContent = message;
        send({ type: "error", message: message });
        return;
      }

      send({
        type: "rendered",
        tex: tex,
        display: display,
        stripped: norm.stripped,
        mtextFont: mtextFont || "",
        svg: svg.outerHTML,
        widthEx: widthEx,
        heightEx: heightEx,
        depthEx: depthEx,
        exEm: exEm,
      });
    })
    .catch(function (e) {
      if (seq !== renderSeq) return;
      var message = e && e.message ? e.message : String(e);
      /* pas d'apercu perime a cote d'un message d'erreur */
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      errBox.textContent = message;
      send({ type: "error", message: message });
    });
}

function clearPreview() {
  renderSeq++;
  errBox.textContent = "";
  while (preview.firstChild) preview.removeChild(preview.firstChild);
}

/*
 * Les messages du panneau arrivent par postMessage et, en secours, par
 * le fragment d'URL (hashchange). Les deux canaux peuvent livrer le
 * meme message : deduplication par numero de sequence.
 */
var seenSeqs = [];
var pingCount = 0;

function alreadySeen(seq) {
  if (seq === undefined || seq === null) return false;
  if (seenSeqs.indexOf(seq) !== -1) return true;
  seenSeqs.push(seq);
  if (seenSeqs.length > 50) seenSeqs.shift();
  return false;
}

function handleMessage(msg, via) {
  if (!msg || !msg.type) return;
  if (alreadySeen(msg.seq)) return;
  /* le ping du panneau prouve que le sens panneau vers webview marche */
  if (msg.type === "ping") {
    pingCount++;
    boot(
      (engineReady ? "Moteur prêt. " : "Moteur en chargement. ") +
      "Ping n°" + pingCount + " reçu via " + via + "."
    );
    if (engineReady) send({ type: "ready" });
    return;
  }
  if (msg.type === "render") {
    boot("");
    render(msg.tex, msg.display, msg.mtextFont);
  }
  if (msg.type === "clear") clearPreview();
}

function parseAndHandle(str, via) {
  var msg = str;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      return;
    }
  }
  handleMessage(msg, via);
}

window.addEventListener("message", function (event) {
  parseAndHandle(event.data, "postMessage");
});

function readHashMessage() {
  var h = window.location.hash;
  if (h && h.indexOf("#m=") === 0) {
    try {
      parseAndHandle(decodeURIComponent(h.slice(3)), "hash");
    } catch (e) {
      /* fragment illisible : ignore */
    }
  }
}
window.addEventListener("hashchange", readHashMessage);

window.addEventListener("load", function () {
  /*
   * Attention : window.MathJax existe toujours (objet de config pose par
   * config.js). Seul startup.promise prouve que le vrai MathJax a charge
   * et remplace la config.
   */
  if (typeof MathJax === "undefined" || !MathJax.startup || !MathJax.startup.promise) {
    boot("MathJax n'est pas chargé (vendor/tex-svg-full.js manquant ou bloqué).", true);
    return;
  }
  MathJax.startup.promise.then(function () {
    engineReady = true;
    boot("Moteur prêt, en attente de saisie.");
    send({ type: "ready" });
    /* message deja transmis par le hash pendant le chargement */
    readHashMessage();
  });
});
