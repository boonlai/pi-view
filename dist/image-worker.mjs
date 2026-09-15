// This process uses Node's normal package resolver, not either host's loader.
import { createInterface } from "node:readline";
import { decodeImage, renderRaster } from "./image-codec.ts";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  const request = JSON.parse(line);
  try {
    const bytes = Buffer.from(request.data, "base64");
    const result = request.operation === "decode"
      ? await decodeImage(bytes, request.label)
      : { data: await renderRaster({ ...request.image, data: bytes }, request.options) };
    process.stdout.write(JSON.stringify({ id: request.id, ...result, data: result.data.toString("base64") }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id: request.id, error: String(error.message ?? error) }) + "\n");
  }
}
