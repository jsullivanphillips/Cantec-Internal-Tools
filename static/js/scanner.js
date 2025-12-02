const resultBox = document.getElementById("resultBox");
const noCameraMsg = document.getElementById("noCameraMsg");
const videoElem = document.getElementById("preview");

async function startScanner() {
    // Check for camera devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === "videoinput");

    if (videoInputs.length === 0) {
        noCameraMsg.style.display = "block";
        return;
    }

    // Create the barcode reader
    const codeReader = new ZXingBrowser.BrowserMultiFormatReader();

    try {
        await codeReader.decodeFromVideoDevice(
            null,      // auto-select camera
            videoElem, // video element
            (result, err) => {
                if (result) {
                    resultBox.textContent = "Scanned Barcode: " + result.text;
                }
            }
        );

    } catch (e) {
        console.error(e);
        noCameraMsg.textContent = "Camera initialization error.";
        noCameraMsg.style.display = "block";
    }
}

startScanner();
