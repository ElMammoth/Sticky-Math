/*
 * MathJax configuration, loaded BEFORE vendor/tex-svg-full.js.
 * An external file rather than an inline script: some webview contexts
 * block inline scripts, and this config is indispensable.
 */

window.MathJax = {
  svg: { fontCache: "none" },
  /*
   * No assistive MathML: without MathJax's global stylesheet (never
   * injected when typeset: false), Chromium would render it natively and
   * visually duplicate the formula. The context menu setting has to be
   * switched off too, otherwise it re-enables the extension on top of
   * enableAssistiveMml.
   */
  options: {
    enableAssistiveMml: false,
    enableMenu: false,
    menuOptions: { settings: { assistiveMml: false } }
  },
  startup: { typeset: false }
};

/* Diagnostics visible in the page itself, independent of the message bridge. */
var stickyBootHasError = false;
function stickyBoot(text, isError) {
  var el = document.getElementById("boot");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#b00020" : "#666666";
  stickyBootHasError = !!isError;
}

/* Failure to load a resource (e.g. vendor/tex-svg-full.js). */
window.addEventListener(
  "error",
  function (event) {
    if (event.target && event.target.tagName === "SCRIPT") {
      stickyBoot("Échec de chargement du script : " + (event.target.src || "?"), true);
    } else if (event.message && !stickyBootHasError) {
      /* do not overwrite a precise diagnosis with a generic "Script error." */
      stickyBoot("Erreur : " + event.message, true);
    }
  },
  true
);
