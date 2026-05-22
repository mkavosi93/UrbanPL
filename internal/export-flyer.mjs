// Export flyer as JPG using puppeteer
// Run: node internal/export-flyer.mjs

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flyerPath = path.join(__dirname, '..', 'docs', 'BocaRaton_Tournament_Flyer.html');
const outputPath = path.join(__dirname, '..', 'docs', 'BocaRaton_Tournament_Flyer.jpg');

console.log('Launching browser...');
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
});
const page = await browser.newPage();

await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
await page.goto(`file:///${flyerPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 15000 });

// Wait for fonts and images to load
await new Promise(r => setTimeout(r, 2000));

await page.screenshot({
  path: outputPath,
  type: 'jpeg',
  quality: 95,
  fullPage: false,
  clip: { x: 30, y: 30, width: 816, height: 1056 },
});

await browser.close();
console.log(`✅ Flyer saved to: ${outputPath}`);
