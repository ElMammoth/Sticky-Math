# Rapport d'environnement

Date : 2026-07-06

## Contexte de cette session

Cette session s'est déroulée dans un conteneur Linux distant, sans InDesign ni UXP Developer Tool installés. Les versions exactes de votre poste doivent donc être relevées sur votre Mac (procédure ci-dessous). Tout ce qui était vérifiable hors application l'a été :

- rendu MathJax headless (spike option A) validé sous Node 22 ;
- page de rendu webview validée de bout en bout dans Chromium (handshake, rendu, métriques, erreurs) ;
- bundle option A validé sans eval et sans dépendance Node.

## Versions cibles (d'après la documentation Adobe)

| Élément | Valeur |
|---|---|
| InDesign | 2026, v21.x |
| UXP | v8 (webview local, protocole plugin:) |
| Manifest | version 5 |
| Host id du manifest | "ID", minVersion "21.0" |

Points de plateforme confirmés par la documentation et les forums Adobe :

- UXP v8 permet de charger du HTML local (dossiers plugin, plugin-data, plugin-temp) dans un webview via `requiredPermissions.webview.allowLocalRendering: "yes"`. Avant UXP v8, seul le contenu distant était accepté.
- La communication bidirectionnelle panneau/webview exige `enableMessageBridge: "localOnly"` ou `"localAndRemote"`. Côté panneau : `webview.postMessage()` et événement `message` sur l'élément webview. Côté page : `window.uxpHost.postMessage()` et événement `message` sur window.
- Bug connu : postMessage du plugin vers la webview cassé dans InDesign 20.4, corrigé officiellement dans InDesign 2026 (v21.0.0.192 et suivants). Notre cible v21 n'est pas concernée, mais vérifier que votre build est bien 21.0.0.192 ou plus récent.

## À relever sur votre poste (5 minutes)

1. InDesign : menu InDesign > À propos d'InDesign, noter la version complète (attendu : 21.x, au moins 21.0.0.192).
2. UXP Developer Tool : menu About, noter la version de l'UDT et la version d'UXP affichée pour InDesign une fois le plugin chargé.
3. Dans la console UDT du plugin chargé, exécuter `require("uxp").versions` et noter le résultat (version UXP exacte du runtime).
4. Vérifier que le panneau Sticky Math se charge et que l'aperçu s'affiche (voir README.md pour la procédure de chargement).

## API maths native d'InDesign (MathML par script)

InDesign 20 (2025) a introduit la prise en charge native de MathML. Élément piquant : le moteur de rendu interne d'InDesign pour ces objets est lui-même MathJax (source : Indiscripts, « InDesign 20 Goes to MathML », mars 2025).

Ce que permet l'API script (ExtendScript et UXP) :

- `Document.createFromMathML(mml, page, layer, [x, y])` : crée et place un MathObject à partir d'une chaîne MathML.
- `Rectangle.mathObjects.add(mml, ...)` : documenté mais incohérent en pratique (l'objet ne se parente pas correctement au rectangle cible d'après Indiscripts).
- Propriétés des MathObject : `mathmlDescription` (la source MathML), `appliedMathMLFontSize` (en points), `appliedMathMLSwatch`, `appliedMathMLRgbColor`, `tintValue`.
- Le Document expose `mathObjects` (collection) et des valeurs par défaut (`appliedMathMLFontSize`, etc.).

Limitations connues :

- API très lente (flux de données complexe entre le DOM InDesign et la couche UXP) ; les opérations en masse type `everyItem()` peuvent provoquer des erreurs fatales.
- Pas d'accès au SVG sous-jacent généré par InDesign.
- Pas d'accès aux transformations (rotation par script impossible).
- Le conteneur doit rester un Rectangle, sinon l'accès `mathObjects` casse et l'export devient peu fiable.

Conclusion pour Sticky Math : cette API confirme qu'un mode optionnel « texte éditable » via MathML natif est techniquement possible (conversion LaTeX vers MathML puis `createFromMathML`), mais elle introduirait un rendu que nous ne contrôlons pas et ne voyons pas dans l'aperçu. Elle reste hors du chemin par défaut, conformément à la contrainte WYSIWYG. Piste conservée dans TODO.md.

## Sources

- https://developer.adobe.com/indesign/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/indesign/uxp/reference/uxp-api/reference-js/Global%20Members/HTML%20Elements/HTMLWebViewElement/ (miroir Photoshop : https://adobedocs.github.io/uxp-photoshop/uxp-api/reference-js/Global%20Members/HTML%20Elements/HTMLWebViewElement/)
- https://indesign.uservoice.com/forums/913162-adobe-indesign-sdk-scripting-bugs-and-features/suggestions/50184291-uxp-indesign-webview-postmessage-does-not-work-i
- https://indiscripts.com/post/2025/03/indesign-20-goes-to-mathml-2
