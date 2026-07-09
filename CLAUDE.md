# Sticky Math

Plugin UXP pour Adobe InDesign 2026 (v21.x, UXP v8, macOS) : écrire du LaTeX dans un panneau, prévisualiser en direct, insérer la formule dans le texte à la position du curseur, en objet ancré inline calé sur la baseline.

## Contrainte non négociable : WYSIWYG strict

Ce qui est affiché dans l'aperçu est exactement ce qui est inséré, au vecteur près.

Règles qui en découlent, à ne jamais casser :

1. Le LaTeX est rendu UNE SEULE FOIS, en SVG, par MathJax dans la webview (`plugin/webview/renderer.js`). L'aperçu est ce nœud DOM ; le SVG inséré est la sérialisation de ce même nœud.
2. Aucun second moteur de rendu ne retouche l'expression. En particulier, le rendu MathML natif d'InDesign n'est PAS utilisé pour l'affichage final (voir docs/rapport-environnement.md pour ce que permet cette API, réservée à un éventuel futur mode optionnel texte éditable).
3. La seule transformation autorisée sur le SVG avant placement : réécrire les attributs `width` et `height` (ex vers pt) dans `plugin/main.js`. Conversion d'unités uniquement, jamais de modification du viewBox ni des tracés.
4. `fontCache: "none"` est imposé côté MathJax : glyphes mathématiques en paths inline, pas de `<defs>/<use>`, pour la compatibilité avec l'importateur SVG d'InDesign. Nuance assumée : les segments `\text{}` (et tout caractère absent des polices TeX, accents compris) sortent en éléments `<text>` SVG ; l'option « Police du texte » du panneau (`mtextFont` MathJax, modifiable à chaud) leur applique une famille choisie par l'utilisateur, qui doit exister côté InDesign. La fidélité de ces `<text>` à l'import InDesign est à vérifier visuellement.
5. Le CSS d'ajustement de l'aperçu ne doit cibler QUE le SVG racine (`#preview mjx-container > svg`) : les caractères extensibles (accolades de `\underbrace`, grands délimiteurs) sont des assemblages de `<svg>` imbriqués à dimensions explicites, qu'un `height: auto` global disloque.
5. La source LaTeX, le corps, l'échelle et la profondeur sont stockés à part (label JSON de l'objet placé) pour la ré-édition ; le visuel reste le SVG issu de l'aperçu.

## Architecture

Décision actée dans docs/adr/0001-moteur-de-rendu.md : MathJax en sortie SVG dans un webview UXP (option B). L'option A (mathjax-full headless dans le panneau) est écartée pour l'aperçu, spike conservé dans `spikes/option-a-liteadaptor/`.

Flux : saisie LaTeX dans le panneau, postMessage vers la webview, rendu MathJax affiché (aperçu), renvoi du SVG sérialisé plus métriques (widthEx, heightEx, depthEx, exEm) au panneau, réécriture des dimensions en pt, écriture du fichier SVG dans la destination active, placement InDesign.

Destination des SVG : dossier temporaire du plugin par défaut, ou dossier choisi par l'utilisateur (`localFileSystem: "request"`, sélecteur `getFolder`). L'accès au dossier choisi est conservé entre les sessions par jeton persistant UXP (`createPersistentToken` / `getEntryForPersistentToken`) stocké en localStorage avec le chemin d'affichage. Le dossier est relu à chaque insertion (changement de destination a effet immédiat) et les fichiers n'y sont jamais supprimés par le plugin.

Placement InDesign (`plugin/lib/indesign.js`) :

- règle de fiabilité absolue : aucune référence DOM InDesign ne traverse un `await` (référence invalidée = crash natif possible) ; le point d'insertion est résolu au moment de l'appel, après l'écriture du fichier, et toute la séquence est synchrone ;
- la séquence tourne dans `app.doScript(..., UndoModes.ENTIRE_SCRIPT)` : une transaction, un seul pas d'annulation (repli en exécution directe si doScript refuse une fonction) ;
- `insertionPoint.rectangles.add()` crée le rectangle ancré inline, puis `rect.place(cheminSvg)` et `fit(FRAME_TO_CONTENT)` ;
- baseline : `anchoredObjectSettings.anchorYoffset = -depthPt` où depthPt vient du `vertical-align` MathJax (profondeur sous la baseline) ; signe à confirmer visuellement au premier essai dans InDesign ;
- tableaux : une cellule en excès masque tout son contenu (cause des formules « disparues ») ; si l'insertion a lieu dans une cellule qui déborde et que la rangée ne grandit pas, `row.autoGrow` est activé dans la même transaction et annoncé dans le statut ; si l'excès persiste, avertissement ;
- unités forcées en points via `app.scriptPreferences.measurementUnit` (restaurées en finally) ;
- label : `rect.label` = JSON `{ app: "sticky-math", v, tex, display, corps, scalePct, depthEx, exEm, mtextFont }` et `rect.insertLabel("sticky-math:tex", tex)`.

Liaison panneau/webview (`plugin/lib/webview-link.js`) : machine d'état avec surveillance permanente, jamais « acquise ». Ping continu (1.5 s en établissement, 10 s en régime établi), liaison déclarée perdue après 2 pings muets puis rétablie automatiquement, re-rendu du contenu courant à chaque (re)connexion. Escalade en cas de silence : canal de secours par fragment d'URL (builds dont postMessage panneau vers webview est muet), coupé dès qu'un ping répond par postMessage, puis recréation de l'élément webview en dernier recours. La webview répond aux pings en indiquant le canal d'arrivée et se re-signale à la reprise de visibilité.

Conversion d'unités : le SVG MathJax est dimensionné en ex. Le rapport ex/em est MESURÉ par la webview (`MathJax.getMetricsFor`, environ 0.459, pas 0.5). taille en pt = valeurEx * exEm * corps * (échelle / 100).

## Structure du dépôt

- `plugin/` : le plugin UXP chargeable tel quel dans l'UXP Developer Tool (manifest v5). `main.js` ne fait que le câblage de l'interface ; la logique vit dans `plugin/lib/` (webview-link.js : liaison surveillée ; indesign.js : DOM InDesign, tout synchrone ; prefs.js : préférences persistantes et écriture des SVG).
- `plugin/webview/vendor/tex-svg-full.js` : MathJax 3 vendorisé (composant complet tex-svg), fonctionnement hors ligne. Ne pas remplacer par un chargement CDN.
- `docs/adr/` : décisions d'architecture, une par fichier, numérotées.
- `docs/rapport-environnement.md` : versions cibles, API MathML native, vérifications à faire sur le poste.
- `spikes/` : code exploratoire conservé pour référence, jamais importé par le plugin.

## Conventions

- Documentation en français, sans tiret cadratin.
- Code commenté en français, sobre : uniquement les contraintes non évidentes.
- Le panneau parle à la webview en JSON stringifié dans les deux sens (types de messages : render, clear, ready, rendered, error).
- Pas de dépendance réseau au runtime. Tout est embarqué dans `plugin/`.
- Tester la page webview hors InDesign : le harnais Playwright utilisé pour la validation est décrit dans le rapport d'environnement (stub de `window.uxpHost`, événements message simulés).

## État et suite

Le panneau minimal (saisie, aperçu, insertion ancrée avec baseline) est écrit et la partie rendu est validée dans Chromium. La première vérification dans InDesign réel reste à faire (voir la liste de contrôle du rapport d'environnement). Prochaines étapes dans TODO.md.
