// A raw phone-camera capture can be several MB — fine sitting alone in local
// IndexedDB, but too heavy to sync as a JSON payload on every draft/edit.
// Downscale + re-encode once, at capture time, so every downstream use
// (storage, sync, scan upload) gets the smaller version.
export function compressImage(dataUrl, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not process image"));
    img.src = dataUrl;
  });
}
