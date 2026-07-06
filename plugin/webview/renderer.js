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

function send(obj) {
  window.uxpHost.postMessage(JSON.stringify(obj));
}

function render(tex, display) {
  var seq = ++renderSeq;
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
        display: !!display,
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
      errBox.textContent = message;
      send({ type: "error", message: message });
    });
}

function clearPreview() {
  renderSeq++;
  errBox.textContent = "";
  while (preview.firstChild) preview.removeChild(preview.firstChild);
}

window.addEventListener("message", function (event) {
  var msg = event.data;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch (e) {
      return;
    }
  }
  if (!msg || !msg.type) return;
  if (msg.type === "render") render(msg.tex, msg.display);
  if (msg.type === "clear") clearPreview();
});

window.addEventListener("load", function () {
  MathJax.startup.promise.then(function () {
    send({ type: "ready" });
  });
});
