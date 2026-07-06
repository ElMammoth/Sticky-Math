# Sticky Math

Plugin UXP pour Adobe InDesign 2026 : saisie LaTeX, aperçu MathJax en direct, insertion de la formule en objet ancré inline calé sur la baseline, avec contrôle du corps et de l'échelle.

Contrainte fondatrice : WYSIWYG strict. Le SVG affiché dans l'aperçu est exactement celui qui est placé dans le document. Un seul rendu, aucun second moteur. Détails dans CLAUDE.md et docs/adr/0001-moteur-de-rendu.md.

## Prérequis

- macOS, Adobe InDesign 2026 (v21.0.0.192 ou plus récent).
- UXP Developer Tool (UDT), installable depuis Creative Cloud Desktop.

## Charger le plugin en développement

1. Ouvrir InDesign 2026.
2. Ouvrir l'UXP Developer Tool.
3. Add Plugin, puis sélectionner `plugin/manifest.json`.
4. Dans la ligne du plugin : Load. Le panneau « Sticky Math » apparaît dans InDesign.
5. Pour itérer : Actions > Reload après chaque modification des fichiers.

## Utilisation

1. Ouvrir un document, placer le curseur texte à l'endroit voulu.
2. Taper du LaTeX dans le champ du panneau, l'aperçu se met à jour.
3. Régler le corps en pt (bouton « Depuis le curseur » pour reprendre la taille du texte courant) et l'échelle en pourcentage.
4. Cliquer sur « Insérer au curseur » : la formule est placée en rectangle ancré inline, assise sur la baseline grâce à la profondeur renvoyée par MathJax.

La source LaTeX, le corps, l'échelle et la profondeur sont stockés dans le label de l'objet placé en vue de la ré-édition (fonctionnalité à venir, voir TODO.md).

## Structure

- `plugin/` : le plugin chargeable (manifest v5, panneau, webview de rendu, MathJax vendorisé).
- `docs/` : ADR et rapport d'environnement.
- `spikes/` : explorations conservées pour référence (option A : MathJax headless).

## Hors ligne

Aucune dépendance réseau au runtime : MathJax est embarqué dans `plugin/webview/vendor/tex-svg-full.js`.
