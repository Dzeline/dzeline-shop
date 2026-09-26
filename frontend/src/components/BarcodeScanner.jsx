import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { formatPrice } from "../utils/formatters";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { cropRect, shouldTryHard } from "../utils/scanTuning";
import { rankBackCameras, cameraShortName, zoomFor, isUnusableForScanning } from "../utils/cameraSelect";

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

// How long a cashier aims at a barcode that will not read before the app should
// stop letting them wonder and offer the way round it.
//
// Eight seconds is well past a normal read - most are under one - and short of
// the point where somebody gives up on the sale. Measured from the last
// successful scan rather than from opening the camera, so it also catches the one
// awkward item in a basket of twenty that scanned fine.
const STALLED_AFTER_MS = 8000;

/**
 * @param onScan    called with the decoded text. In continuous mode it may
 *                  return (or resolve to) `{ ok, message }` to drive the
 *                  in-camera feedback banner.
 * @param continuous keep the camera running and keep accepting codes until
 *                  the cashier taps Done. Off by default: the add-product,
 *                  edit-product, inventory and stock-receiving call sites all
 *                  want a single code to fill a field.
 * @param summary   `{ count, total }` — running cart state shown while scanning.
 * @param onSearchInstead  optional. Offered once scanning has stalled, to close
 *                  the camera and put the cursor in the search box. Where a call
 *                  site has no search to fall back to (filling in a barcode field,
 *                  for instance) it is left out and the hint just explains.
 */
export default function BarcodeScanner({ onScan, onClose, continuous = false, summary, onSearchInstead }) {
  useEscapeKey(onClose);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | denied | unsupported
  const [feedback, setFeedback] = useState(null);   // { ok, message }

  // Which rear camera is in use, and what else is available.
  //
  // A phone with several rear lenses does not always hand over the main one, and
  // an ultra-wide or a depth sensor cannot resolve a barcode at reading distance -
  // the preview looks fine and nothing ever decodes. Ranking picks the best guess;
  // this state is what lets a person overrule it when the guess is wrong, which is
  // the only thing that reliably works on a device nobody testing it owns.
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [diagnostics, setDiagnostics] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Kept in a ref so a new callback identity from the parent never tears down
  // and restarts the camera mid-scan.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });

  const lastRef = useRef({ code: null, at: 0 });
  // Set inside the camera effect, called by the switch button outside it.
  const switchCameraRef = useRef(null);
  // Lets the "camera stopped" message ask for another go.
  const retryRef = useRef(null);
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
    let lastTryHardMs = 0;
    // Counted so the scanner can say what it is doing on a device nobody
    // debugging it has in their hand. "Looks 14 times a second and has decoded 0"
    // and "looks 0 times a second" are completely different faults.
    let frames = 0;
    let decodes = 0;
    let lastReportAt = 0;
    // Which camera is actually in use, so a recovery can ask for the same one.
    let activeDeviceId = null;
    let recovering = false;
    let recoveries = 0;
    // When the picture stopped arriving. The watchdog in tick() uses it to tell a
    // momentary hiccup from a camera that has gone for good.
    let deadSince = 0;
    let lastVideoTime = -1;

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

      // Is the picture still arriving?
      //
      // Not as obvious a question as it looks. When a camera dies the video
      // element keeps its last frame's dimensions and readyState, so width and
      // readyState both keep saying everything is fine while the preview is a
      // black rectangle - which is precisely what a staff member saw. And a track
      // stopped by the operating system does not always fire "ended".
      //
      // currentTime is the honest signal: it advances only while frames are
      // actually being delivered.
      const at = performance.now();
      const track = stream?.getVideoTracks?.()[0];
      const ended = !track || track.readyState === "ended";

      if (video && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        deadSince = 0;
      } else if (!deadSince) {
        deadSince = at;
      }

      const ready = video && video.readyState >= 2 && video.videoWidth > 0;
      // Not while the app is in the background: frames legitimately stop there,
      // and grabbing the camera again on return is the browser's job, not ours.
      const frozen = !document.hidden && deadSince && at - deadSince > 2500;

      if (ended || !ready || frozen) {
        if (!recovering) recover(ended ? "the camera closed" : "no new frames");
        return;
      }

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

      frames++;
      const now = performance.now();
      if (now - lastReportAt > 1000) {
        // A barcode printed on a curved or glossy surface can be unreadable by
        // any phone camera while being perfectly fine to a laser scanner. The
        // digits underneath it are not, and search matches them, so the way out
        // is to say so rather than leave somebody aiming.
        setStalled(now - lastSuccessAt > STALLED_AFTER_MS);
        const video2 = videoRef.current;
        setDiagnostics({
          looks: frames,
          resolution: video2 ? `${video2.videoWidth}x${video2.videoHeight}` : "—",
          readyState: video2?.readyState ?? 0,
          decoded: decodes,
          crop: `${rect.width}x${rect.height}`,
        });
        frames = 0;
        lastReportAt = now;
      }
      const thorough = shouldTryHard(now, lastSuccessAt, lastTryHardAt, lastTryHardMs);
      if (thorough) lastTryHardAt = now;

      try {
        const result = (thorough ? thoroughReader : fastReader).decodeFromCanvas(canvas);
        // Measured, so the next pass can be spaced against what this one
        // actually cost on this device rather than on a guess.
        if (thorough) lastTryHardMs = performance.now() - now;
        if (result) { decodes++; handleResult(result.getText()); }
      } catch {
        if (thorough) lastTryHardMs = performance.now() - now;
        // No barcode in this frame — the overwhelmingly common case, and not
        // an error worth logging once a second.
      }
    }

    // Asking for a specific camera when we know which one, and "any rear camera"
    // on the first attempt, because labels cannot be read before permission is
    // granted.
    function constraintsFor(deviceId) {
      return {
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
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
      };
    }

    /**
     * Wait until the video is actually producing pictures.
     *
     * getUserMedia resolving is not the same as a working camera. A track can
     * arrive live and never deliver a frame - which is what a second camera open
     * does on hardware that cannot hold two at once. Without this check the
     * scanner shows a black rectangle and claims to be scanning.
     */
    function framesArrive(video, timeoutMs = 2500) {
      return new Promise((resolve) => {
        const deadline = performance.now() + timeoutMs;
        const poll = () => {
          if (cancelled) return resolve(false);
          if (video.readyState >= 2 && video.videoWidth > 0) return resolve(true);
          if (performance.now() > deadline) return resolve(false);
          setTimeout(poll, 100);
        };
        poll();
      });
    }

    /**
     * Open one camera, and prove it works before keeping it.
     *
     * The old stream is stopped *first*. Acquiring the new one while the old is
     * still live is what broke a Redmi 12: budget Android cannot always hold two
     * camera streams, so the second open returned a track that never produced a
     * frame - and by then the working one had been stopped. A brief black gap
     * while switching is a far better trade than a camera that never comes back.
     */
    async function openCamera(deviceId) {
      stopStream();
      let media;
      try {
        media = await navigator.mediaDevices.getUserMedia(constraintsFor(deviceId));
      } catch {
        return null;
      }
      if (cancelled) { media.getTracks().forEach((t) => t.stop()); return null; }

      const video = videoRef.current;
      if (!video) { media.getTracks().forEach((t) => t.stop()); return null; }

      stream = media;
      video.srcObject = media;
      await video.play().catch(() => {});

      if (!(await framesArrive(video))) {
        media.getTracks().forEach((t) => t.stop());
        if (stream === media) stream = null;
        return null;
      }

      lastVideoTime = -1;
      deadSince = 0;
      activeDeviceId = media.getVideoTracks()[0]?.getSettings?.().deviceId ?? deviceId ?? null;
      watchTrack(media);
      return media;
    }

    // A camera can be taken away mid-scan - another app opens it, the phone
    // sleeps, the OS reclaims it. The track says so; without listening, the loop
    // carries on decoding a frozen or black frame for ever.
    function watchTrack(media) {
      const track = media.getVideoTracks()[0];
      if (!track) return;
      track.addEventListener("ended", () => { if (!cancelled) recover("the camera was closed"); });
      track.addEventListener("mute", () => { if (!cancelled) recover("the camera was taken"); });
    }

    /**
     * Get a working picture back, or say plainly that we cannot.
     *
     * Tries the camera that was in use, then any rear camera at all. Capped,
     * because a phone whose camera is held by another app will not recover by
     * being asked repeatedly, and a retry loop behind a black screen is worse
     * than a message.
     */
    async function recover(why) {
      if (cancelled || recovering) return;
      recovering = true;
      setStatus("starting");
      try {
        const media = (await openCamera(activeDeviceId)) ?? (await openCamera(null));
        if (cancelled) return;
        if (media) {
          deadSince = 0;
          setStatus("scanning");
        } else {
          recoveries++;
          console.warn(`Scanner could not restart the camera (${why}).`);
          setStatus(recoveries >= 2 ? "lost" : "scanning");
        }
      } finally {
        recovering = false;
      }
    }

    retryRef.current = () => { recoveries = 0; recover("asked to retry"); };

    async function begin() {
      // Any rear camera first: until a stream exists the device labels are blank,
      // so there is nothing to rank.
      let media = await openCamera(null);
      if (!media || cancelled) {
        if (!cancelled) setStatus("denied");
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const ranked = rankBackCameras(devices);
      const activeLabel = ranked.find((d) => d.deviceId === activeDeviceId)?.label ?? "";

      // Only overrule the browser when the lens it chose genuinely cannot read a
      // barcode - an ultra-wide, a macro, a depth sensor. "Not my first choice"
      // is not worth a second camera open: on most phones the browser picks the
      // main sensor and swapping only risks the stream.
      let index = ranked.findIndex((d) => d.deviceId === activeDeviceId);
      if (isUnusableForScanning(activeLabel)) {
        const better = ranked.find((d) => !isUnusableForScanning(d.label));
        if (better && better.deviceId !== activeDeviceId) {
          const swapped = await openCamera(better.deviceId);
          if (swapped) {
            media = swapped;
            index = ranked.indexOf(better);
          } else {
            // The swap failed, so put back what was working rather than leaving
            // the cashier with nothing.
            media = (await openCamera(activeDeviceId)) ?? (await openCamera(null));
            if (!media) { if (!cancelled) setStatus("denied"); return; }
          }
        }
      }

      if (cancelled) return;
      setCameras(ranked);
      setCameraIndex(index < 0 ? 0 : index);
      await applyZoom(media, ranked[index < 0 ? 0 : index]?.label);
      setStatus("scanning");
      rafId = requestAnimationFrame(tick);
    }

    // An ultra-wide that is the only camera on offer can still read a barcode if
    // it is zoomed in.
    async function applyZoom(media, label) {
      const track = media?.getVideoTracks?.()[0];
      if (!track?.getCapabilities) return;
      try {
        const zoom = zoomFor(label, track.getCapabilities());
        if (zoom != null) await track.applyConstraints({ advanced: [{ zoom }] });
      } catch { /* zoom is unsupported on most cameras; not worth reporting */ }
    }

    switchCameraRef.current = async (nextIndex) => {
      const target = cameras[nextIndex];
      if (!target || recovering) return;
      setStatus("starting");
      const media = (await openCamera(target.deviceId)) ?? (await openCamera(activeDeviceId));
      if (cancelled) return;
      if (media) {
        setCameraIndex(nextIndex);
        await applyZoom(media, target.label);
        setStatus("scanning");
      } else {
        setStatus("lost");
      }
    };

    begin();

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
        {/* Tapping the title shows what the camera is actually doing. Deliberately
            undiscoverable rather than hidden behind a build flag: when a scanner
            will not read on one particular phone, this is the difference between
            diagnosing it and guessing. */}
        <button
          onClick={() => setShowDiagnostics((v) => !v)}
          className="text-white font-semibold text-sm text-left"
        >
          {continuous ? "Scan items" : "Scan Barcode"}
        </button>

        <div className="flex items-center gap-2">
          {cameras.length > 1 && (
            <button
              onClick={() => switchCameraRef.current?.((cameraIndex + 1) % cameras.length)}
              className="px-3 py-1.5 rounded-full bg-white/20 text-white text-xs font-semibold"
              title="Try another camera"
            >
              {cameraShortName(cameras[cameraIndex]?.label, cameraIndex)}
              <span className="text-white/60"> · switch</span>
            </button>
          )}
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
      </div>

      {stalled && !hintDismissed && status === "scanning" && (
        <div className="absolute inset-x-3 top-20 z-10 bg-amber-500 text-amber-950 rounded-2xl px-4 py-3 shadow-xl">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-snug">Not reading?</p>
              <p className="text-xs mt-0.5 leading-relaxed">
                Some labels will not scan — curved cups, shiny wrappers, scuffed print. The
                numbers printed under the bars always work: type the last few in search.
              </p>
              <div className="flex gap-2 mt-2">
                {onSearchInstead && (
                  <button
                    onClick={onSearchInstead}
                    className="px-3 py-1.5 rounded-lg bg-amber-950 text-amber-50 text-xs font-bold"
                  >
                    Search instead
                  </button>
                )}
                <button
                  onClick={() => setHintDismissed(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-950/10 text-amber-950 text-xs font-semibold"
                >
                  Keep trying
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDiagnostics && (
        <div className="bg-black/80 px-4 py-2 text-[11px] text-white/80 font-mono shrink-0 space-y-0.5">
          <p>
            looks/sec {diagnostics?.looks ?? 0} · decoded {diagnostics?.decoded ?? 0} ·
            {" "}video {diagnostics?.resolution ?? "—"} · crop {diagnostics?.crop ?? "—"} ·
            {" "}ready {diagnostics?.readyState ?? 0}
          </p>
          <p className="text-white/50 break-all">
            using: {cameras[cameraIndex]?.label || "(unlabelled)"}
          </p>
          {cameras.length > 1 && (
            <p className="text-white/40 break-all">
              available: {cameras.map((c) => cameraShortName(c.label)).join(" · ")}
            </p>
          )}
          <p className="text-white/40">
            {diagnostics?.looks === 0
              ? "No frames — the video is not producing images."
              : (diagnostics?.decoded ?? 0) === 0
              ? "Frames are being read but nothing decodes — try switching camera, or move further back."
              : "Decoding."}
          </p>
        </div>
      )}

      {(status === "denied" || status === "unsupported" || status === "lost") ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
          <p className="text-white font-semibold">
            {status === "unsupported"
              ? "Barcode scanning not supported on this browser"
              : status === "lost"
              ? "The camera stopped sending a picture"
              : "Camera access denied"}
          </p>
          <p className="text-white/50 text-sm">
            {status === "lost"
              // Said plainly, because a black rectangle that claims to be
              // scanning is worse than an honest failure - and because the way
              // round it takes two seconds.
              ? "Another app may be using it. Try again, or search for the product by name or by the digits under its barcode."
              : "Type the barcode number in the field instead"}
          </p>
          <div className="flex gap-2">
            {status === "lost" && (
              <button
                onClick={() => retryRef.current?.()}
                className="px-5 py-2 bg-white text-gray-900 rounded-xl text-sm font-bold"
              >
                Try again
              </button>
            )}
            {status === "lost" && onSearchInstead && (
              <button
                onClick={onSearchInstead}
                className="px-5 py-2 bg-white/20 text-white rounded-xl text-sm font-semibold"
              >
                Search instead
              </button>
            )}
            <button onClick={onClose} className="px-5 py-2 bg-white/20 text-white rounded-xl text-sm font-semibold">
              Close
            </button>
          </div>
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
