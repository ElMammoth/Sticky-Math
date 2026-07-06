# Spike option A : mathjax-full headless (liteAdaptor)

Objectif : vérifier si mathjax-full peut rendre du TeX en SVG sans DOM navigateur, dans une perspective d'exécution directe dans le runtime UXP.

## Résultats (2026-07-06, Node 22)

- `render.js` : le rendu TeX vers SVG fonctionne, avec les métriques de baseline (`vertical-align` en ex). Avec les options `em: 16, ex: 8`, la sortie est déterministe.
- `build.mjs` + `entry.js` : bundle esbuild de 2.68 Mo, format IIFE, plateforme neutral (aucun module Node requis), exécuté avec succès hors Node.
- Piège identifié : `mathjax-full/js/components/version.js` contient `var load = eval('require')`. UXP interdit eval. Contournement prouvé : substitution du module par `version-stub.js` via un plugin esbuild onResolve. Après substitution, plus aucun eval dans le bundle.

## Verdict

Techniquement viable pour du rendu headless, mais écarté comme moteur principal : l'aperçu devrait alors être affiché par le moteur HTML/SVG partiel d'UXP, ce qui viole la contrainte WYSIWYG du projet. Voir docs/adr/0001-moteur-de-rendu.md. Conservé comme piste pour du rendu par lots sans aperçu.

## Rejouer le spike

```
npm install mathjax-full@3 esbuild
node render.js "x^2 + y^2 = r^2"   # rendu direct, écrit out.svg
node build.mjs                      # bundle.js (IIFE, expose globalThis.texToSvg)
```
