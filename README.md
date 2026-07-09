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

## Installation permanente (.ccx)

Pour installer le plugin sans passer par l'UDT :

1. Dans l'UDT : Package, ce qui produit un fichier `.ccx` (un zip du dossier `plugin/`).
2. Double-cliquer sur le `.ccx` : Creative Cloud Desktop l'installe après un avertissement (plugin hors marketplace). Le plugin survit alors aux redémarrages d'InDesign.

Si Creative Cloud affiche « Compatible app required » :

- Vérifier que le manifest respecte strictement le schéma v5 : `host` doit être un OBJET (`{ "app": "ID", "minVersion": "21.0.0" }`, pas un tableau) et `minVersion` au format `x.y.z`. L'UDT charge un manifest laxiste, mais l'installateur Creative Cloud fait une correspondance stricte. Repackager après toute correction.
- Mettre à jour Creative Cloud Desktop (la prise en charge des plugins UXP InDesign est récente).
- Cause connue (forum Adobe) : décalage de langue entre Creative Cloud et l'application ; aligner la langue d'installation par défaut de Creative Cloud sur celle d'InDesign.
- Plan B avec messages d'erreur réels, l'installateur en ligne de commande UPIA :

```
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --list all
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "chemin/vers/Sticky Math_0.1.0.ccx"
```

`--list all` montre les applications que l'installateur connaît (InDesign doit y figurer) et `--install` affiche la raison exacte d'un refus. Ne pas copier les fichiers à la main dans les dossiers UXP : l'installation doit passer par Creative Cloud ou UPIA pour mettre à jour leur base de données.

## Utilisation

1. Ouvrir un document, placer le curseur texte à l'endroit voulu.
2. Taper du LaTeX dans le champ du panneau, l'aperçu se met à jour.
3. Régler le corps en pt (bouton « Depuis le curseur » pour reprendre la taille du texte courant) et l'échelle en pourcentage.
4. Cliquer sur « Insérer au curseur » : la formule est placée en rectangle ancré inline, assise sur la baseline grâce à la profondeur renvoyée par MathJax.
5. Police du texte : le champ « Police du texte (\text{...}) » applique une police de votre choix aux segments `\text{}` des formules (bouton « Du curseur » pour reprendre la police du texte courant dans InDesign). Vide, MathJax utilise ses polices TeX. La police choisie doit être disponible dans InDesign : ces segments sont insérés en texte SVG, pas en tracés.
6. Destination des SVG : par défaut, les fichiers vont dans le dossier temporaire du plugin. Le bouton « Choisir... » permet de définir n'importe quel dossier ; le choix est mémorisé entre les sessions (jeton persistant UXP), s'applique immédiatement aux insertions suivantes, et les fichiers y restent jusqu'à suppression manuelle. « Défaut » revient au dossier temporaire.

La source LaTeX, le corps, l'échelle et la profondeur sont stockés dans le label de l'objet placé en vue de la ré-édition (fonctionnalité à venir, voir TODO.md).

## Structure

- `plugin/` : le plugin chargeable (manifest v5, panneau, webview de rendu, MathJax vendorisé).
- `docs/` : ADR et rapport d'environnement.
- `spikes/` : explorations conservées pour référence (option A : MathJax headless).

## Hors ligne

Aucune dépendance réseau au runtime : MathJax est embarqué dans `plugin/webview/vendor/tex-svg-full.js`.
