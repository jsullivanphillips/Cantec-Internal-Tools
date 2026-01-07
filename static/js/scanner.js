const resultBox = document.getElementById("resultBox");
const noCameraMsg = document.getElementById("noCameraMsg");
const videoElem = document.getElementById("preview");

let hasNavigated = false;

async function startScanner() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((d) => d.kind === "videoinput");

  if (videoInputs.length === 0) {
    noCameraMsg.style.display = "block";
    return;
  }

  const codeReader = new ZXingBrowser.BrowserMultiFormatReader();

  try {
    await codeReader.decodeFromVideoDevice(
      null,
      videoElem,
      async (result, err) => {
        if (!result || hasNavigated) return;

        const barcodeText = (result.text || "").trim();
        if (!barcodeText) return;

        hasNavigated = true;
        resultBox.textContent = "Scanned Barcode: " + barcodeText;

        // Stop scanning to prevent multiple triggers
        try {
          codeReader.reset();
        } catch (e) {
          // ignore
        }

        // Navigate to the key page
        window.location.href = `/keys/by-barcode/${encodeURIComponent(barcodeText)}`;
      }
    );
  } catch (e) {
    console.error(e);
    noCameraMsg.textContent = "Camera initialization error.";
    noCameraMsg.style.display = "block";
  }
}

startScanner();
