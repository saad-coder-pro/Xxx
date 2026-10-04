/* worker.js — MediaPipe Hands in a Web Worker
   Runs inference off the main thread so the UI never stutters. */

/* ── Minimal DOM polyfill — MediaPipe expects browser globals ── */
if (typeof document === 'undefined') {
  self.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        const c = new OffscreenCanvas(1, 1);
        c.style = {};
        return c;
      }
      return { style: {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} };
    },
    createElementNS(ns, tag) { return self.document.createElement(tag); },
    currentScript: { src: '' },
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {}, removeChild() {} },
  };
  self.HTMLVideoElement  = self.HTMLVideoElement  || function () {};
  self.HTMLImageElement  = self.HTMLImageElement  || function () {};
  self.HTMLCanvasElement = self.HTMLCanvasElement || function () {};
}

/* ── Load MediaPipe Hands ── */
importScripts('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');

/* ── Create the model ── */
const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,             // 0 = Lite (faster), 1 = Full (more accurate)
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
  selfieMode: true,
});

/* ── Post landmarks back to the main thread ── */
hands.onResults((results) => {
  const h = [];
  if (results.multiHandLandmarks) {
    for (const lm of results.multiHandLandmarks) {
      // structured-clone-friendly plain objects
      h.push(lm.map(p => ({ x: p.x, y: p.y, z: p.z })));
    }
  }
  self.postMessage({ type: 'results', hands: h });
});

/* ── Frame queue — drop old frames if the model is busy ── */
let processing = false;
let pending = null;

async function handleFrame(bitmap) {
  if (processing) {
    // Model is still running; keep only the newest frame
    if (pending) pending.close();
    pending = bitmap;
    return;
  }
  processing = true;
  try {
    await hands.send({ image: bitmap });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  } finally {
    try { bitmap.close(); } catch (_) {}
    processing = false;
    if (pending) {
      const b = pending;
      pending = null;
      handleFrame(b);
    }
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'frame' && msg.bitmap) {
    handleFrame(msg.bitmap);
  } else if (msg.type === 'options' && msg.options) {
    try { hands.setOptions(msg.options); } catch (err) { console.warn(err); }
  }
};

/* Tell main thread we're ready to receive frames */
self.postMessage({ type: 'ready' });
