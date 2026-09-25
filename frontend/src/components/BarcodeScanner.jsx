import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { formatPrice } from "../utils/formatters";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { cropRect, shouldTryHard } from "../utils/scanTuning";

// Pure-JS decoder (works via getUserMedia + canvas frame sampling), unlike
// the native BarcodeDetector API which Safari/iOS never implemented —
// scanning silently failed for any iPhone user.
const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
]);
// TRY_HARDER was once set on every frame. Measured, that cost ~10x per decode
// and dropped the loop to about 2 frames a second — which is what "scanning is
// incredibly slow" actually was. It is now a fallback pass only (see
// utils/scanTuning.js), so the common case runs fast and the awkward barcode
// still gets the exhaustive treatment.
const THOROUGH_HINTS = new Map(HINTS);
THOROUGH_HINTS.set(DecodeHintType.TRY_HARDER, true);

// zxing reports a held barcode many times a second. In continuous mode the
// same code inside this window is the same physical item still in frame, not
// a second one of it.
const DUPLICATE_MS = 1500;
const FEEDBACK_MS = 1400;

/**
 * @param onScan    called with the decoded text. In continuous mode it may
 *                  return (or resolve to) `{ ok, message }` to drive the
 *                  in-camera feedback banner.
 * @param continuous keep the camera running and keep accepting codes until
 *                  the cashier taps Done. Off by default: the add-product,
 *                  edit-product, inventory and stock-receiving call sites all
 *                  want a single code to fill a field.
 * @param summary   `{ count, total }` — running cart state shown while scanning.
 */
export default function BarcodeScanner({ onScan, onClose, continuous = false, summary }) {
  useEscapeKey(onClose);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | denied | unsupported
  const [feedback, setFeedback] = useState(null);   // { ok, message }

  // Kept in a ref so a new callback identity from the parent never tears down
  // and restarts the camera mid-scan.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });

  const lastRef = useRef({ code: null, at: 0 });
  const feedbackTimer = useRef(null);

  const showFeedback = useCallback((next) => {
    setFeedback(next);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    let rafId = null;
    let stream = null;

    // Two readers over one cropped canvas. zxing's own decodeFromConstraints
    // loop was decoding the entire 1080p frame with TRY_HARDER on every pass;
    // driving the loop here is what makes cropping and the fast/thorough split
    // possible at all.
    const fastReader = new BrowserMultiFormatReader(HINTS);
    const thoroughReader = new BrowserMultiFormatReader(THOROUGH_HINTS);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    let lastSuccessAt = performance.now();
    let lastTryHardAt = 0;

    async function handleResult(text) {
      lastSuccessAt = performance.now();

      if (continuous) {
        const now = Date.now();
        const { code, at } = lastRef.current;
        if (text === code && now - at < DUPLICATE_MS) return;
        lastRef.current = { code: text, at: now };
      } else {
        stopStream();
      }

      navigator.vibrate?.(40);
      const result = await onScanRef.current(text);
      if (continuous && !cancelled) {
        showFeedback(result ?? { ok: true, message: "Added" });
      }
    }

    function stopStream() {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    controlsRef.current = { stop: stopStream };

    function tick() {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const rect = cropRect(video.videoWidth, video.videoHeight);
      if (!rect) return;

      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
      ctx.drawImage(
        video,
        rect.x, rect.y, rect.width, rect.height,
        0, 0, rect.width, rect.height,
      );

      const now = performance.now();
      const thorough = shouldTryHard(now, lastSuccessAt, lastTryHardAt);
      if (thorough) lastTryHardAt = now;

      try {
        const result = (thorough ? thoroughReader : fastReader).decodeFromCanvas(canvas);
        if (result) handleResult(result.getText());
      } catch {
        // No barcode in this frame — the overwhelmingly common case, and not
        // an error worth logging once a second.
      }
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          // Still asking for a high-resolution stream: the crop keeps every
          // sensor pixel the barcode occupies, which is what resolves a small
          // barcode's bars. It is the decoding of the *rest* of the frame that
          // was wasteful, and that is now gone.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // Keep refocusing as the phone moves rather than focusing once at
          // stream start and going stale. Unsupported constraints are ignored,
          // not fatal.
          advanced: [{ focusMode: "continuous" }],
        },
      })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const video = videoRef.current;
        video.srcObject = s;
        video.play().catch(() => {});
        setStatus("scanning");
        rafId = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) setStatus("denied");
      });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(feedbackTimer.current);
      stopStream();
    };
    // Mount-only: the camera stream must outlive prop identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameColor = !feedback
    ? "border-white/80"
    : feedback.ok
    ? "border-green-400"
    : "border-red-400";

  return (
    <div className="fixed inset-0 z-60 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/70 shrink-0">
        <p className="text-white font-semibold text-sm">
          {continuous ? "Scan items" : "Scan Barcode"}
        </p>
        {continuous ? (
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bg-white text-gray-900 text-sm font-bold btn-press"
          >
            Done
          </button>
        ) : (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
          >×</button>
        )}
      </div>

      {(status === "denied" || status === "unsupported") ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
          <p className="text-white font-semibold">
            {status === "unsupported"
              ? "Barcode scanning not supported on this browser"
              : "Camera access denied"}
          </p>
          <p className="text-white/50 text-sm">Type the barcode number in the field instead</p>
          <button onClick={onClose} className="px-5 py-2 bg-white/20 text-white rounded-xl text-sm font-semibold">
            Close
          </button>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-64 h-32">
              <div className="absolute inset-0 rounded-lg"
                style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
              <div className={`absolute inset-0 border-2 rounded-lg transition-colors duration-200 ${frameColor}`} />
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-lg" />
              {status === "scanning" && !feedback && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/80 animate-bounce" />
              )}
            </div>
          </div>

          {/* Result of the last scan, without leaving the camera */}
          {feedback && (
            <div
              className={`absolute top-4 inset-x-4 rounded-xl px-4 py-2.5 text-center text-sm font-bold shadow-lg animate-fade-in ${
                feedback.ok ? "bg-green-500 text-white" : "bg-red-500 text-white"
              }`}
            >
              {feedback.message}
            </div>
          )}

          <p className="absolute bottom-24 inset-x-0 text-center text-white/70 text-sm">
            {status === "starting"
              ? "Starting camera…"
              : continuous
              ? "Keep scanning — tap Done when finished"
              : "Point at a barcode"}
          </p>

          {/* Running cart tally, so the cashier never has to close the camera
              to check what has gone in */}
          {continuous && summary && (
            <div className="absolute bottom-0 inset-x-0 bg-black/80 px-5 py-4 pb-safe flex items-center gap-3">
              <span className="flex items-center justify-center min-w-8 h-8 px-2 rounded-full bg-white/15 text-white text-sm font-bold shrink-0">
                {summary.count}
              </span>
              <span className="text-white/70 text-sm font-medium">
                {summary.count === 1 ? "item" : "items"}
              </span>
              <span className="flex-1 text-right text-white text-lg font-extrabold tabular-nums">
                {formatPrice(summary.total)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
