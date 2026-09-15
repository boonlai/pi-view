import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { TUI } from "@earendil-works/pi-tui";
import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { attachMouse, capabilities, createTerminalImage, resolveImageProtocol } from "../src/host.ts";

type ListenerResult = { consume?: boolean; data?: string } | undefined;

class FakeTui {
  written: string[] = [];
  listeners: Array<(data: string) => ListenerResult> = [];

  readonly terminal = {
    write: (data: string) => {
      this.written.push(data);
    },
  };

  addInputListener(listener: (data: string) => ListenerResult): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  removeInputListener(listener: (data: string) => ListenerResult): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** Mirror the host TUI listener chain semantics for a raw stdin chunk. */
  feed(data: string): { consumed: boolean; data: string; result: ListenerResult } {
    let current = data;
    let consumed = false;
    let result: ListenerResult;
    for (const listener of [...this.listeners]) {
      result = listener(current);
      if (result?.consume) {
        consumed = true;
        return { consumed, data: "", result };
      }
      if (result?.data !== undefined) current = result.data;
    }
    return { consumed, data: current, result: undefined! };
  }

  output(): string {
    return this.written.join("");
  }
}

function asTui(fake: FakeTui): TUI {
  return fake as unknown as TUI;
}

const TERMINAL_ENV = [
  "TERM_PROGRAM", "TERMINAL_EMULATOR", "TERM", "COLORTERM", "TMUX", "STY", "ZELLIJ",
  "KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR", "WEZTERM_PANE", "WARP_SESSION_ID",
  "WARP_TERMINAL_SESSION_UUID", "ITERM_SESSION_ID", "WT_SESSION", "ALACRITTY_WINDOW_ID",
  "VSCODE_PID", "PI_VIEW_IMAGES", "PI_FORCE_IMAGE_PROTOCOL", "PI_IMAGE_PROTOCOL",
  "PI_HYPERLINKS", "PI_TRUE_COLOR", "PI_VIEW_MOUSE_PROBE_MS", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY",
];

async function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const values = { ...Object.fromEntries(TERMINAL_ENV.map(key => [key, undefined])), PI_HYPERLINKS: "0", ...overrides };
  const saved = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetCapabilitiesCache();
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetCapabilitiesCache();
  }
}

const png36 = await sharp({
  create: { width: 36, height: 36, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 1 } },
})
  .png()
  .toBuffer();

test("capabilities maps terminal environments to protocols", async (t) => {
  await t.test("ghostty env -> kitty", () => {
    return withEnv({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" }, () => {
      const caps = capabilities();
      assert.equal(caps.protocol, "kitty");
      assert.equal(caps.cellWidth > 0 && caps.cellHeight > 0, true);
      assert.ok(caps.details.join("\n").includes("terminal: ghostty"));
    });
  });
  await t.test("iTerm env -> iterm2", () => {
    return withEnv(
      {
        ITERM_SESSION_ID: "w0t0p0",
        KITTY_WINDOW_ID: undefined,
        GHOSTTY_RESOURCES_DIR: undefined,
        WEZTERM_PANE: undefined,
        TERM_PROGRAM: undefined,
        TERM: undefined,
      },
      () => {
        assert.equal(capabilities().protocol, "iterm2");
      },
    );
  });
  await t.test("tmux -> conservative null", () => {
    return withEnv({ TMUX: "/tmp/tmux-0/default,123,0" }, () => {
      const caps = capabilities();
      assert.equal(caps.protocol, null);
      assert.ok(caps.details.join("\n").includes("tmux"));
    });
  });
  await t.test("PI_VIEW_IMAGES=off disables everything", () => {
    return withEnv({ GHOSTTY_RESOURCES_DIR: "/x", PI_VIEW_IMAGES: "off" }, () => {
      const caps = capabilities();
      assert.equal(caps.protocol, null);
      assert.ok(caps.details.join("\n").includes("PI_VIEW_IMAGES=off"));
    });
  });
  await t.test("host sixel marker -> sixel", () => {
    return withEnv({}, () => {
      assert.equal(resolveImageProtocol(process.env, "\x1BPq").protocol, "sixel");
      assert.equal(capabilities(process.env, "\x1BPq").protocol, "sixel");
    });
  });
  await t.test("sixel respects PI_VIEW_IMAGES=off", () => {
    return withEnv({ PI_VIEW_IMAGES: "off" }, () => {
      assert.equal(resolveImageProtocol(process.env, "\x1BPq").protocol, null);
    });
  });
});

test("kitty path renders exact cell geometry with host-tracked metadata", () => {
  return withEnv({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" }, () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const fake = new FakeTui();
    const img = createTerminalImage(png36, 4, 2, "doc.png", asTui(fake));
    const lines = img.render(6);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\x1b_Ga=T,[^;]*\bc=4[,;]/);
    assert.match(lines[0], /^\x1b_Ga=T,[^;]*\br=2[,;]/);
    img.dispose();
  });
});

test("dispose deletes only the owned kitty image, idempotently", () => {
  return withEnv({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" }, () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const fake = new FakeTui();
    const img = createTerminalImage(png36, 4, 2, "doc.png", asTui(fake));
    const transmittedIds = (lines: string[]) => new Set([...lines.join("").matchAll(/\x1b_G[^;]*\bi=(\d+)/g)].map(match => Number(match[1])));
    assert.deepEqual(transmittedIds(img.render(6)), new Set([img.imageId]));
    img.invalidate();
    assert.deepEqual(transmittedIds(img.render(7)), new Set([img.imageId]));
    img.dispose();
    img.dispose(); // idempotent
    const deletedIds = [...fake.output().matchAll(/\x1b_Ga=d,d=I,i=(\d+),q=2\x1b\\/g)].map(match => Number(match[1]));
    assert.deepEqual(deletedIds, [img.imageId]);
    assert.ok(!fake.output().includes("d=A")); // never deletes host images
    assert.deepEqual(img.render(6), []); // renders after dispose are empty
  });
});

test("iterm2 path embeds cell width and needs no kitty cleanup", () => {
  return withEnv({ ITERM_SESSION_ID: "w0t0p0" }, () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    const fake = new FakeTui();
    const img = createTerminalImage(png36, 4, 2, "doc.png", asTui(fake));
    const lines = img.render(6);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /\x1b\]1337;File=[^:]*width=4;/);
    assert.ok(lines[1].startsWith("\x1b[1A")); // cursor restore before sequence
    assert.ok(lines[1].endsWith("\x07"));
    assert.equal(img.imageId, undefined);
    img.dispose();
    assert.equal(fake.output(), ""); // nothing to delete for iterm2
  });
});

test("no image protocol falls back to a plain text line", () => {
  return withEnv({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" }, () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const fake = new FakeTui();
    const img = createTerminalImage(png36, 4, 2, "doc.png", asTui(fake));
    // Fallback text is truncated to the render width; use a realistic width.
    const lines = img.render(40);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("doc.png"));
    assert.ok(lines[0].includes("[image/png]"));
    assert.ok(!lines[0].includes("\x1b_G"));
    assert.ok(!lines[0].includes("1337"));
    img.dispose();
    assert.equal(fake.output(), "");
  });
});

test("attachMouse enables SGR mouse and routes wheel packets", () => {
  return withEnv({ PI_VIEW_MOUSE_PROBE_MS: "0" }, () => {
    const fake = new FakeTui();
    const deltas: number[] = [];
    const detach = attachMouse(asTui(fake), (delta) => deltas.push(delta));
    const out = fake.output();
    assert.ok(out.includes("\x1b[?1000h"));
    assert.ok(!out.includes("\x1b[?1002h"));
    assert.ok(out.includes("\x1b[?1006h"));
    assert.ok(!out.includes("$p")); // probe disabled -> no DECRPM query

    fake.feed("\x1b[<64;10;5M"); // wheel up
    assert.deepEqual(deltas, [-3]);
    fake.feed("\x1b[<65;10;5M"); // wheel down
    assert.deepEqual(deltas, [-3, 3]);
    const combined = fake.feed("\x1b[<64;1;1M\x1b[<65;1;1M"); // combined packet
    assert.deepEqual(deltas, [-3, 3, -3, 3]);
    assert.equal(combined.consumed, true);
    assert.equal(combined.data, "");
    fake.feed("\x1b[M`!!"); // X10 wheel up
    assert.deepEqual(deltas, [-3, 3, -3, 3, -3]);
    fake.feed("\x1b[<0;5;5M\x1b[<0;5;5m\x1b[<32;5;5M"); // press/release/drag noise
    assert.equal(deltas.length, 5); // unchanged
    detach();
    detach(); // idempotent
    fake.feed("\x1b[<64;1;1M"); // after detach: no capture
    assert.equal(deltas.length, 5);
    const disableCount = fake.output().match(/\x1b\[\?1006l\x1b\[\?1000l/g);
    assert.equal(disableCount?.length, 1);
  });
});

test("wheel capture never consumes keyboard data", () => {
  return withEnv({ PI_VIEW_MOUSE_PROBE_MS: "0" }, () => {
    const fake = new FakeTui();
    const detach = attachMouse(asTui(fake), () => {});
    const plain = fake.feed("hello");
    assert.equal(plain.consumed, false);
    assert.equal(plain.data, "hello");
    assert.equal(plain.result, undefined); // untouched chunk passes through raw

    const loneEsc = fake.feed("\x1b"); // Escape key stays intact
    assert.equal(loneEsc.data, "\x1b");

    const mixed = fake.feed("abc\x1b[<64;1;1Mdef"); // keys around a wheel packet
    assert.equal(mixed.data, "abcdef");

    const fragment = fake.feed("\x1b[<6"); // split SGR packet held, not leaked
    assert.equal(fragment.data, "");
    const rest = fake.feed("4;10;5Mmore");
    assert.equal(rest.data, "more");
    detach();
  });
});

test("attachMouse preserves host-owned mouse modes on detach", () => {
  return withEnv({ PI_VIEW_MOUSE_PROBE_MS: "9999" }, () => {
    const fake = new FakeTui();
    const detach = attachMouse(asTui(fake), () => {});
    assert.ok(fake.output().includes("$p")); // probe queries sent
    assert.ok(!fake.output().includes("\x1b[?1000h")); // query before any enable
    fake.feed("\x1b[?1000;1$y\x1b[?1002;2$y\x1b[?1003;2$y\x1b[?1006;1$y");
    detach();
    assert.ok(!fake.output().includes("\x1b[?1000l")); // leave host modes alone
  });
});

test("attachMouse restores modes when the probe reports them off", () => {
  return withEnv({ PI_VIEW_MOUSE_PROBE_MS: "9999" }, () => {
    const fake = new FakeTui();
    const detach = attachMouse(asTui(fake), () => {});
    fake.feed("\x1b[?1000;2$y\x1b[?1002;2$y\x1b[?1003;2$y\x1b[?1006;2$y");
    detach();
    assert.ok(fake.output().includes("\x1b[?1006l\x1b[?1000l"));
  });
});

test("unanswered probe leaves existing terminal state untouched", () => {
  return withEnv({ PI_VIEW_MOUSE_PROBE_MS: "200" }, () => {
    const fake = new FakeTui();
    const detach = attachMouse(asTui(fake), () => {});
    detach();
    assert.equal(fake.output(), "\x1b[?1000$p\x1b[?1002$p\x1b[?1003$p\x1b[?1006$p");
  });
});
