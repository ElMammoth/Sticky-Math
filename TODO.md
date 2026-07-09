# TODO

## Vérifications immédiates (premier chargement dans InDesign)

- [ ] Charger `plugin/` dans l'UXP Developer Tool sur le Mac (InDesign 2026 ouvert), vérifier que le panneau apparaît et que l'aperçu MathJax s'affiche dans la webview.
- [ ] Relever les versions demandées dans docs/rapport-environnement.md (InDesign, UDT, `require("uxp").versions`).
- [ ] Insérer une formule inline dans un paragraphe et vérifier le calage sur la baseline. Confirmer le SIGNE de `anchorYoffset` (plugin/main.js) : si la formule est décalée du mauvais côté, inverser en `+depthPt`.
- [ ] Vérifier visuellement la fidélité de l'importateur SVG d'InDesign sur une formule chargée (racine, fraction, exposants) : comparer à l'aperçu à fort zoom.
- [ ] Vérifier que le rectangle ancré n'a ni contour ni fond parasites.

## Prochaines étapes fonctionnelles

- [ ] Contrôle de taille fin : pré-remplissage automatique du corps depuis le curseur à l'ouverture et au changement de sélection (écouteur afterSelectionChanged), pas seulement via le bouton.
- [ ] Ré-éditabilité : détecter la sélection d'une formule existante (label sticky-math), recharger sa source dans le panneau, remplacer l'objet en place en conservant position et ancrage.
- [ ] Gestion baseline avancée : vérifier le comportement avec interlignage fixe, décalage vertical de texte, formules display ; exposer un réglage manuel de l'offset si nécessaire.
- [ ] Aperçu à l'échelle : refléter corps et échelle dans la taille d'affichage de l'aperçu (font-size du conteneur webview) pour juger l'harmonie optique avec le texte.
- [ ] UI Spectrum (composants sp-*), thème sombre du panneau et de la zone d'aperçu.
- [ ] Macros LaTeX utilisateur (préambule configurable passé à MathJax) et bibliothèque de formules récentes.
- [x] Destination des SVG choisie par l'utilisateur, persistante entre sessions, fichiers conservés jusqu'à suppression manuelle (le nettoyage automatique n'est plus souhaité).
- [ ] Option future : intégrer le SVG en données du document (embed du lien InDesign) pour les fichiers restés en dossier temporaire.
- [ ] Groupement d'annulation : envelopper l'insertion dans un seul pas d'undo (app.doScript avec UndoModes.ENTIRE_SCRIPT en UXPScript).
- [ ] Mode display vs inline : traitement typographique distinct (formule display en paragraphe dédié, centrage, espacement).
- [ ] Packaging .ccx et icônes définitives.

## Pistes ultérieures

- [ ] Mode optionnel « texte éditable » via l'API MathML native (Document.createFromMathML), clairement signalé comme sortant de la garantie WYSIWYG. Voir docs/rapport-environnement.md.
- [ ] Rendu par lots headless (spike option A) pour ré-exporter toutes les formules d'un document d'un coup.
- [ ] Export : vérifier le comportement des SVG placés à l'export PDF/X et à l'impression (aplatissement, surimpression du noir).
