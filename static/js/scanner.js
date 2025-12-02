console.log("ZXingBrowser global:", ZXingBrowser);

const { BrowserMultiFormatReader, NotFoundException } = ZXingBrowser;

console.log("📦 ZXing scanner script loaded");

const startBtn = document.getElementById("start-btn");
const scannerContainer = document.getElementById("scanner-container");
const message = document.getElementById("message");

let codeReader = null;
let activeStream = null;

console.log("🔧 Initializing event listeners...");

startBtn.addEventListener("click", () => {
    console.log("👉 Start Scanner button clicked");
    startScanner();
});

async function startScanner() {
    console.log("🚀 startScanner() triggered");

    scannerContainer.style.display = "block";
    message.textContent = "Scanning...";

    console.log("📦 Creating ZXing reader...");
    codeReader = new BrowserMultiFormatReader();

    try {
        console.log("🎥 Requesting camera (getUserMedia)...");
        
        activeStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        console.log("✅ Camera stream received:", activeStream);

        const videoElement = document.createElement("video");
        videoElement.setAttribute("playsinline", true); // iPhone requirement
        videoElement.srcObject = activeStream;

        console.log("🎞️ Created video element, attaching to DOM...");
        scannerContainer.appendChild(videoElement);

        console.log("▶️ Attempting to play video...");
        await videoElement.play();
        console.log("✅ Video is playing");

        console.log("🔍 Starting scanLoop...");
        scanLoop(videoElement);

    } catch (err) {
        console.error("❌ Camera error:", err);
        message.textContent = "Could not access camera.";
    }
}

async function scanLoop(video) {
    console.log("🔄 scanLoop() running...");

    try {
        const result = await codeReader.decodeFromVideoElement(video);
        if (result) {
            console.log("🎉 BARCODE DETECTED:", result.text);

            stopScanner();
            window.location.href = `/key/${result.text}`;
            return;
        }
    } catch (err) {
        if (err instanceof NotFoundException) {
            // Normal: no barcode in this frame
            console.log("⏳ Frame processed — no barcode found");
        } else {
            console.error("⚠️ Decode error:", err);
        }
    }

    // Keep scanning
    requestAnimationFrame(() => scanLoop(video));
}

function stopScanner() {
    console.log("🛑 Stopping scanner...");

    if (activeStream) {
        console.log("🔇 Stopping video tracks...");
        activeStream.getTracks().forEach(track => track.stop());
    }

    console.log("🧹 Clearing scanner container...");
    scannerContainer.innerHTML = "";
}
