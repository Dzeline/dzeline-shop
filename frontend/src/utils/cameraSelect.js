/**
 * Choosing which rear camera to scan with.
 *
 * `facingMode: "environment"` asks for "a back camera" and the browser picks one.
 * On a phone with one rear lens that is the right answer. On a modern Samsung or
 * iPhone there are three or four, and the one the browser hands over is not always
 * the main sensor: an ultra-wide has a fixed focus and a field of view wide enough
 * that a barcode held at arm's length covers too few pixels to resolve, and a depth
 * or macro sensor cannot produce a usable image at all.
 *
 * The symptom is specific and was reported from a Galaxy A55: the camera opens,
 * the preview looks fine, and nothing ever decodes.
 *
 * Labels are only readable once camera permission has been granted, so the caller
 * takes a stream first and ranks afterwards. Nothing here is certain - device
 * labels are not a standard - so the scanner also offers a manual switch, which is
 * the part that works when this guesses wrong.
 */

// Lenses that cannot focus on a barcode at reading distance, or are not a colour
// camera at all. "wide" on its own is deliberately absent: iOS calls its main
// sensor "Back Dual Wide Camera", and penalising that would pick the worst lens on
// every iPhone.
const UNUSABLE = [
  /ultra[\s-]?wide/,
  /telephoto/,
  /\btele\b/,
  /depth/,
  /macro/,
  /monochrom|\bmono\b/,
  /infrared|\bir\b/,
];

const BACK = /back|rear|environment/;
const FRONT = /front|user|face/;

/** Does this label describe a rear camera? */
export function isBackCamera(label) {
  const text = String(label ?? "").toLowerCase();
  if (FRONT.test(text)) return false;
  return BACK.test(text);
}

/**
 * How suitable a camera is for reading a barcode. Higher is better.
 *
 * Android convention numbers the rear lenses from 0, with 0 the main sensor, and
 * Chrome exposes that as "camera2 0, facing back" - so on the devices where the
 * label says nothing else useful, the number still does.
 */
export function scoreCamera(label) {
  const text = String(label ?? "").toLowerCase();
  let score = 0;

  for (const pattern of UNUSABLE) {
    if (pattern.test(text)) score -= 100;
  }

  const android = text.match(/camera2\s+(\d+)/);
  if (android) score -= Number(android[1]);

  // Names that tend to mark the primary lens.
  if (/\bmain\b|\bprimary\b|\bdual\s+wide\b|\btriple\b/.test(text)) score += 5;
  // A bare "back camera" with no qualifier is usually the one the phone opens in
  // its own camera app.
  if (/^back camera$|^rear camera$/.test(text.trim())) score += 5;

  return score;
}

/**
 * The rear cameras, best first.
 *
 * Front cameras are dropped. Devices with no label at all - which is what an
 * unpermissioned enumeration returns - are kept in their original order, because
 * their order is the only information available and the first rear camera is a
 * better guess than none.
 */
export function rankBackCameras(devices) {
  const cameras = (devices ?? []).filter((d) => d.kind === "videoinput");
  const labelled = cameras.filter((d) => String(d.label ?? "").trim());

  if (labelled.length === 0) return cameras;

  const back = labelled.filter((d) => isBackCamera(d.label));
  // Some browsers label cameras without saying which way they face. Falling back
  // to everything is better than returning nothing and leaving the caller with no
  // camera at all.
  const pool = back.length > 0 ? back : labelled;

  return [...pool].sort((a, b) => scoreCamera(b.label) - scoreCamera(a.label));
}

/**
 * A short name for a camera, for the switch button and the diagnostics.
 *
 * Device labels are long and repetitive ("camera2 0, facing back"), and a cashier
 * pressing a button needs a word, not a sentence.
 */
export function cameraShortName(label, index = 0) {
  const text = String(label ?? "").toLowerCase();
  if (/ultra[\s-]?wide/.test(text)) return "Ultra-wide";
  if (/telephoto|\btele\b/.test(text)) return "Zoom";
  if (/macro/.test(text)) return "Macro";
  if (/depth/.test(text)) return "Depth";
  const android = text.match(/camera2\s+(\d+)/);
  if (android) return `Camera ${android[1]}`;
  if (/^back camera$|^rear camera$/.test(text.trim())) return "Main";
  const cleaned = String(label ?? "").replace(/,?\s*facing\s+\w+/i, "").trim();
  return cleaned || `Camera ${index + 1}`;
}

/**
 * A zoom worth applying, or null.
 *
 * An ultra-wide can still read a barcode if it is zoomed in, which matters when it
 * is the only rear camera the browser will give us. Two steps into the range keeps
 * it well short of the digital-crop end where the image turns to mush.
 */
export function zoomFor(label, capabilities) {
  const range = capabilities?.zoom;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") return null;
  if (range.max <= range.min) return null;
  const text = String(label ?? "").toLowerCase();
  if (!/ultra[\s-]?wide/.test(text)) return null;
  const target = range.min + (range.max - range.min) * 0.35;
  const step = range.step || 0.1;
  // Rounded to a tidy value: stepping in floats produces things like
  // 2.4000000000000004, which some drivers reject outright.
  return Math.round(Math.round(target / step) * step * 100) / 100;
}
