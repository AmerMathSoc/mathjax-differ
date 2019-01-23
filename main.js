process.on('unhandledRejection', r => console.log(r));

const fs = require('fs');
const crypto = require('crypto');
const compareImages = require("resemblejs/compareImages");

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

mj2.config({
  paths: {
    //   'ams-macros': path.dirname(require.resolve('mathjax-ams-macros')),
    //   'amspatches': path.dirname(require.resolve('mathjax-amspatches')),
    //   'img': path.dirname(require.resolve('mathjax-img')),
    //   'xhref': path.dirname(require.resolve('mathjax-xhref'))
  },
  // extensions: 'TeX/boldsymbol, [ams-macros]/ams-macros, [amspatches]/amspatches, [img]/img, [xhref]/xhref',
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

const svg2png = async (svgstring) => {
    const browser = await puppeteer.launch();
    process.on('SIGINT', async () => {
      await browser.close();
      process.exit(1);
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
    await page.goto('data:text/html, %3C!DOCTYPE%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice-width%22%3E%3Ctitle%3Etitle%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E');
    await page.evaluate(s => (document.body.innerHTML = '<span style="height: 1000px; width: 1000px; display:inline-flex; padding: 1px;">' + s + '</span>'), svgstring);
    const svg = await page.$('svg');
    const result = await svg.screenshot();
    await browser.close();
    return result;
  };

// const diff_v2_SRE = async (texstring, format) => {
//   const texstringhash = crypto.createHash('md5').update(format+'%'+texstring).digest("hex");

//   const mj2Input = Object.assign({}, mjInputDefault);
//   mj2Input.math = texstring;
//   mj2Input.format = format;
//   const mj2out = await mj2promise(mj2Input);
//   if (mj2out.errors) return new Error('mathjax error')
//   const res = await svg2png(mj2out.svg, 'mj2out.png');

//   const mj2sreInput = Object.assign({}, mjInputDefault);
//   mj2sreInput.math = texstring;
//   mj2sreInput.enrich = true;
//   mj2sreInput.format = 'TeX';
//   const mj2sreout = await mj2promise(mj2sreInput);
//   const resSRE = await svg2png(mj2sreout.svg, 'mj2sreout.png');

//   const data = await compareImages(res, resSRE,{});
//   console.log('Same dimension? ' + data.isSameDimensions);
//   console.log('Mismatch: ' + data.misMatchPercentage);
//   if (data.misMatchPercentage < 1) return;
//   fs.writeFileSync(texstringhash+'-v2.png', res);
//   fs.writeFileSync(texstringhash+'-v2sre.png', resSRE);
//   fs.writeFileSync(texstringhash+'v2-v2sre.png', data.getBuffer());
// };


//
// MathJax v3 setup
//

const TeX = require('mathjax3/mathjax3/input/tex.js').TeX;
const SVG = require('mathjax3/mathjax3/output/svg.js').SVG;
const HTMLDocument = require('mathjax3/mathjax3/handlers/html/HTMLDocument.js').HTMLDocument;
const liteAdaptor = require('mathjax3/mathjax3/adaptors/liteAdaptor.js').liteAdaptor;

// cf https://github.com/mathjax/mathjax-v3/issues/186
const MmlMath = require('mathjax3/mathjax3/core/MmlTree/MmlNodes/math.js').MmlMath;
MmlMath.defaults.indentalign = 'left';

const AllPackages = require('mathjax3/mathjax3/input/tex/AllPackages.js').AllPackages;
const tex = new TeX({packages: AllPackages, TagSide: 'left'});
const svg = new SVG({exFactor: 0.47});
const adaptor = liteAdaptor();
const html = new HTMLDocument('', adaptor, {InputJax: tex, OutputJax: svg});
top = true;

const mj3 = (string, display, em = 16, ex = 7.52, cwidth = 0) => {
    const math = new html.options.MathItem(string, tex, display);
    math.setMetrics(em, ex, cwidth, 100000, 1);
    math.compile(html);
    math.typeset(html);
    return adaptor.innerHTML(math.typesetRoot);
};

// TODO merge with diff_v2_sre
const diff_v2_v3 = async (texstring, format) => {
  const texstringhash = crypto.createHash('md5').update(texstring).digest("hex");

  // run mj2
  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = format;
  const mj2out = await mj2promise(mj2Input);
  if (mj2out.errors) return new Error('mathjax error')
  fs.writeFileSync(texstringhash+'-v2.svg', mj2out.svg);

  // run mj3
  const isDisplay = (format === "TeX");
  let mj3out = '';
  try {
    mj3out = await mj3(texstring, isDisplay);
  }
  catch (e) {
    console.log('mj3 error');
    return;
  }
  fs.writeFileSync(texstringhash+'-v3.svg', mj3out);

  // svg2png
  const res2 = await svg2png(mj2out.svg, texstringhash+'-v2.png');
  const res3 = await svg2png(mj3out)

  // diff
  const data = await compareImages(res2, res3, {});
  console.log('Same dimension? ' + data.isSameDimensions);
  console.log('Mismatch: ' + data.misMatchPercentage);
  if (data.misMatchPercentage < 1) return;

  // write output if mismatch
  fs.writeFileSync(texstringhash+'-v2.png', res2);
  fs.writeFileSync(texstringhash+'-v3.png', res3);
  fs.writeFileSync(texstringhash+'v2-v3.png', data.getBuffer());
};

const main = async (input) => {
  if (!fs.existsSync(input)) {
    // await diff_v2_SRE(input.replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), entry["format"]);
    await diff_v2_v3(input.replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), 'TeX');
    return;
  }
  const eqnStore = JSON.parse(fs.readFileSync(input).toString());
  for (let key in eqnStore) {
    if (key === 'globalsvg') continue;
    const entry = eqnStore[key];
    console.log(entry["tex"], entry["format"]);
    // await diff_v2_SRE(entry["tex"].replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), entry["format"]);
    await diff_v2_v3(entry["tex"].replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), entry["format"]);
  }
}

// process CLI arguments
const input = process.argv[2];
main(input);
