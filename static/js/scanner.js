console.log("ZXingBrowser global object:", window.ZXingBrowser);

import { BrowserQRCodeReader } from '@zxing/browser';

const codeReader = new BrowserQRCodeReader();
let activeStream = null;
let videoEl = null;

const startBtn = document.getElementById("start-btn");
const scannerContainer = document.getElementById("scanner-container");
const message = document.getElementById("message");

startBtn.addEventListener("click", () => {
    console.log("👉 Start Scanner");
    startScanner();
});

async function startScanner() {
    console.log("🚀 Initializing scanner...");

    scannerContainer.style.display = "block";
    message.textContent = "Scanning...";

    codeReader = new BrowserMultiFormatReader();

    try {
        console.log("🎥 Requesting camera...");

        activeStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        videoEl = document.createElement("video");
        videoEl.setAttribute("playsinline", true);
        videoEl.setAttribute("webkit-playsinline", true);
        videoEl.muted = true; // REQUIRED for iOS autoplay

        videoEl.srcObject = activeStream;
        scannerContainer.appendChild(videoEl);

        await videoEl.play();

        console.log("▶️ Video playing");
        scanLoop(videoEl);

    } catch (err) {
        console.error("❌ Camera access error:", err);
        message.textContent = "Could not access camera.";
    }
}

async function scanLoop(video) {
    // iOS Safari needs a manual loop
    try {
        const result = await codeReader.decodeOnceFromVideoElement(video);

        if (result) {
            console.log("🎉 DECODED:", result.text);
            stopScanner();
            window.location.href = `/key/${result.text}`;
            return;
        }
    } catch (err) {
        if (err instanceof NotFoundException) {
            // No barcode found this frame — totally normal
        } else {
            console.error("⚠️ Decode error:", err);
        }
    }

    requestAnimationFrame(() => scanLoop(video));
}

function stopScanner() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
    }
    if (videoEl) {
        videoEl.srcObject = null;
    }
    scannerContainer.innerHTML = "";
}
