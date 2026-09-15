import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeImage, stopImageWorker } from "../src/image-client.ts";

test("a failed worker start does not discard the next valid image request", async t => {
  const previous = process.env.PI_VIEW_NODE;
  t.after(() => {
    stopImageWorker();
    if (previous === undefined) delete process.env.PI_VIEW_NODE;
    else process.env.PI_VIEW_NODE = previous;
  });
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>');
  process.env.PI_VIEW_NODE = join(tmpdir(), `pi-view-missing-node-${randomUUID()}`);
  await assert.rejects(decodeImage(image, "failed start"), /ENOENT/);
  process.env.PI_VIEW_NODE = process.execPath;
  const decoded = await decodeImage(image, "recovered worker");
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 3);
});
