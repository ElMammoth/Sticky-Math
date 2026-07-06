/*
 * Configuration MathJax, chargee AVANT vendor/tex-svg-full.js.
 * Fichier externe plutot que script inline : certains contextes webview
 * bloquent les scripts inline, et cette config est indispensable.
 */

window.MathJax = {
  svg: { fontCache: "none" },
  /*
   * Pas de MathML assistif : sans la feuille de style globale de
   * MathJax (jamais injectee avec typeset: false), il serait rendu
   * nativement par Chromium et dupliquerait visuellement la formule.
   * Le reglage du menu contextuel doit aussi etre coupe, sinon il
   * reactive l'extension par dessus enableAssistiveMml.
   */
  options: {
    enableAssistiveMml: false,
    enableMenu: false,
    menuOptions: { settings: { assistiveMml: false } }
  },
  startup: { typeset: false }
};

/* Diagnostics visibles dans la page, independants du pont de messages. */
var stickyBootHasError = false;
function stickyBoot(text, isError) {
  var el = document.getElementById("boot");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#b00020" : "#666666";
  stickyBootHasError = !!isError;
}

/* Echec de chargement d'une ressource (ex : vendor/tex-svg-full.js). */
window.addEventListener(
  "error",
  function (event) {
    if (event.target && event.target.tagName === "SCRIPT") {
      stickyBoot("Échec de chargement du script : " + (event.target.src || "?"), true);
    } else if (event.message && !stickyBootHasError) {
      /* ne pas ecraser un diagnostic precis par un "Script error." generique */
      stickyBoot("Erreur : " + event.message, true);
    }
  },
  true
);
