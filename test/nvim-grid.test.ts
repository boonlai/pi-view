import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { NvimGrid } from "../src/nvim-grid.ts";

// Feed one redraw batch exactly as it arrives from Neovim: each element is
// [eventName, ...tuples] and every tuple carries one event's parameters.
function redraw(target: NvimGrid, ...events: unknown[][]): void {
  for (const [name, ...rest] of events) {
    for (const tuple of rest) target.handle(name as string, tuple as unknown[]);
  }
}

// One row of distinct single-column cells, mirroring how Neovim sends
// ordinary text: one grid cell per character. The linegrid repeat field
// repeats a whole cell and is reserved for identical-character runs (space
// fills), so it is never used to abbreviate distinct text.
function line(text: string, attr = 0): unknown[] {
  return [...text].map(char => [char, attr]);
}

function plain(row: string | undefined): string {
  return stripVTControlCharacters(row ?? "");
}

// The SGR parameters each rendered sequence carries; combined parameters in
// one sequence are valid renderer output, so assertions inspect codes, not
// sequence grouping.
function sgrCodes(row: string | undefined): string[] {
  return [...(row ?? "").matchAll(/\x1b\[([0-9;]+)m/g)].map(match => match[1]!);
}

test("grid_line paints cells, whole-cell repeats, and column offsets", () => {
  const view = new NvimGrid(true);
  redraw(view, ["grid_resize", [1, 10, 1]], ["grid_line", [1, 0, 0, line("hello")]]);
  assert.equal(plain(view.render(false)[0]), "hello     ");
  // A repeat paints the same cell repeatedly and never past the grid edge.
  redraw(view, ["grid_line", [1, 0, 6, [["x", 0, 3]]]]);
  redraw(view, ["grid_line", [1, 0, 9, [["y", 0, 5]]]]);
  assert.equal(plain(view.render(false)[0]), "hello xxxy");
  // col_start targets the affected run; earlier cells stay intact.
  redraw(view, ["grid_line", [1, 0, 1, [["E", 0]]]]);
  assert.equal(plain(view.render(false)[0]), "hEllo xxxy");
  // Unknown events and future extra parameters are ignored by contract.
  assert.doesNotThrow(() => redraw(view, ["totally_new_event", [1, 2, 3]], ["grid_line", [1, 0, 0, line("h"), 42]]));
  assert.equal(plain(view.render(false)[0]), "hEllo xxxy");
});

test("highlight attrs render as SGR; cells without attributes stay unstyled", () => {
  const view = new NvimGrid(true);
  redraw(view,
    ["grid_resize", [1, 8, 1]],
    ["hl_attr_define", [7, { bold: true }, {}, []]],
    ["hl_attr_define", [9, { foreground: 0xff0000 }, { foreground: 1 }, []]],
    ["hl_attr_define", [11, {}, {}, []]],
    ["grid_line", [1, 0, 0, [["b", 7], ["r", 9], ["p", 11], [" ", 0, 5]]]]);
  const [row] = view.render(false);
  assert.ok(row!.includes("\x1b[1m"), `expected bold SGR in ${JSON.stringify(row)}`);
  assert.ok(row!.includes("\x1b[38;2;255;0;0m"), `expected truecolor fg in ${JSON.stringify(row)}`);
  // Attr 11 and attr 0 carry no colors or flags: the characters render with
  // the terminal's own defaults, exactly like the preview around them.
  assert.equal(plain(row), "brp     ");
});

test("256-color terminals use the protocol cterm palette, not quantization", () => {
  const view = new NvimGrid(false);
  redraw(view,
    ["grid_resize", [1, 4, 1]],
    ["hl_attr_define", [5, { foreground: 0x8700af, background: 0x005f00 }, { foreground: 97, background: 22 }, []]],
    ["grid_line", [1, 0, 0, [["x", 5]]]]);
  const row = view.render(false)[0] ?? "";
  assert.ok(row.includes("38;5;97"), `expected cterm fg palette index in ${JSON.stringify(row)}`);
  assert.ok(row.includes("48;5;22"), `expected cterm bg palette index in ${JSON.stringify(row)}`);
  assert.ok(!row.includes(";2;"), `expected no truecolor component in ${JSON.stringify(row)}`);
});

test("reverse swaps known colors and falls back to SGR 7 without them", () => {
  const view = new NvimGrid(true);
  redraw(view,
    ["grid_resize", [1, 2, 2]],
    ["hl_attr_define", [3, { foreground: 0x111111, background: 0xeeeeee, reverse: true }, {}, []]],
    ["hl_attr_define", [4, { reverse: true }, {}, []]],
    ["grid_line", [1, 0, 0, [["a", 3]]]],
    ["grid_line", [1, 1, 0, [["b", 4]]]]);
  const [swapped, fallback] = view.render(false);
  assert.ok(swapped!.includes("38;2;238;238;238"), `expected swapped fg in ${JSON.stringify(swapped)}`);
  assert.ok(swapped!.includes("48;2;17;17;17"), `expected swapped bg in ${JSON.stringify(swapped)}`);
  const swappedCodes = sgrCodes(swapped);
  assert.ok(!swappedCodes.some(code => code.split(";").includes("7")),
    `both colors known, so SGR 7 must not be used: ${JSON.stringify(swapped)}`);
  assert.ok(sgrCodes(fallback).some(code => code.split(";").includes("7")),
    `no colors to swap, so SGR 7 is the fallback: ${JSON.stringify(fallback)}`);
  assert.ok(!fallback!.includes("38;2;") && !fallback!.includes("48;2;"),
    `the fallback cell must not invent colors: ${JSON.stringify(fallback)}`);
});

test("cursor marker anchors before wide cells and tracks off-row cursors", () => {
  const view = new NvimGrid(true);
  redraw(view,
    // Neovim sends the wide character followed by an empty trailing half-cell.
    ["grid_resize", [1, 6, 2]],
    ["grid_line", [1, 0, 0, [["汉", 0], ["", 0], ["x", 0]]]],
    ["grid_cursor_goto", [1, 0, 1]]);
  const [wide] = view.render(true);
  const markerIn = wide!.indexOf(CURSOR_MARKER);
  assert.ok(markerIn >= 0, `expected cursor marker in ${JSON.stringify(wide)}`);
  assert.ok(wide!.slice(markerIn).startsWith(CURSOR_MARKER + "汉"), `expected marker before the wide char in ${JSON.stringify(wide)}`);
  redraw(view, ["grid_cursor_goto", [1, 1, 9]]);
  const [, beyond] = view.render(true);
  assert.ok(beyond!.endsWith(CURSOR_MARKER), `expected marker at end of line in ${JSON.stringify(beyond)}`);
  assert.ok(!view.render(false).some(rowText => rowText.includes(CURSOR_MARKER)), "unfocused renders carry no marker");
});

test("grid_scroll moves the region and blanks vacated rows", () => {
  const view = new NvimGrid(true);
  redraw(view,
    ["grid_resize", [1, 6, 4]],
    ["grid_line", [1, 0, 0, line("one")]],
    ["grid_line", [1, 1, 0, line("two")]],
    ["grid_line", [1, 2, 0, line("three")]],
    ["grid_scroll", [1, 0, 4, 0, 6, 1, 0]]);
  assert.deepEqual(view.render(false).map(row => plain(row).trimEnd()), ["two", "three", "", ""]);
  // A downward shift blanks the vacated top row; the former bottom row is
  // pushed out of the region (Neovim repaints it right after the event).
  redraw(view, ["grid_scroll", [1, 0, 4, 0, 6, -1, 0]]);
  assert.deepEqual(view.render(false).map(row => plain(row).trimEnd()), ["", "two", "three", ""]);
  redraw(view, ["grid_line", [1, 3, 0, line("four")]], ["grid_scroll", [1, 0, 4, 0, 6, 2, 0]]);
  assert.deepEqual(view.render(false).map(row => plain(row).trimEnd()), ["three", "four", "", ""]);
});

test("grid_clear resets all rows and grid_destroy frees them", () => {
  const view = new NvimGrid(true);
  redraw(view, ["grid_resize", [1, 4, 2]], ["grid_line", [1, 0, 0, line("keep")]]);
  assert.equal(plain(view.render(false)[0]).trimEnd(), "keep");
  redraw(view, ["grid_clear", [1]]);
  assert.deepEqual(view.render(false).map(row => plain(row).trimEnd()), ["", ""]);
  redraw(view, ["grid_line", [1, 0, 0, line("temp")]], ["grid_destroy", [1]]);
  assert.equal(view.render(false).length, 0);
});
