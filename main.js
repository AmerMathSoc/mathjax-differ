process.on('unhandledRejection', r => console.log(r));

const fs = require('fs');
const crypto = require('crypto');
const compareImages = require('resemblejs/compareImages');

//
// MathJax v2 setup
//

// promise around mathjax-node-sre
const mj2 = require('mathjax-node-sre');
const mj2promise = async data =>
  new Promise(function(resolve, reject) {
    mj2.typeset(data, function(data) {
      // HACK we want a promise but handle errors ourselves
      if (false) reject(data.errors);
      else resolve(data);
    });
  });

// TODO add extensions
mj2.config({
  MathJax: {
    displayAlign: 'left',
    TeX: {
      TagSide: 'left'
    },
    SVG: {
      // font: 'STIX-Web',
      blacker: 0
    }
  }
});
mj2.start();

const mjInputDefault = {
  svg: true,
  mml: true,
  useGlobalCache: false,
  width: 0,
  ex: 7.52, // ex height to match Times
  speakText: true
};

//
// svg to png
//

const puppeteer = require('puppeteer');

const svg2png = async svgstring => {
  const browser = await puppeteer.launch();
  process.on('SIGINT', async () => {
    await browser.close();
    process.exit(1);
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
  await page.goto(
    'data:text/html, %3C!DOCTYPE%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice-width%22%3E%3Ctitle%3Etitle%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E'
  );
  await page.evaluate(
    s =>
      (document.body.innerHTML =
        '<span style="height: 1000px; width: 1000px; display:inline-flex; padding: 1px;">' +
        s +
        '</span>'),
    svgstring
  );
  const svg = await page.$('svg');
  const result = await svg.screenshot();
  await browser.close();
  return result;
};

//
// MathJax v3 setup
//

const TeX = require('mathjax3/mathjax3/input/tex.js').TeX;
const SVG = require('mathjax3/mathjax3/output/svg.js').SVG;
const HTMLDocument = require('mathjax3/mathjax3/handlers/html/HTMLDocument.js')
  .HTMLDocument;
const liteAdaptor = require('mathjax3/mathjax3/adaptors/liteAdaptor.js')
  .liteAdaptor;
const AllPackages = require('mathjax3/mathjax3/input/tex/AllPackages.js')
  .AllPackages;
const tex = new TeX({ packages: AllPackages, TagSide: 'left' });
const svg = new SVG({ exFactor: 0.47 });
const adaptor = liteAdaptor();
const html = new HTMLDocument('', adaptor, { InputJax: tex, OutputJax: svg });

// patches
// cf. https://github.com/mathjax/mathjax-v3/issues/184
top = true;
// cf https://github.com/mathjax/mathjax-v3/issues/186
const MmlMath = require('mathjax3/mathjax3/core/MmlTree/MmlNodes/math.js')
  .MmlMath;
MmlMath.defaults.indentalign = 'left';

const mj3 = (string, display, em = 16, ex = 7.52, cwidth = 0) => {
  const math = new html.options.MathItem(string, tex, display);
  math.setMetrics(em, ex, cwidth, 100000, 1);
  math.compile(html);
  math.typeset(html);
  return adaptor.innerHTML(math.typesetRoot);
};

const diff = async (texstring, format, mjversion) => {
  const texstringhash = crypto
    .createHash('md5')
    .update(texstring)
    .digest('hex');

  let svg1 = {};
  let svg2 = {};

  // run mj2
  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = format;
  svg1 = await mj2promise(mj2Input);
  if (svg1.errors) return new Error('mathjax error');
  fs.writeFileSync(texstringhash + '-v2.svg', svg1.svg);

  // run mj2 + SRE enrichment
  if (mjversion === 'v2sre') {
    const mj2sreInput = Object.assign({}, mjInputDefault);
    mj2sreInput.math = texstring;
    mj2sreInput.enrich = true;
    mj2sreInput.format = 'TeX';
    svg2 = await mj2promise(mj2sreInput);
    fs.writeFileSync(texstringhash + '-SRE.svg', svg2.svg);
  }

  // run mj3
  if (mjversion === 'v3') {
    const isDisplay = format === 'TeX';
    try {
      svg2.svg = await mj3(texstring, isDisplay);
    } catch (e) {
      console.log('mj3 error');
      return;
    }
    fs.writeFileSync(texstringhash + '-v3.svg', svg2.svg);
  }

  // svg2png
  const res1 = await svg2png(svg1.svg, texstringhash + '-v2.png');
  const res2 = await svg2png(svg2.svg);

  // diff
  const data = await compareImages(res1, res2, {});
  console.log('Same dimension? ' + data.isSameDimensions);
  console.log('Mismatch: ' + data.misMatchPercentage);
  if (data.misMatchPercentage < 1) return;

  // write output if mismatch
  fs.writeFileSync(texstringhash + '-v2.png', res1);
  fs.writeFileSync(texstringhash + '-' + mjversion + '.png', res2);
  fs.writeFileSync(texstringhash + 'v2-' + mjversion + '.png', data.getBuffer());
};

const main = async input => {
  if (!fs.existsSync(input)) {
    await diff(
      input,
      'TeX',
      'v3'
    );
    return;
  }
  const eqnStore = JSON.parse(fs.readFileSync(input).toString());
  for (let key in eqnStore) {
    if (key === 'globalsvg') continue;
    const entry = eqnStore[key];
    console.log(entry['tex'], entry['format']);
    await diff(
      entry['tex'],
      entry['format'],
      'v3'
    );
  }
};

// process CLI arguments
const input = process.argv[2];
main(input);
