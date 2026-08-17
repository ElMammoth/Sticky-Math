# Spike, option A: mathjax-full headless (liteAdaptor)

Goal: find out whether mathjax-full can render TeX to SVG without a browser DOM, with a view to
running it directly in the UXP runtime.

This code is **not used by the plugin** and is never imported by it. It is kept because
[ADR 0001](../../docs/adr/0001-rendering-engine.md) rejects this approach, and that decision is only
credible with the experiment attached.

## Results (2026-07-06, Node 22)

- `render.js`: TeX to SVG rendering works, with baseline metrics (`vertical-align` in `ex`). With the
  options `em: 16, ex: 8`, output is deterministic.
- `build.mjs` + `entry.js`: a 2.68 MB esbuild bundle, IIFE format, neutral platform (no Node module
  required), executed successfully outside Node.
- Trap identified: `mathjax-full/js/components/version.js` contains `var load = eval('require')`, and
  UXP forbids `eval`. Workaround proven: substitute the module with `version-stub.js` through an
  esbuild `onResolve` plugin. After substitution there is no `eval` left in the bundle.

## Verdict

Technically viable for headless rendering, but rejected as the main engine: the preview would then have
to be displayed by UXP's partial HTML/SVG engine, which violates the project's WYSIWYG constraint. See
[ADR 0001](../../docs/adr/0001-rendering-engine.md). Kept as a lead for batch rendering, where no
preview is needed.

## Replaying the spike

```sh
npm install mathjax-full@3 esbuild
node render.js "x^2 + y^2 = r^2"   # direct render, writes out.svg
node build.mjs                     # bundle.js (IIFE, exposes globalThis.texToSvg)
```
