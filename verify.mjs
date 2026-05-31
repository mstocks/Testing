// Headless verification of the UPC scanner. Not part of the app; run manually.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Resolve playwright whether it's installed locally or globally (set NODE_PATH
// to your global node_modules, e.g. `export NODE_PATH=$(npm root -g)`).
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.dirname(fileURLToPath(import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.join(root, decodeURIComponent(urlPath));
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
  fs.createReadStream(file).pipe(res);
});

const fail = (m) => {
  console.error("✗ " + m);
  process.exitCode = 1;
};
const pass = (m) => console.log("✓ " + m);

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// Mock the Open Food Facts endpoint so the test is deterministic & offline.
await page.route("**/api/v2/product/**", (route) => {
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: 1,
      product: {
        product_name: "Test Cola",
        brands: "TestBrand",
        quantity: "330 ml",
        categories: "Beverages",
        nutriscore_grade: "e",
        nova_group: 4,
        image_front_url: "",
      },
    }),
  });
});

await page.goto(base, { waitUntil: "networkidle" });

// 1. ZXing fallback library loaded.
const zxingLoaded = await page.evaluate(
  () => !!(window.ZXing && window.ZXing.BrowserMultiFormatReader)
);
zxingLoaded ? pass("ZXing fallback library loaded") : fail("ZXing did not load");

// 2. Theme: white background, green primary.
const theme = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    primary: cs.getPropertyValue("--primary").trim(),
    btn: getComputedStyle(document.getElementById("startBtn")).backgroundColor,
  };
});
theme.bg === "rgb(255, 255, 255)"
  ? pass("Background is white")
  : fail("Background not white: " + theme.bg);
theme.primary.toLowerCase() === "#16a34a"
  ? pass("Primary color is green (#16a34a)")
  : fail("Primary not green: " + theme.primary);
theme.btn === "rgb(22, 163, 74)"
  ? pass("Primary button renders green")
  : fail("Button not green: " + theme.btn);

// 3. Manual lookup flow renders the product.
await page.fill("#manualInput", "5449000000996");
await page.click('#manualForm button[type="submit"]');
await page.waitForSelector("#result:not([hidden])", { timeout: 5000 });

const result = await page.evaluate(() => ({
  title: document.querySelector(".result-title")?.textContent,
  brand: document.querySelector(".result-brand")?.textContent,
  hasBarcode: document.querySelector(".result").textContent.includes("5449000000996"),
  nutri: document.querySelector(".badge")?.textContent,
}));
result.title === "Test Cola"
  ? pass("Product name rendered")
  : fail("Bad product name: " + result.title);
result.brand === "TestBrand" ? pass("Brand rendered") : fail("Bad brand");
result.hasBarcode ? pass("Barcode shown in result") : fail("Barcode missing");
result.nutri === "E" ? pass("Nutri-Score badge rendered") : fail("Bad nutri badge");

// 4. "No product" path.
await page.unroute("**/api/v2/product/**");
await page.route("**/api/v2/product/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: 0 }),
  })
);
await page.fill("#manualInput", "0000000000000");
await page.click('#manualForm button[type="submit"]');
await page.waitForFunction(
  () => document.getElementById("status").textContent.includes("No product"),
  { timeout: 5000 }
);
pass("Not-found path shows a friendly message");

// 5. Full-screen scanning layout (toggle the class the app applies while scanning).
const fsState = await page.evaluate(() => {
  document.body.classList.add("scanning");
  const w = document.querySelector(".video-wrap");
  const cs = getComputedStyle(w);
  const r = w.getBoundingClientRect();
  const state = {
    position: cs.position,
    fills:
      Math.round(r.width) === window.innerWidth &&
      Math.round(r.height) === window.innerHeight,
    manualHidden:
      getComputedStyle(document.querySelector(".manual")).display === "none",
  };
  document.body.classList.remove("scanning");
  return state;
});
fsState.position === "fixed"
  ? pass("Scanning view is fixed / full-screen")
  : fail("video-wrap not fixed: " + fsState.position);
fsState.fills ? pass("Video fills the viewport") : fail("Video does not fill viewport");
fsState.manualHidden
  ? pass("Page chrome hidden while scanning")
  : fail("Manual entry not hidden while scanning");

pageErrors.length === 0
  ? pass("No uncaught page errors")
  : fail("Page errors: " + pageErrors.join("; "));

await browser.close();
server.close();
console.log(process.exitCode ? "\nVERIFY FAILED" : "\nVERIFY PASSED");
