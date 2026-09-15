import sharp from "sharp";
import type { ImageSource, RasterOptions } from "./documents.ts";
const PIXEL_LIMIT = 40_000_000;
const IMAGE_LIMIT = 32 * 1024 * 1024;

// Check XML before native parsing, including qualified tags. librsvg does not
// execute scripts, but unsupported SVG content must not bypass resource checks.
const SVG_FORBIDDEN = /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|@import|<(?:[^\s<>/:]+:)?(?:script|foreignObject)(?=[\s/>])/i;

async function checkSvg(bytes: Buffer, signal?: AbortSignal): Promise<void> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new Error("Gzip-compressed images such as SVGZ are not supported");
  }
  let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (bytes[start] === 9 || bytes[start] === 10 || bytes[start] === 13 || bytes[start] === 32) start++;
  if (bytes[start] !== 60) return; // Raster metadata can contain XML; it is not the image document.
  const text = bytes.toString("utf8", start);
  const externalUrl = [...text.matchAll(/url\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^["']|["']$/g, "").startsWith("#"));
  const externalHref = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)]
    .some(match => !/^(?:#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(match[1].trim()));
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

export async function decodeImage(bytes: Buffer, label: string, signal?: AbortSignal): Promise<ImageSource> {
  signal?.throwIfAborted();
  await checkSvg(bytes, signal);
  const decoded = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT, animated: false, page: 0, pages: 1 })
    .rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  signal?.throwIfAborted();
  if (decoded.data.length > IMAGE_LIMIT) throw new Error("Decoded image exceeds the 32 MiB limit");
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height, label };
}

export async function renderRaster(image: ImageSource, options: RasterOptions, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const { widthPx, heightPx } = options;
  if (![widthPx, heightPx].every(v => Number.isInteger(v) && v > 0 && v <= 4096) || widthPx * heightPx > 8_000_000) {
    throw new Error("Preview viewport exceeds the raster size limit");
  }
  const zoom = Math.max(0.05, Math.min(32, Number.isFinite(options.zoom) ? options.zoom : 1));
  const scale = (options.actualSize ? 1 : Math.min(widthPx / image.width, heightPx / image.height)) * zoom;
  const regionW = Math.min(image.width, Math.max(1, Math.ceil(widthPx / scale)));
  const regionH = Math.min(image.height, Math.max(1, Math.ceil(heightPx / scale)));
  const clampPan = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  const left = Math.round((image.width - regionW) * clampPan(options.panX));
  const top = Math.round((image.height - regionH) * clampPan(options.panY));
  const outW = Math.max(1, Math.min(widthPx, Math.round(regionW * scale)));
  const outH = Math.max(1, Math.min(heightPx, Math.round(regionH * scale)));
  const imageBytes = await sharp(image.data).extract({ left, top, width: regionW, height: regionH })
    .resize(outW, outH, { fit: "fill" }).png().toBuffer();
  signal?.throwIfAborted();
  const canvas = await sharp({ create: { width: widthPx, height: heightPx, channels: 4, background: "#00000000" } })
    .composite([{ input: imageBytes, left: Math.floor((widthPx - outW) / 2), top: Math.floor((heightPx - outH) / 2) }])
    .png().toBuffer();
  const cropTop = Math.max(0, Math.min(heightPx - 1, Math.floor(options.cropTopPx ?? 0)));
  const cropHeight = Math.max(1, Math.min(heightPx - cropTop, Math.floor(options.cropHeightPx ?? heightPx)));
  signal?.throwIfAborted();
  return cropTop || cropHeight !== heightPx
    ? sharp(canvas).extract({ left: 0, top: cropTop, width: widthPx, height: cropHeight }).png().toBuffer()
    : canvas;
}
