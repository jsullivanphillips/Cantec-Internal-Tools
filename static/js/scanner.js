import Quagga from "quagga";

const startBtn = document.getElementById("start-btn");
const scannerContainer = document.getElementById("scanner-container");
const message = document.getElementById("message");

let scannerRunning = false;

startBtn.addEventListener("click", () => {
    if (!scannerRunning) {
        startScanner();
    }
});

function startScanner() {
    scannerContainer.style.display = "block";
    message.textContent = "Scanning...";

    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: scannerContainer,
            constraints: {
                facingMode: "environment" // back camera
            }
        },
        decoder: {
            readers: [
                "code_128_reader",
                "code_39_reader",
                "ean_reader",
                "ean_8_reader",
                "upc_reader",
                "upc_e_reader",
                "codabar_reader"
            ]
        },
        locate: true,
    }, function (err) {
        if (err) {
            console.error("Quagga init failed:", err);
            message.textContent = "Camera access denied or unavailable.";
            return;
        }

        Quagga.start();
        scannerRunning = true;
        console.log("Scanner started");
    });

    Quagga.onDetected(onDetected);
}

function onDetected(result) {
    const code = result.codeResult.code;

    console.log("Scanned:", code);
    message.textContent = `Scanned: ${code}`;

    // Stop the scanner to prevent multiple triggers
    Quagga.stop();
    scannerRunning = false;

    // Redirect to your website’s key page
    window.location.href = `/key/${code}`;
}
