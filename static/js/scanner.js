import { BrowserMultiFormatReader, NotFoundException } from '@zxing/browser';

const startBtn = document.getElementById("start-btn");
const scannerContainer = document.getElementById("scanner-container");
const message = document.getElementById("message");

let codeReader = null;
let activeStream = null;

startBtn.addEventListener("click", startScanner);

async function startScanner() {
    scannerContainer.style.display = "block";
    message.textContent = "Scanning...";

    codeReader = new BrowserMultiFormatReader();

    try {
        activeStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        const videoElement = document.createElement("video");
        videoElement.setAttribute("playsinline", true); // IMPORTANT for iPhone
        videoElement.srcObject = activeStream;
        scannerContainer.appendChild(videoElement);
        await videoElement.play();

        scanLoop(videoElement);

    } catch (err) {
        console.error("Camera error:", err);
        message.textContent = "Could not access camera.";
    }
}

async function scanLoop(video) {
    try {
        const result = await codeReader.decodeFromVideoElement(video);
        if (result) {
            console.log("Detected:", result.text);

            stopScanner();
            window.location.href = `/key/${result.text}`;
            return;
        }
    } catch (err) {
        if (!(err instanceof NotFoundException)) {
            console.error("Decode error:", err);
        }
    }

    // Keep scanning
    requestAnimationFrame(() => scanLoop(video));
}

function stopScanner() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
    }
    scannerContainer.innerHTML = "";
}
