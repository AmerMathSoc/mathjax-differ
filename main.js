/*
 *  main.js
 *
 *  Copyright (c) 2019 American Mathematical Society
 *
 */

 process.on('unhandledRejection', r => console.log(r));

const fs = require('fs');
const crypto = require('crypto');
const compareImages = require('resemblejs/compareImages');
const Jimp = require('jimp');

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
  await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 4 });
  await page.goto(
    'data:text/html, %3C!DOCTYPE%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice-width%22%3E%3Ctitle%3Etitle%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E'
  );
  await page.evaluate(
    s =>
      (document.body.innerHTML =
        '<span style="display:inline-flex; padding: 5px">' + //padding b/c v3 may be cut off
        s +
        '</span>'),
    svgstring
  );
  const svg = await page.$('span');
  const result = await svg.screenshot();
  await browser.close();
  // autocrop with JIMP
  const jimped = await Jimp.read(result);
  jimped.autocrop();
  return jimped.getBufferAsync('image/png');
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

const diff = async (texstring, format) => {
  const texstringhash = crypto
    .createHash('md5')
    .update(texstring)
    .digest('hex');

  let svg2 = {};
  let svg2sre = {};
  let svg3 = {};

  // run mj2
  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = format;
  svg2 = await mj2promise(mj2Input);
  if (svg2.errors) return new Error('mathjax error');
  // fs.writeFileSync(texstringhash + '-v2.svg', svg2.svg);

  // run mj2 + SRE enrichment
  const mj2sreInput = Object.assign({}, mjInputDefault);
  mj2sreInput.math = texstring;
  mj2sreInput.enrich = true;
  mj2sreInput.format = 'TeX';
  svg2sre = await mj2promise(mj2sreInput);
  // fs.writeFileSync(texstringhash + '-SRE.svg', svg2sre.svg);

  // run mj3
  const isDisplay = format === 'TeX';
  try {
    svg3.svg = await mj3(texstring, isDisplay);
  } catch (e) {
    console.log('mj3 error');
    return;
  }
  // fs.writeFileSync(texstringhash + '-v3.svg', svg3.svg);

  // svg2png
  const png2 = await svg2png(svg2.svg);
  const pngsre = await svg2png(svg2sre.svg);
  const png3 = await svg2png(svg3.svg);

  // diff
  const options = {
    scaleToSameSize: true,
    ignore: 'antialiasing'
  };
  const diff_2_sre = await compareImages(png2, pngsre, options);
  console.log('v2 vs SRE - Same dimension? ' + diff_2_sre.isSameDimensions);
  console.log('v2 vs SRE - Mismatch: ' + diff_2_sre.misMatchPercentage);
  const diff_2_3 = await compareImages(png2, png3, options);
  console.log('v2 vs v3 - Same dimension? ' + diff_2_3.isSameDimensions);
  console.log('v2 vs v3 - Mismatch: ' + diff_2_3.misMatchPercentage);

  // write output if mismatch
  if (diff_2_sre.misMatchPercentage > 1 || diff_2_3.misMatchPercentage > 1)
    fs.writeFileSync(texstringhash + '-v2.png', png2);
  if (diff_2_sre.misMatchPercentage > 1) {
    fs.writeFileSync(texstringhash + '-v2sre.png', pngsre);
    fs.writeFileSync(texstringhash + '-v2-v2sre.png', diff_2_sre.getBuffer());
  }
  if (diff_2_3.misMatchPercentage > 1) {
    fs.writeFileSync(texstringhash + '-v3.png', png3);
    fs.writeFileSync(texstringhash + '-v2-v3.png', diff_2_3.getBuffer());
  }
};

const main = async input => {
  if (!fs.existsSync(input)) {
    await diff(input, 'TeX');
    return;
  }
  const eqnStore = JSON.parse(fs.readFileSync(input).toString());
  for (let key in eqnStore) {
    const entry = eqnStore[key];
    console.log(entry['tex'], entry['format']);
    await diff(entry['tex'], entry['format']);
  }
};

// process CLI arguments
const input = process.argv[2];
main(input);
