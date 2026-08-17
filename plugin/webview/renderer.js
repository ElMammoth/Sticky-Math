/*
 * Sticky Math render page (UXP webview).
 *
 * Receives { type: "render", tex, display } from the panel, renders with
 * MathJax in SVG output, displays the result (that is the preview), then
 * sends the panel the serialization of that same SVG node plus its
 * metrics. One render, one artifact: the WYSIWYG guarantee lives here.
 */

var preview = document.getElementById("preview");
var errBox = document.getElementById("err");
var renderSeq = 0;
var engineReady = false;

function boot(text, isError) {
  stickyBoot(text, isError); // defined in config.js
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
 * tex2svg expects bare TeX: enclosing LaTeX delimiters are stripped.
 * \[ \] and $$ $$ force display mode, \( \) and $ $ force inline mode.
 * With no delimiters, the mode requested by the panel applies.
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
   * Font for \text{} segments: their glyphs then come out as SVG <text>
   * carrying that family, measured by the webview's real engine.
   * Changeable on the fly without a reload: verified, the metrics stay
   * exact. Empty = MathJax's TeX font (the characters it does not cover,
   * accented ones in particular, already come out as <text> with the
   * serif fallback font).
   */
  MathJax.startup.document.outputJax.options.mtextFont = mtextFont || "";
  MathJax.startup.promise
    .then(function () {
      MathJax.texReset();
      MathJax.typesetClear();
      return MathJax.tex2svgPromise(tex, { display: !!display });
    })
    .then(function (node) {
      if (seq !== renderSeq) return; // a more recent render is in flight
      errBox.textContent = "";
      while (preview.firstChild) preview.removeChild(preview.firstChild);
      preview.appendChild(node); // the preview IS this node

      var svg = node.querySelector("svg");
      if (!svg) throw new Error("MathJax n'a pas produit de SVG");

      /* The ex/em ratio MathJax actually uses in this context. */
      var metrics = MathJax.getMetricsFor(preview, !!display);
      var exEm = metrics.ex / metrics.em;

      var widthEx = parseFloat(svg.getAttribute("width"));
      var heightEx = parseFloat(svg.getAttribute("height"));
      var styleAttr = svg.getAttribute("style") || "";
      var va = /vertical-align:\s*(-?[\d.]+)ex/.exec(styleAttr);
      var depthEx = va ? -parseFloat(va[1]) : 0;

      /* MathJax's error SVG (data-mjx-error) signals invalid LaTeX. */
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
      /* no stale preview left sitting next to an error message */
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
 * Panel messages arrive by postMessage and, as a fallback, through the
 * URL fragment (hashchange). Both channels can deliver the same
 * message: deduplication by sequence number.
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
  /* the panel's ping proves the panel to webview direction works; the
     answer reports which channel it arrived on so the panel knows
     whether postMessage works (and cuts the fallback channel if so) */
  if (msg.type === "ping") {
    pingCount++;
    boot(
      (engineReady ? "Moteur prêt. " : "Moteur en chargement. ") +
      "Ping n°" + pingCount + " reçu via " + via + "."
    );
    if (engineReady) send({ type: "ready", via: via });
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
      /* unreadable fragment: ignored */
    }
  }
}
window.addEventListener("hashchange", readHashMessage);

window.addEventListener("load", function () {
  /*
   * Careful: window.MathJax always exists (the config object placed by
   * config.js). Only startup.promise proves that the real MathJax has
   * loaded and replaced that config.
   */
  if (typeof MathJax === "undefined" || !MathJax.startup || !MathJax.startup.promise) {
    boot("MathJax n'est pas chargé (vendor/tex-svg-full.js manquant ou bloqué).", true);
    return;
  }
  MathJax.startup.promise.then(function () {
    engineReady = true;
    boot("Moteur prêt, en attente de saisie.");
    send({ type: "ready", via: "load" });
    /* a message already delivered through the hash while loading */
    readHashMessage();
  });
});

/* after being hidden or suspended, re-announce presence to the panel */
document.addEventListener("visibilitychange", function () {
  if (!document.hidden && engineReady) send({ type: "ready", via: "load" });
});
