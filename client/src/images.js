// Prepares images chosen from the camera, gallery or computer for upload.
// The PDF can only embed JPEG and PNG, so other formats the browser can open (WebP, GIF, BMP, AVIF,
// HEIC on Safari, SVG for logos) are converted. Very large photos are scaled down to keep uploads fast.

const KEEP_AS_IS = /^image\/(jpeg|png)$/;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @param {{maxDim?: number, maxBytes?: number, output?: 'jpeg'|'png', name?: string}} opts
 * @returns {Promise<File>} a JPEG or PNG file
 */
export async function prepareImage(file, { maxDim = 2560, maxBytes = 4 * 1024 * 1024, output = 'jpeg' } = {}) {
  const isImage = file.type.startsWith('image/') || /\.(heic|heif|webp|avif|bmp|gif|svg)$/i.test(file.name);
  if (!isImage) throw new Error(`"${file.name}" is not an image.`);

  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    if (KEEP_AS_IS.test(file.type)) return file; // let the server decide
    throw new Error(`"${file.name}" can't be opened in this browser. Please save it as JPEG or PNG and try again.`);
  }
  const { img, url } = loaded;
  try {
    const w = img.naturalWidth || 1200;
    const h = img.naturalHeight || 1200;
    const big = Math.max(w, h) > maxDim;
    if (KEEP_AS_IS.test(file.type) && !big && file.size <= maxBytes && (output === 'jpeg' || file.type === 'image/png')) return file;

    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    const type = output === 'png' ? 'image/png' : 'image/jpeg';
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'; // JPEG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // browsers apply EXIF rotation here
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.88));
    if (!blob) throw new Error(`"${file.name}" could not be converted.`);
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.${output === 'png' ? 'png' : 'jpg'}`, { type, lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}
