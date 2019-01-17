process.on('unhandledRejection', r => console.log(r));

const fs = require('fs');
const crypto = require('crypto');
const compareImages = require("resemblejs/compareImages");

// promise around mathjax-node-sre
const mj2 = require('mathjax-node-sre');
const mjpromise = async data =>
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
      font: 'STIX-Web',
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

// svg to png conversion using puppeteer (Chromium)
const puppeteer = require('puppeteer');
// ensure puppeteer shuts down Chrome if interrupted
process.on('SIGINT', async () => {
  await browser.close();
  process.exit(1);
});

// TODO unify with mj-json-render
const svg2png = async function(svgstring, outputFileName) {
    const browser = await puppeteer.launch();
    process.on('SIGINT', async () => {
      await browser.close();
      process.exit(1);
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
    await page.goto('data:text/html, %3C!DOCTYPE%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice-width%22%3E%3Ctitle%3Etitle%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E');
    // using CSS transforms to get a higher resolution
    await page.evaluate(s => (document.body.innerHTML = '<span style="height: 1000px; width: 1000px; display:inline-flex; padding: 1px;">' + s + '</span>'), svgstring);
    const svg = await page.$('svg');
    const result = await svg.screenshot();
    await browser.close();
    return result;
  };

const diff_v2_SRE = async (texstring, format) => {
  const texstringhash = crypto.createHash('md5').update(format+'%'+texstring).digest("hex");

  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = format;
  const mj2out = await mjpromise(mj2Input);
  if (mj2out.errors) return new Error('mathjax error')
  const res = await svg2png(mj2out.svg, 'mj2out.png');

  const mj2sreInput = Object.assign({}, mjInputDefault);
  mj2sreInput.math = texstring;
  mj2sreInput.enrich = true;
  mj2sreInput.format = 'TeX';
  const mj2sreout = await mjpromise(mj2sreInput);
  const resSRE = await svg2png(mj2sreout.svg, 'mj2sreout.png');

  const data = await compareImages(res, resSRE,{});
  console.log('Same dimension? ' + data.isSameDimensions);
  console.log('Mismatch: ' + data.misMatchPercentage);
  if (data.misMatchPercentage < 1) return;
  fs.writeFileSync(texstringhash+'-v2.png', res);
  fs.writeFileSync(texstringhash+'-v2sre.png', resSRE);
  fs.writeFileSync(texstringhash+'v2-v2sre.png', data.getBuffer());
};

const TeX = require('mathjax3/mathjax3/input/tex.js').TeX;
const SVG = require('mathjax3/mathjax3/output/svg.js').SVG;
const HTMLDocument = require('mathjax3/mathjax3/handlers/html/HTMLDocument.js').HTMLDocument;
const liteAdaptor = require('mathjax3/mathjax3/adaptors/liteAdaptor.js').liteAdaptor;

const AllPackages = require('mathjax3/mathjax3/input/tex/AllPackages.js').AllPackages;
const tex = new TeX({packages: AllPackages});
const svg = new SVG();
const adaptor = liteAdaptor();
const html = new HTMLDocument('', adaptor, {InputJax: tex, OutputJax: svg});
top = true;

const mj3 = (string, display, em = 16, ex = 7.52, cwidth = 0) => {
    const math = new html.options.MathItem(string, tex, display);
    math.setMetrics(em, ex, cwidth, 100000, 1);
    math.compile(html);
    math.typeset(html)
    return adaptor.outerHTML(math.typesetRoot);
};

// TODO merge into one function with options for comparison
const diff_v2_v3 = async (texstring, format) => {
  const texstringhash = crypto.createHash('md5').update(texstring).digest("hex");

  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = format;
  const mj2out = await mjpromise(mj2Input);
  if (mj2out.errors) return new Error('mathjax error')
  const res = await svg2png(mj2out.svg, texstringhash+'-v2.png');
  fs.writeFileSync(texstringhash+'-v2.png', res);

  const isDisplay = (format === "TeX");
  let mj3out = '';
  try {
    mj3out = await mj3(texstring, isDisplay);
  }
  catch (e) {
    console.log('mj3 error');
    return;
  }
  const res3 = await svg2png(mj3out)

  const data = await compareImages(res, res3, {});
  console.log('Same dimension? ' + data.isSameDimensions);
  console.log('Mismatch: ' + data.misMatchPercentage);
  if (data.misMatchPercentage < 1) return;
  fs.writeFileSync(texstringhash+'-v2.png', res);
  fs.writeFileSync(texstringhash+'-v3.png', res3);
  fs.writeFileSync(texstringhash+'v2-v3.png', data.getBuffer());
};

const main = async (input) => {
  const eqnStore = JSON.parse(fs.readFileSync(input).toString());
  for (let key in eqnStore) {
    if (key === 'globalsvg') continue;
    const entry = eqnStore[key];
    console.log(entry["tex"], entry["format"]);
    await diff_v2_SRE(entry["tex"].replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), entry["format"]);
    // await diff_v2_v3(entry["tex"].replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<'), entry["format"]);
  }
}

// process CLI arguments
const input = process.argv[2];
main(input);
