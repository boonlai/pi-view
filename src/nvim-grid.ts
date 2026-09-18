/**
 * Client state for one Neovim ext_linegrid grid plus its ANSI renderer.
 *
 * The grid mirrors the documented single-grid event stream (grid_resize,
 * grid_line, grid_cursor_goto, grid_scroll, grid_clear, hl_attr_define) and
 * renders committed rows as terminal lines. Absent foreground/background
 * stay unset so text inherits the terminal palette like the rest of the
 * preview; set colors come from the protocol's rgb_attr on truecolor
 * terminals and from its cterm_attr palette indexes otherwise — no local
 * color math.
 */

import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

export interface GridAttr {
  foreground?: number;
  background?: number;
  ctermForeground?: number;
  ctermBackground?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
  strikethrough?: boolean;
}

interface GridCell { text: string; attr: number }

const RESET = "\x1b[0m";

export class NvimGrid {
  width = 0;
  height = 0;
  cursor?: { row: number; col: number };
  busy = false;
  private attrs = new Map<number, GridAttr>();
  private rows: GridCell[][] = [];
  private sgrCache = new Map<number, string>();

  constructor(private trueColor: boolean) {}

  /**
   * Apply one UI event tuple from a redraw batch. Unknown events and
   * parameters appended by future Neovim versions are ignored by contract.
   */
  handle(name: string, params: unknown[]): void {
    switch (name) {
      case "grid_resize": {
        const [width, height] = numbers(params, 1, 2);
        this.width = width; this.height = height;
        this.rows = blankRows(height, width);
        this.cursor = undefined;
        this.sgrCache.clear();
        break;
      }
      case "grid_clear":
        this.rows = blankRows(this.height, this.width);
        break;
      case "grid_destroy":
        this.rows = [];
        this.cursor = undefined;
        break;
      case "grid_cursor_goto": {
        const [row, col] = numbers(params, 1, 2);
        this.cursor = { row, col };
        break;
      }
      case "grid_line": {
        const row = params[1], colStart = params[2], cells = params[3];
        if (typeof row === "number" && typeof colStart === "number" && Array.isArray(cells)) {
          this.applyLine(row, colStart, cells);
        }
        break;
      }
      case "grid_scroll": {
        const [top, bottom, left, right, count] = numbers(params, 1, 2, 3, 4, 5);
        this.applyScroll(top, bottom, left, right, count);
        break;
      }
      case "hl_attr_define": {
        const id = params[0];
        if (typeof id !== "number") break;
        this.attrs.set(id, parseAttr(params[1] as Record<string, unknown> | undefined, params[2] as Record<string, unknown> | undefined));
        this.sgrCache.delete(id);
        break;
      }
      // default_colors_set is deliberately ignored: the embedded editor keeps
      // the terminal's own default colors, matching the preview around it.
      default: break;
    }
  }

  private applyLine(row: number, colStart: number, cells: unknown[]): void {
    if (row < 0 || row >= this.rows.length || colStart < 0 || colStart >= this.width) return;
    const line = this.rows[row];
    let col = colStart;
    let attr = 0;
    for (const entry of cells) {
      if (!Array.isArray(entry)) continue;
      const [text, hlId, repeat] = entry as [string, number?, number?];
      if (typeof hlId === "number") attr = hlId;
      const times = typeof repeat === "number" && repeat > 0 ? repeat : 1;
      for (let i = 0; i < times && col < this.width; i++) {
        line[col++] = { text, attr };
      }
    }
  }

  private applyScroll(top: number, bottom: number, left: number, right: number, count: number): void {
    if (count === 0 || this.rows.length === 0) return;
    const topRow = clamp(top, 0, this.rows.length);
    const bottomRow = clamp(bottom, topRow, this.rows.length); // end-exclusive per the protocol
    const leftCol = clamp(left, 0, this.width);
    const rightCol = clamp(right, leftCol, this.width);
    const region = bottomRow - topRow;
    const shift = Math.min(Math.abs(count), region);
    const blank = (): GridCell[] => blankRow(rightCol - leftCol);
    if (count > 0) {
      // Move the region up; the vacated bottom rows are redrawn by Nvim right
      // after the scroll event, but start blank so nothing stale survives.
      for (let row = topRow; row < bottomRow; row++) {
        const source = row + shift;
        this.rows[row].splice(leftCol, rightCol - leftCol,
          ...(source < bottomRow ? this.rows[source].slice(leftCol, rightCol) : blank()));
      }
    } else {
      for (let row = bottomRow - 1; row >= topRow; row--) {
        const source = row - shift;
        this.rows[row].splice(leftCol, rightCol - leftCol,
          ...(source >= topRow ? this.rows[source].slice(leftCol, rightCol) : blank()));
      }
    }
  }

  /** Committed ANSI lines with a software cursor and host cursor marker when focused. */
  render(focused: boolean): string[] {
    const lines: string[] = [];
    for (let row = 0; row < this.rows.length; row++) lines.push(this.renderRow(row, focused));
    return lines;
  }

  private renderRow(row: number, focused: boolean): string {
    const cells = this.rows[row] ?? [];
    const cursor = focused && !this.busy ? this.cursor : undefined;
    let out = "";
    let open = "";
    let markerAt = -1;
    let column = 0;
    for (const cell of cells) {
      // Wide characters anchor the cursor to their left half.
      const width = visibleWidth(cell.text);
      const atCursor = cursor?.row === row && markerAt < 0 && column + width > cursor.col;
      if (atCursor) markerAt = out.length;
      const sgr = this.sgrFor(cell.attr);
      if (sgr !== open) {
        out += sgr === "" ? (open === "" ? "" : RESET) : RESET + sgr;
        open = sgr;
      }
      if (atCursor) {
        // The host marker only positions an optional hardware cursor. Paint
        // one too, as Pi/OMP inputs do, without changing host cursor settings.
        // Cancel an existing SGR 7 rather than making it disappear into a
        // reversed highlight; explicit swapped colors still need inversion.
        const attr = this.attrs.get(cell.attr);
        const reversed = attr?.reverse && (attr.foreground === undefined || attr.background === undefined);
        out += (reversed ? "\x1b[27m" : "\x1b[7m") + cell.text + RESET + sgr;
      } else {
        out += cell.text;
      }
      column += width;
    }
    if (open !== "") out += RESET;
    if (cursor?.row === row && markerAt < 0) markerAt = out.length;
    if (markerAt >= 0) out = out.slice(0, markerAt) + CURSOR_MARKER + out.slice(markerAt);
    return out;
  }

  private sgrFor(attrId: number): string {
    if (attrId === 0) return "";
    const cached = this.sgrCache.get(attrId);
    if (cached !== undefined) return cached;
    const attr = this.attrs.get(attrId);
    let sgr = "";
    if (attr) {
      const parts: string[] = [];
      if (attr.bold) parts.push("1");
      if (attr.dim) parts.push("2");
      if (attr.italic) parts.push("3");
      if (attr.underline) parts.push("4");
      if (attr.strikethrough) parts.push("9");
      let foreground = attr.foreground;
      let background = attr.background;
      let ctermForeground = attr.ctermForeground;
      let ctermBackground = attr.ctermBackground;
      if (attr.reverse && foreground !== undefined && background !== undefined) {
        // Both colors known: swap deterministically instead of relying on SGR 7.
        [foreground, background] = [background, foreground];
        [ctermForeground, ctermBackground] = [ctermBackground, ctermForeground];
      } else if (attr.reverse) {
        parts.push("7");
      }
      const fg = this.colorSgr(foreground, ctermForeground, true);
      const bg = this.colorSgr(background, ctermBackground, false);
      if (fg) parts.push(fg);
      if (bg) parts.push(bg);
      if (parts.length) sgr = `\x1b[${parts.join(";")}m`;
    }
    this.sgrCache.set(attrId, sgr);
    return sgr;
  }

  // rgb_attr on truecolor terminals; the protocol's own cterm palette index
  // otherwise. When the preferred form is absent, the other one still applies.
  private colorSgr(rgb: number | undefined, cterm: number | undefined, foreground: boolean): string {
    const code = foreground ? 38 : 48;
    if (this.trueColor || cterm === undefined) {
      if (rgb === undefined) return "";
      return `${code};2;${(rgb >> 16) & 0xff};${(rgb >> 8) & 0xff};${rgb & 0xff}`;
    }
    return `${code};5;${cterm}`;
  }
}

function parseAttr(rgbAttr: Record<string, unknown> | undefined, ctermAttr: Record<string, unknown> | undefined): GridAttr {
  const attr: GridAttr = {};
  if (typeof rgbAttr?.foreground === "number") attr.foreground = rgbAttr.foreground;
  if (typeof rgbAttr?.background === "number") attr.background = rgbAttr.background;
  if (typeof ctermAttr?.foreground === "number") attr.ctermForeground = ctermAttr.foreground;
  if (typeof ctermAttr?.background === "number") attr.ctermBackground = ctermAttr.background;
  for (const key of ["bold", "dim", "italic", "reverse", "strikethrough"] as const) {
    if (rgbAttr?.[key] === true) attr[key] = true;
  }
  // Underline variants (underline, undercurl, underdouble, …) degrade to SGR 4.
  if (rgbAttr?.underline === true || rgbAttr?.undercurl === true || rgbAttr?.underdouble === true
    || rgbAttr?.underdotted === true || rgbAttr?.underdashed === true) attr.underline = true;
  return attr;
}

function numbers(params: unknown[], ...indexes: number[]): number[] {
  return indexes.map(index => (typeof params[index] === "number" ? params[index] as number : 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function blankRow(width: number): GridCell[] {
  return Array.from({ length: Math.max(0, width) }, () => ({ text: " ", attr: 0 }));
}

function blankRows(height: number, width: number): GridCell[][] {
  return Array.from({ length: Math.max(0, height) }, () => blankRow(width));
}
