export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
export const ACCEPT_ATTR = ".png,.jpg,.jpeg,.webp,.gif,.pdf,image/png,image/jpeg,image/webp,image/gif,application/pdf";

const MAX_IMAGE_DIM = 2048;

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isImage(type) {
  return typeof type === "string" && type.startsWith("image/");
}

export function isPdf(type) {
  return type === "application/pdf";
}

export function isAccepted(file) {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  // Some browsers leave `type` empty for drag-dropped files; fall back to the extension.
  return /\.(png|jpe?g|webp|gif|pdf)$/i.test(file.name);
}

// SHA-256 of the file's bytes as hex, or null where WebCrypto is unavailable: crypto.subtle only
// exists in a secure context, and plain http on a LAN address is not one.
export async function hashFile(file) {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// Whether an item already in the store is the same file as one about to be uploaded. Hashes are
// compared when both sides have one; items uploaded before hashes were recorded, and browsers
// without WebCrypto, fall back to name and size.
export function isSameFile(item, { name, size }, hash) {
  if (hash && item.hash) return item.hash === hash;
  return item.name === name && item.size === size;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

// Downscale large photos before sending them to the API: fewer tokens, faster, same OCR quality.
export async function imageToDataUrl(blob, maxDim = MAX_IMAGE_DIM) {
  if (blob.type === "image/gif") return blobToDataUrl(blob);
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blobToDataUrl(blob);
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale === 1) {
    bitmap.close?.();
    return blobToDataUrl(blob);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const mime = blob.type === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(mime, 0.92);
}

// Builds the Responses API content part for an image or PDF.
export async function fileToInputPart(blob, filename) {
  if (isPdf(blob.type) || /\.pdf$/i.test(filename || "")) {
    const dataUrl = await blobToDataUrl(blob);
    return { type: "input_file", filename: filename || "document.pdf", file_data: dataUrl };
  }
  const dataUrl = await imageToDataUrl(blob);
  return { type: "input_image", image_url: dataUrl, detail: "high" };
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
