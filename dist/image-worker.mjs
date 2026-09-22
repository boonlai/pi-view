// src/image-worker.mjs
import { createInterface } from "node:readline";

// src/image-codec.ts
import sharp from "sharp";
var PIXEL_LIMIT = 4e7;
var IMAGE_LIMIT = 32 * 1024 * 1024;
var SVG_FORBIDDEN = /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|@import|<(?:[^\s<>/:]+:)?(?:script|foreignObject)(?=[\s/>])/i;
async function checkSvg(bytes, signal) {
  if (bytes[0] === 31 && bytes[1] === 139) {
    throw new Error("Gzip-compressed images such as SVGZ are not supported");
  }
  let start = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
  while (bytes[start] === 9 || bytes[start] === 10 || bytes[start] === 13 || bytes[start] === 32) start++;
  if (bytes[start] !== 60) return;
  const text = bytes.toString("utf8", start);
  const externalUrl = [...text.matchAll(/url\(([^)]*)\)/gi)].some((match) => !match[1].trim().replace(/^["']|["']$/g, "").startsWith("#"));
  const externalHref = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].some((match) => !/^(?:#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(match[1].trim()));
  if (SVG_FORBIDDEN.test(text) || externalHref || externalUrl) {
    throw new Error("SVG scripts, entities and external resources are not allowed");
  }
  let embeddedPixels = 0;
  for (const match of text.matchAll(/(?:href|src)\s*=\s*["']\s*data:image\/(?:png|jpeg|gif|webp);base64,([^"']*)["']/gi)) {
    signal?.throwIfAborted();
    const metadata = await sharp(Buffer.from(match[1], "base64"), { limitInputPixels: PIXEL_LIMIT }).metadata();
    embeddedPixels += (metadata.width ?? PIXEL_LIMIT) * (metadata.height ?? PIXEL_LIMIT) * (metadata.pages ?? 1);
    if (embeddedPixels > PIXEL_LIMIT) throw new Error("Embedded SVG images exceed the cumulative 40 megapixel limit");
  }
}
async function decodeImage(bytes, label, signal) {
  signal?.throwIfAborted();
  await checkSvg(bytes, signal);
  const decoded = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT, animated: false, page: 0, pages: 1 }).rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  signal?.throwIfAborted();
  if (decoded.data.length > IMAGE_LIMIT) throw new Error("Decoded image exceeds the 32 MiB limit");
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height, label };
}
async function renderRaster(image, options, signal) {
  signal?.throwIfAborted();
  const { widthPx, heightPx } = options;
  if (![widthPx, heightPx].every((v) => Number.isInteger(v) && v > 0 && v <= 4096) || widthPx * heightPx > 8e6) {
    throw new Error("Preview viewport exceeds the raster size limit");
  }
  const zoom = Math.max(0.05, Math.min(32, Number.isFinite(options.zoom) ? options.zoom : 1));
  const fit = options.actualSize ? 1 : Math.min(widthPx / image.width, heightPx / image.height);
  const scale = (options.withoutEnlargement ? Math.min(1, fit) : fit) * zoom;
  const regionW = Math.min(image.width, Math.max(1, Math.ceil(widthPx / scale)));
  const regionH = Math.min(image.height, Math.max(1, Math.ceil(heightPx / scale)));
  const clampPan = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  const left = Math.round((image.width - regionW) * clampPan(options.panX));
  const top = Math.round((image.height - regionH) * clampPan(options.panY));
  const outW = Math.max(1, Math.min(widthPx, Math.round(regionW * scale)));
  const outH = Math.max(1, Math.min(heightPx, Math.round(regionH * scale)));
  const padLeft = Math.floor((widthPx - outW) / 2);
  const padTop = Math.floor((heightPx - outH) / 2);
  const cropTop = Math.max(0, Math.min(heightPx - 1, Math.floor(options.cropTopPx ?? 0)));
  const cropHeight = Math.max(1, Math.min(heightPx - cropTop, Math.floor(options.cropHeightPx ?? heightPx)));
  const visibleTop = Math.max(cropTop, padTop);
  const visibleBottom = Math.min(cropTop + cropHeight, padTop + outH);
  if (visibleBottom <= visibleTop) {
    const result2 = await sharp({ create: { width: widthPx, height: cropHeight, channels: 4, background: "#00000000" } }).png({ compressionLevel: 1 }).toBuffer();
    signal?.throwIfAborted();
    return result2;
  }
  let pipeline = sharp(image.data).extract({ left, top, width: regionW, height: regionH }).resize(outW, outH, { fit: "fill" });
  if (visibleBottom - visibleTop !== outH) {
    pipeline = pipeline.extract({ left: 0, top: visibleTop - padTop, width: outW, height: visibleBottom - visibleTop });
  }
  const result = await pipeline.extend({
    left: padLeft,
    right: widthPx - outW - padLeft,
    top: visibleTop - cropTop,
    bottom: cropTop + cropHeight - visibleBottom,
    background: "#00000000"
  }).png({ compressionLevel: 1 }).toBuffer();
  signal?.throwIfAborted();
  return result;
}

// src/image-worker.mjs
var input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  const request = JSON.parse(line);
  try {
    const bytes = Buffer.from(request.data, "base64");
    const result = request.operation === "decode" ? await decodeImage(bytes, request.label) : { data: await renderRaster({ ...request.image, data: bytes }, request.options) };
    process.stdout.write(JSON.stringify({ id: request.id, ...result, data: result.data.toString("base64") }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request.id, error: String(error.message ?? error) }) + "\n");
  }
}
