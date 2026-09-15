import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ImageSource, RasterOptions } from "./documents.ts";

interface Result { data: Buffer; width?: number; height?: number; label?: string }
interface Job {
  id: number; payload: string; resolve: (value: Result) => void; reject: (error: Error) => void;
  signal?: AbortSignal; cancel: () => void; timer?: NodeJS.Timeout;
}
let worker: ChildProcessWithoutNullStreams | undefined;
let active: Job | undefined;
let stopping = false;
let nextId = 0;
let idle: NodeJS.Timeout | undefined;
const queue: Job[] = [];

function settle(error?: Error, value?: Result): void {
  const job = active;
  active = undefined;
  if (job) {
    clearTimeout(job.timer); job.signal?.removeEventListener("abort", job.cancel);
    if (error) job.reject(error); else job.resolve(value!);
  }
}

function stop(error: Error): void {
  stopping = true;
  settle(error);
  worker?.kill("SIGKILL");
  if (!worker) { stopping = false; pump(); }
}

function pump(): void {
  if (active || stopping) return;
  clearTimeout(idle);
  if (!queue.length) {
    if (worker) {
      const current = worker;
      current.unref();
      for (const stream of [current.stdin, current.stdout, current.stderr]) (stream as typeof stream & { unref?(): void }).unref?.();
      idle = setTimeout(() => { if (worker === current && !active) { stopping = true; current.kill(); } }, 5000);
      idle.unref();
    }
    return;
  }
  active = queue.shift()!;
  if (!worker) {
    const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
    const current = worker = spawn(node, [fileURLToPath(new URL("./image-worker.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    current.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    current.stdin.on("error", error => { if (worker === current) stop(error); });
    const lines = createInterface({ input: current.stdout, crlfDelay: Infinity });
    lines.on("line", line => {
      if (worker !== current || stopping) return;
      try {
        const result = JSON.parse(line);
        if (result.id !== active?.id) return;
        if (result.error) settle(new Error(result.error));
        else settle(undefined, { ...result, data: Buffer.from(result.data, "base64") });
        pump();
      } catch (error) { stop(error as Error); }
    });
    current.on("error", error => {
      if (worker === current) {
        stopping = true;
        settle(new Error(`Image worker could not start: ${error.message}. Install Node.js >=22.19 or set PI_VIEW_NODE.`));
      }
    });
    current.on("close", () => {
      if (worker !== current) return;
      lines.close(); worker = undefined; stopping = false;
      settle(new Error(`Image worker stopped${stderr ? `: ${stderr.trim()}` : ""}`));
      pump();
    });
  }
  worker.ref();
  for (const stream of [worker.stdin, worker.stdout, worker.stderr]) (stream as typeof stream & { ref?(): void }).ref?.();
  const job = active;
  if (!job) return;
  job.timer = setTimeout(() => stop(new Error("Image rendering exceeded the 20 second limit")), 20_000);
  worker.stdin.write(job.payload + "\n");
}

function request(operation: string, data: Buffer, metadata: object, signal?: AbortSignal): Promise<Result> {
  signal?.throwIfAborted();
  if (data.length > 32 * 1024 * 1024) throw new Error("Image exceeds the 32 MiB worker limit");
  if (queue.length >= 16) throw new Error("Too many pending image previews");
  const deferred = Promise.withResolvers<Result>();
  const id = ++nextId;
  const job: Job = {
    id, payload: JSON.stringify({ id, operation, data: data.toString("base64"), ...metadata }),
    resolve: deferred.resolve, reject: deferred.reject, signal,
    cancel: () => {
      const error = new Error("Image preview aborted");
      if (active === job) stop(error);
      else {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        signal?.removeEventListener("abort", job.cancel); deferred.reject(error);
      }
    },
  };
  signal?.addEventListener("abort", job.cancel, { once: true });
  queue.push(job); pump();
  return deferred.promise;
}

export async function decodeImage(data: Buffer, label: string, signal?: AbortSignal): Promise<ImageSource> {
  const result = await request("decode", data, { label }, signal);
  return { data: result.data, width: result.width!, height: result.height!, label: result.label! };
}

export async function renderRaster(image: ImageSource, options: RasterOptions, signal?: AbortSignal): Promise<Buffer> {
  return (await request("render", image.data, { image: { width: image.width, height: image.height, label: image.label }, options }, signal)).data;
}

export function stopImageWorker(): void {
  clearTimeout(idle);
  for (const job of queue.splice(0)) { job.signal?.removeEventListener("abort", job.cancel); job.reject(new Error("Image viewer shut down")); }
  if (worker) stop(new Error("Image viewer shut down"));
}
