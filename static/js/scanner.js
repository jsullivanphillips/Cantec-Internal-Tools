import Quagga from "quagga";

const startBtn = document.getElementById("start-btn");
const scannerContainer = document.getElementById("scanner-container");
const message = document.getElementById("message");

let scannerRunning = false;

startBtn.addEventListener("click", () => {
    console.log("Start Scanner Clicked");
    if (!scannerRunning) startScanner();
});

function startScanner() {
    scannerContainer.style.display = "block";
    message.textContent = "Scanning...";

    Quagga.init({
        inputStream: {
            type: "LiveStream",
            target: scannerContainer,
            constraints: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "environment"
            }
        },
        locator: {
            patchSize: "medium",
            halfSample: true
        },
        numOfWorkers: 0,   // REQUIRED for iPhone
        frequency: 10,
        decoder: {
            readers: [
                "code_128_reader",
                "code_39_reader",
                "ean_reader",
                "upc_reader"
            ],
            multiple: false,
            singleChannel: false   // REQUIRED for iPhone
        },
        locate: true
    }, function(err) {
        if (err) {
            console.error("Quagga init error:", err);
            message.textContent = "Failed to start scanner.";
            return;
        }

        console.log("Quagga started on iPhone");
        Quagga.start();
        scannerRunning = true;

        // MUST be inside init callback for iPhone
        Quagga.onDetected(onDetected);
    });
}

function onDetected(result) {
    const code = result.codeResult.code;

    console.log("Detected:", code);

    Quagga.stop();
    scannerRunning = false;

    window.location.href = `/key/${code}`;
}
