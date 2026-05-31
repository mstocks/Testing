# UPC Scanner

A lightweight, mobile-first barcode/UPC scanner built with **plain HTML, CSS, and
JavaScript** — no frameworks or build step. It scans a product barcode with the
device camera and looks it up against the
[Open Food Facts](https://world.openfoodfacts.org/) database.

## Features

- 📷 Live camera scanning using the native [`BarcodeDetector`](https://developer.mozilla.org/docs/Web/API/BarcodeDetector) API
- ⌨️ Manual barcode entry fallback for unsupported browsers
- 🔎 Product lookup via `https://world.openfoodfacts.net/api/v2/product/{barcode}`
- 📱 Mobile-first responsive UI with a scanning reticle and haptic feedback
- 🏷️ Shows product name, brand, image, quantity, Nutri-Score, NOVA group, and categories

## Usage

Because the camera (`getUserMedia`) requires a **secure context**, serve the files
over HTTPS or `localhost` — opening `index.html` directly from the filesystem
won't grant camera access in most browsers.

```bash
# from the project directory
python3 -m http.server 8000
# then open http://localhost:8000 on your phone or desktop
```

Tap **Start camera**, point it at a barcode, and the product details appear.
If live scanning isn't supported, type the barcode into the manual field and
tap **Look up**.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Mobile-first styling |
| `app.js` | Camera scanning + API lookup logic |

## Browser support

Live scanning relies on the `BarcodeDetector` API (Chrome/Edge/Android, and
Safari behind a flag). On unsupported browsers the app automatically falls back
to manual entry.
