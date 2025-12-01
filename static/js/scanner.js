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
            constraints: { facingMode: "environment" }
        },
        decoder: {
            readers: ["code_128_reader", "code_39_reader"]
        }
    }, function(err) {
        if (err) {
            console.error(err);
            message.textContent = "Camera unavailable.";
            return;
        }

        Quagga.start();
        scannerRunning = true;
    });

    Quagga.onDetected(onDetected);
}

function onDetected(result) {
    const code = result.codeResult.code;

    Quagga.stop();
    scannerRunning = false;

    window.location.href = `/key/${code}`;
}
