import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

// Pure-JS decoder (works via getUserMedia + canvas frame sampling), unlike
// the native BarcodeDetector API which Safari/iOS never implemented —
// scanning silently failed for any iPhone user.
const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
]);

export default function BarcodeScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | denied | unsupported

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    const reader = new BrowserMultiFormatReader(HINTS);

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result) => {
          if (cancelled || !result) return; // no barcode in frame yet — expected, not an error
          controlsRef.current?.stop();
          navigator.vibrate?.(40);
          onScan(result.getText());
        },
      )
      .then((controls) => {
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        setStatus("scanning");
      })
      .catch(() => {
        if (!cancelled) setStatus("denied");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-60 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/70 shrink-0">
        <p className="text-white font-semibold text-sm">Scan Barcode</p>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white text-lg"
        >×</button>
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
              <div className="absolute inset-0 border-2 border-white/80 rounded-lg" />
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-lg" />
              {status === "scanning" && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/80 animate-bounce" />
              )}
            </div>
          </div>
          <p className="absolute bottom-10 inset-x-0 text-center text-white/70 text-sm">
            {status === "starting" ? "Starting camera…" : "Point at a barcode"}
          </p>
        </div>
      )}
    </div>
  );
}
