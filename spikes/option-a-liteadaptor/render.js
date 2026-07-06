// Spike A: mathjax-full + liteAdaptor, no browser DOM.
// Goal: confirm TeX -> SVG works headless, and inspect baseline (depth) metadata.
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: 'none' }); // inline glyph paths, no <defs>/<use> cache
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

const input = process.argv[2] || 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';
// em/ex: tell MathJax the metrics of the surrounding text.
// With ex = em/2 the "ex" unit in the output is exactly half the font size.
const node = doc.convert(input, { display: false, em: 16, ex: 8, containerWidth: 80 * 16 });
const html = adaptor.outerHTML(node);

// The result is wrapped in <mjx-container>; extract the <svg> element.
const m = html.match(/<svg[\s\S]*<\/svg>/);
const svgStr = m ? m[0] : '(no svg)';

const width = svgStr.match(/width="([^"]+)"/)?.[1];
const height = svgStr.match(/height="([^"]+)"/)?.[1];
const valign = svgStr.match(/vertical-align:\s*([-\d.]+)ex/)?.[1];

console.log(JSON.stringify({ width, height, verticalAlignEx: valign, svgBytes: svgStr.length }, null, 2));
console.log('--- first 400 chars of svg ---');
console.log(svgStr.slice(0, 400));
require('fs').writeFileSync('out.svg', svgStr);
