/**
 * Decode-loop tuning for the camera scanner.
 *
 * Pulled out as pure functions so the numbers that decide how fast scanning
 * feels can be tested and argued about without a camera.
 *
 * Measured cost of ONE failed decode (desktop CPU, the case that dominates
 * while the cashier is still aiming at the barcode):
 *
 *   1920x1080  TRY_HARDER   506 ms   ->  2 frames/sec
 *   1920x1080  plain        140 ms   ->  7 frames/sec
 *    640x480   TRY_HARDER   394 ms   ->  2.5 frames/sec
 *    640x480   plain         40 ms   -> 25 frames/sec
 *    480x200   plain         23 ms   -> 43 frames/sec
 *
 * Two things follow. TRY_HARDER is the dominant cost, not resolution — it is
 * roughly 10x at a given size. And decoding the whole 1080p frame is waste:
 * the barcode is inside the on-screen window, and everything outside it is
 * pixels the decoder pays for and the cashier never aimed with.
 *
 * So: crop to the window and decode plainly at speed, and keep TRY_HARDER as a
 * fallback for the barcode that will not read — small, skewed, or scuffed —
 * rather than paying for it on every frame.
 */

/** Fraction of the video frame the on-screen scan window covers. */
export const CROP_WIDTH_RATIO = 0.8;
export const CROP_HEIGHT_RATIO = 0.35;

/** Give the fast path this long before spending a slow exhaustive pass. */
export const TRY_HARD_AFTER_MS = 900;

/**
 * And no more often than this.
 *
 * Tuned against the measurement, not by feel. A thorough pass costs ~530ms, so
 * at one every 700ms it would eat three-quarters of every second and starve the
 * fast path that reads most barcodes — the fallback would have become the
 * bottleneck it was added to avoid. At 2.5s it costs about a fifth of the
 * budget, leaving ~14 fast looks a second, and a barcode that needs the
 * exhaustive pass still gets one well within the time it takes to steady a
 * phone over a label.
 */
export const TRY_HARD_EVERY_MS = 2500;

/**
 * The region of the video to decode, in video pixel coordinates.
 *
 * Centred, matching where the framing rectangle sits on screen. Cropping rather
 * than downscaling keeps every sensor pixel the barcode actually occupies —
 * which is why a small barcode reads *better* here than it did when the whole
 * frame was scaled down.
 */
export function cropRect(videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) return null;
  const w = Math.round(videoWidth * CROP_WIDTH_RATIO);
  const h = Math.round(videoHeight * CROP_HEIGHT_RATIO);
  return {
    x: Math.round((videoWidth - w) / 2),
    y: Math.round((videoHeight - h) / 2),
    width: w,
    height: h,
  };
}

/**
 * Should this frame get the slow, exhaustive pass?
 *
 * Only once the fast path has been failing for a while, and then only
 * occasionally — a hard barcode gets its chance without the easy case paying
 * for it.
 *
 * @param now              performance.now()
 * @param lastSuccessAt    when a code last decoded (or when scanning started)
 * @param lastTryHardAt    when the last exhaustive pass ran
 */
export function shouldTryHard(now, lastSuccessAt, lastTryHardAt) {
  if (now - lastSuccessAt < TRY_HARD_AFTER_MS) return false;
  // Never run one yet: allow it. Comparing against 0 would otherwise measure
  // page uptime rather than time since the last pass, so opening the scanner
  // within the first few seconds of a page load would have its first thorough
  // pass rate-limited away — exactly when a stubborn barcode most needs it.
  if (!lastTryHardAt) return true;
  return now - lastTryHardAt >= TRY_HARD_EVERY_MS;
}
