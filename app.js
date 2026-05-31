/* UPC Scanner — camera barcode scanning + Open Food Facts lookup */
(function () {
  "use strict";

  var API_BASE = "https://world.openfoodfacts.net/api/v2/product/";
  // Fields we ask the API for, to keep the response small.
  var API_FIELDS =
    "code,product_name,brands,quantity,categories," +
    "image_front_url,nutriscore_grade,nova_group,ingredients_text";

  var video = document.getElementById("video");
  var startBtn = document.getElementById("startBtn");
  var stopBtn = document.getElementById("stopBtn");
  var manualForm = document.getElementById("manualForm");
  var manualInput = document.getElementById("manualInput");
  var statusEl = document.getElementById("status");
  var resultEl = document.getElementById("result");

  var stream = null; // stream we manage in the native path
  var detector = null; // native BarcodeDetector
  var zxingReader = null; // ZXing reader (fallback path)
  var scanning = false;
  var rafId = null;
  var lastCode = null;

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------- Capability checks ---------- */

  function supportsDetector() {
    return "BarcodeDetector" in window;
  }

  function supportsZxing() {
    return !!(window.ZXing && window.ZXing.BrowserMultiFormatReader);
  }

  /* ---------- Shared handlers ---------- */

  // Called by either scanning engine when a barcode is read.
  function onDetected(value) {
    if (!value || !scanning || value === lastCode) return;
    lastCode = value;
    if (navigator.vibrate) navigator.vibrate(120);
    stopCamera();
    lookup(value);
  }

  /* ---------- Camera scanning ---------- */

  async function startCamera() {
    resultEl.hidden = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera not available. Enter the barcode manually below.", true);
      return;
    }

    // Prefer the fast native API; fall back to ZXing (needed for iOS Safari).
    if (supportsDetector()) {
      await startNativeScan();
    } else if (supportsZxing()) {
      await startZxingScan();
    } else {
      setStatus(
        "Live scanning isn't supported in this browser. Enter the barcode manually below.",
        true
      );
    }
  }

  // Native BarcodeDetector path (Chrome / Edge / Android).
  async function startNativeScan() {
    try {
      detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
      });
    } catch (err) {
      setStatus("Could not start the barcode detector. Use manual entry.", true);
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      setStatus("Camera access was denied. Enter the barcode manually below.", true);
      return;
    }

    video.srcObject = stream;
    await video.play();

    scanning = true;
    lastCode = null;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    setStatus("Point the camera at a barcode…");
    nativeScanLoop();
  }

  async function nativeScanLoop() {
    if (!scanning) return;
    try {
      var codes = await detector.detect(video);
      if (codes && codes.length) {
        onDetected(codes[0].rawValue);
        if (!scanning) return; // onDetected stopped us on a hit
      }
    } catch (err) {
      /* transient detection errors are ignored; keep scanning */
    }
    rafId = requestAnimationFrame(nativeScanLoop);
  }

  // ZXing fallback path (iOS Safari and other browsers without BarcodeDetector).
  // ZXing manages getUserMedia and the video element itself.
  async function startZxingScan() {
    try {
      zxingReader = new window.ZXing.BrowserMultiFormatReader();
    } catch (err) {
      setStatus("Could not start the scanner. Use manual entry.", true);
      return;
    }

    scanning = true;
    lastCode = null;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    setStatus("Point the camera at a barcode…");

    try {
      await zxingReader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video,
        function (result, err) {
          if (result) onDetected(result.getText());
          // NotFoundException is emitted continuously while searching — ignore it.
        }
      );
    } catch (err) {
      setStatus("Camera access was denied. Enter the barcode manually below.", true);
      stopCamera();
    }
  }

  function stopCamera() {
    scanning = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (zxingReader) {
      try {
        zxingReader.reset(); // stops ZXing's camera stream
      } catch (err) {
        /* ignore */
      }
      zxingReader = null;
    }
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
    if (video.srcObject) {
      try {
        video.srcObject.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (err) {
        /* ignore */
      }
    }
    video.srcObject = null;

    detector = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
  }

  /* ---------- Product lookup ---------- */

  async function lookup(barcode) {
    barcode = String(barcode).trim();
    if (!/^\d{6,14}$/.test(barcode)) {
      setStatus("That doesn't look like a valid barcode.", true);
      return;
    }

    resultEl.hidden = true;
    setStatus("Looking up " + barcode + "…");

    var url =
      API_BASE + encodeURIComponent(barcode) + "?fields=" + encodeURIComponent(API_FIELDS);

    try {
      var res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      var data = await res.json();

      if (data.status === 0 || !data.product) {
        setStatus("No product found for " + barcode + ".", true);
        return;
      }
      setStatus("");
      renderProduct(barcode, data.product);
    } catch (err) {
      setStatus("Lookup failed: " + err.message + ". Check your connection.", true);
    }
  }

  /* ---------- Rendering ---------- */

  function gradeClass(grade) {
    var g = (grade || "").toLowerCase();
    return ["a", "b", "c", "d", "e"].indexOf(g) !== -1
      ? "grade-" + g
      : "grade-unknown";
  }

  function metaRow(label, value) {
    if (!value) return "";
    return (
      '<div class="meta-row"><span class="label">' +
      escapeHtml(label) +
      '</span><span class="value">' +
      value +
      "</span></div>"
    );
  }

  function renderProduct(barcode, p) {
    var name = p.product_name || "Unknown product";
    var brand = p.brands || "";
    var img = p.image_front_url || "";

    var nutri = p.nutriscore_grade
      ? '<span class="badge ' +
        gradeClass(p.nutriscore_grade) +
        '">' +
        escapeHtml(p.nutriscore_grade.toUpperCase()) +
        "</span>"
      : "";

    var nova = p.nova_group ? escapeHtml(String(p.nova_group)) : "";

    var html =
      '<div class="result-top">' +
      (img
        ? '<img class="result-img" src="' +
          escapeHtml(img) +
          '" alt="" loading="lazy" />'
        : "") +
      "<div>" +
      '<h2 class="result-title">' +
      escapeHtml(name) +
      "</h2>" +
      (brand ? '<p class="result-brand">' + escapeHtml(brand) + "</p>" : "") +
      "</div>" +
      "</div>" +
      '<div class="result-meta">' +
      metaRow("Barcode", escapeHtml(barcode)) +
      metaRow("Quantity", p.quantity ? escapeHtml(p.quantity) : "") +
      metaRow("Nutri-Score", nutri) +
      metaRow("NOVA group", nova) +
      metaRow("Categories", p.categories ? escapeHtml(p.categories) : "") +
      "</div>";

    resultEl.innerHTML = html;
    resultEl.hidden = false;
  }

  /* ---------- Events ---------- */

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", function () {
    stopCamera();
    setStatus("");
  });

  manualForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var value = manualInput.value.replace(/\D/g, "");
    if (!value) {
      setStatus("Please enter a barcode number.", true);
      return;
    }
    if (scanning) stopCamera();
    lookup(value);
  });

  // Clean up the camera when the page is hidden/closed.
  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && scanning) stopCamera();
  });
})();
