process.on('unhandledRejection', r => console.log(r));

const fs = require('fs')

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
  svgNode: true,
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
    await page.evaluate(s => (document.body.innerHTML = '<span style="height: 1000px; width:1000px; display:inline-flex; padding: 1px;">' + s + '</span>'), svgstring);
    const svg = await page.$('span');
    const result = await svg.screenshot();
    await browser.close();
    return result;
  };

const main = async texstring => {
  const mj2Input = Object.assign({}, mjInputDefault);
  mj2Input.math = texstring;
  mj2Input.format = 'TeX';
  const mj2out = await mjpromise(mj2Input);
  const res = await svg2png(mj2out.svg, 'mj2out.png');

  const mj2sreInput = Object.assign({}, mjInputDefault);
  mj2sreInput.math = texstring;
  mj2sreInput.enrich = true;
  mj2sreInput.format = 'TeX';
  const mj2sreout = await mjpromise(mj2sreInput);
  const resSRE = await svg2png(mj2sreout.svg, 'mj2sreout.png');

  const  pixelmatch = require('pixelmatch');
  const PNG = require('pngjs').PNG;
  const img1 = new PNG(res)
  const img2 = new PNG(resSRE)

  var diff = new PNG({width: 1000, height: 1000});
  const match = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {threshold: 0.1});
  console.log(match)
  diff.pack().pipe(fs.createWriteStream('diff.png'));
};

// process CLI arguments
const input = process.argv[2];
main(input);
