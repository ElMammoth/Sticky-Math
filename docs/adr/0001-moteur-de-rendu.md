# ADR 0001 : moteur de rendu LaTeX vers SVG

Date : 2026-07-06
Statut : accepté

## Contexte

Sticky Math doit rendre du LaTeX en SVG une seule fois, ce rendu servant à la fois d'aperçu dans le panneau et d'objet inséré dans InDesign. C'est la contrainte WYSIWYG du projet : aucun second moteur ne doit retoucher l'expression entre l'aperçu et l'insertion.

Le runtime UXP n'est pas un navigateur complet. Deux options ont été évaluées pour exécuter MathJax :

- Option A : mathjax-full avec liteAdaptor, exécuté directement dans le JS du panneau (sans DOM navigateur).
- Option B : MathJax chargé dans un webview UXP (vrai environnement Chromium), rendu affiché dans la webview, SVG renvoyé au panneau via postMessage.

## Résultats des spikes

### Option A (liteAdaptor, headless)

Spike conservé dans `spikes/option-a-liteadaptor/`.

- Le rendu TeX vers SVG fonctionne sans DOM, avec les métriques de baseline (vertical-align en ex).
- Le bundle esbuild fait 2.68 Mo, sans dépendance Node, format IIFE, exécutable en JS pur.
- Point noir : `mathjax-full/js/components/version.js` contient `eval('require')`. UXP interdit eval. Contournable par un stub au bundling (prouvé dans le spike), mais cela montre que mathjax-full n'est pas pensé pour ce runtime et que d'autres surprises du même genre sont possibles.
- Point bloquant pour le WYSIWYG : même si le rendu headless marche, il faut ensuite AFFICHER l'aperçu dans le panneau. Le moteur HTML/SVG d'UXP est partiel (sous-ensemble non documenté précisément). L'aperçu passerait donc par un moteur d'affichage tiers, limité, différent de tout ce que verra l'utilisateur ailleurs. C'est une violation structurelle de la contrainte.

### Option B (webview UXP)

- UXP v8 (InDesign 2026) permet de charger du HTML local du dossier du plugin dans un webview (`allowLocalRendering: "yes"`, URL `plugin:/...`). Fonctionnement hors ligne garanti, MathJax est embarqué dans le plugin (`plugin/webview/vendor/tex-svg-full.js`).
- Le pont de messages fonctionne dans les deux sens avec `enableMessageBridge: "localAndRemote"`. Le bug postMessage plugin vers webview d'InDesign 20.4 est officiellement corrigé dans InDesign 2026 (v21.0.0.192 et suivants).
- La page `renderer.html` a été testée de bout en bout dans Chromium (même famille de moteur que le webview UXP) : handshake ready, rendu, extraction du SVG et des métriques (largeur, hauteur, profondeur en ex, rapport ex/em mesuré), chemin d'erreur pour LaTeX invalide.

## Décision

Option B : MathJax en sortie SVG dans un webview UXP.

Justification au regard de la contrainte WYSIWYG :

1. L'aperçu affiché et le SVG extrait sont littéralement le même nœud DOM. `renderer.js` insère le résultat de `tex2svgPromise` dans la page (c'est l'aperçu) puis sérialise ce même élément (`svg.outerHTML`) pour l'envoyer au panneau. Un rendu, un artefact.
2. L'aperçu est affiché par un vrai moteur Chromium, pas par le moteur HTML partiel d'UXP. La fidélité de l'aperçu est celle d'un navigateur.
3. Aucune dépendance réseau : MathJax est vendorisé dans le plugin.

L'option A reste documentée et son spike est conservé : elle pourrait servir plus tard pour du rendu par lots (ré-export de toutes les formules d'un document) où aucun aperçu n'est nécessaire.

## Conséquences et règles

- Le SVG qui sort de la webview est l'artefact canonique. La seule transformation autorisée avant écriture sur disque est la réécriture des attributs `width` et `height` (unités ex vers pt). C'est une conversion d'unités qui ne modifie ni le viewBox ni les tracés.
- `fontCache: "none"` est imposé : chaque glyphe est un path inline, sans `<defs>/<use>`, pour maximiser la compatibilité avec l'importateur SVG d'InDesign.
- Le rendu MathML natif d'InDesign n'est pas utilisé pour l'affichage final : ce serait un deuxième moteur (voir docs/rapport-environnement.md pour ce que permet cette API, conservée comme piste pour un futur mode optionnel texte éditable).
- Risque résiduel assumé : l'importateur SVG d'InDesign est le dernier maillon de la chaîne. Les sorties MathJax en paths inline sont du SVG très simple (paths, transform, viewBox), le risque de divergence est faible mais doit être vérifié visuellement lors du premier test dans InDesign.
