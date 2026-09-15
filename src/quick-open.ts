import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { relative, sep } from "node:path";
import { Input, matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { completePath, resolvePath, serializeValue } from "./paths.ts";
import { safeText } from "./documents.ts";
import { attachMouse } from "./host.ts";

interface Candidate { path: string; value: string; directory: boolean }

export class QuickOpen implements Component {
  private input = new Input();
  private recent: string[] = [];
  private candidates: Candidate[] = [];
  private selected = 0;
  private loading = true;
  private message = "";
  private closed = false;
  private version = 0;
  private _focused = false;
  private detachMouse?: () => void;

  constructor(private tui: TUI, private theme: Theme, private cwd: string,
    recent: Promise<string[]>, private done: (path: string | undefined) => void) {
    this.input.onSubmit = () => { void this.choose(); };
    void recent.then(paths => {
      if (this.closed) return;
      this.recent = paths.slice(0, 20); this.loading = false;
      if (!this.input.getValue()) this.refresh(); else this.tui.requestRender();
    }, error => {
      if (this.closed) return;
      this.loading = false; this.message = safeText((error as Error).message); this.refresh();
    });
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value; this.input.focused = value;
    if (!value) { this.detachMouse?.(); this.detachMouse = undefined; }
    else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, delta => {
      this.selected = Math.max(0, Math.min(this.candidates.length - 1, this.selected + Math.sign(delta)));
      this.tui.requestRender();
    });
  }
  invalidate(): void { this.input.invalidate(); }
  dispose(): void { this.closed = true; this.version++; this.detachMouse?.(); this.detachMouse = undefined; }

  private displayPath(path: string): string {
    const local = relative(this.cwd, path);
    if (local && local !== ".." && !local.startsWith(`..${sep}`) && !local.startsWith(sep)) return local;
    const home = homedir();
    if (path.startsWith(`${home}${sep}`)) return `~/${path.slice(home.length + 1)}`;
    return path;
  }

  private refresh(): void {
    const value = this.input.getValue();
    this.candidates = value.length === 0
      ? this.recent.map(path => ({ path, value: serializeValue(path), directory: false }))
      : (completePath(value, this.cwd) ?? []).flatMap(item => {
        try { return [{ path: resolvePath(item.value, this.cwd), value: item.value, directory: item.label.endsWith("/") }]; }
        catch { return []; }
      });
    this.selected = value.length ? -1 : (this.candidates.length ? 0 : -1);
    this.version++;
    if (!this.closed) this.tui.requestRender();
  }

  private setValue(value: string): void {
    this.input.setValue(safeText(value).replace(/[\n\t]/g, " "));
    this.input.handleInput("\x1b[F");
    this.message = ""; this.refresh();
  }

  private async choose(): Promise<void> {
    if (this.closed) return;
    const version = ++this.version;
    const candidate = this.selected >= 0 ? this.candidates[this.selected] : undefined;
    const typed = this.input.getValue();
    if (!candidate && !typed) return;
    try {
      const path = candidate?.path ?? resolvePath(typed, this.cwd);
      const info = await stat(path);
      if (this.closed || version !== this.version) return;
      if (info.isDirectory()) {
        if (candidate?.directory) this.setValue(candidate.value);
        else this.setValue(serializeValue(path, true));
        return;
      }
      if (!info.isFile()) throw new Error("Choose a regular file");
      this.dispose(); this.done(path);
    } catch (error) {
      if (!this.closed && version === this.version) {
        this.message = safeText((error as Error).message); this.tui.requestRender();
      }
    }
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "escape")) {
      if (this.input.getValue().length) this.setValue("");
      else { this.dispose(); this.done(undefined); }
      return;
    }
    if (matchesKey(data, "ctrl+c")) { this.dispose(); this.done(undefined); return; }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      const length = this.candidates.length;
      if (length) {
        this.selected = matchesKey(data, "down")
          ? Math.min(length - 1, this.selected + 1)
          : this.selected < 0 ? length - 1 : Math.max(0, this.selected - 1);
      }
      this.tui.requestRender(); return;
    }
    if (matchesKey(data, "tab")) {
      const candidate = this.candidates[this.selected < 0 ? 0 : this.selected];
      if (candidate) this.setValue(candidate.value);
      return;
    }
    if (matchesKey(data, "enter")) { void this.choose(); return; }
    const before = this.input.getValue();
    this.input.handleInput(data);
    const cleaned = safeText(this.input.getValue()).replace(/[\n\t]/g, " ");
    if (cleaned !== this.input.getValue()) this.input.setValue(cleaned);
    if (this.input.getValue() !== before) { this.message = ""; this.refresh(); }
    else this.tui.requestRender();
  }

  render(width: number): string[] {
    width = Math.max(1, width);
    const inner = Math.max(1, width - 4);
    const visible = Math.max(1, Math.min(5, this.tui.terminal.rows - 8));
    const start = Math.max(0, this.selected - visible + 1);
    const text = this.input.getValue();
    const header = text.length ? "Matching paths" : "Recent files in this session";
    const rows = this.candidates.slice(start, start + visible).map((item, index) => {
      const selected = start + index === this.selected;
      const label = `${selected ? ">" : " "} ${safeText(this.displayPath(item.path)).replace(/[\n\t]/g, " ")}${item.directory ? "/" : ""}`;
      return selected ? this.theme.fg("accent", label) : label;
    });
    if (!rows.length) rows.push(this.loading && !text ? "Loading recent files…" : text ? "No suggestions — Enter opens the typed path" : "No recent files — type a path to open");
    while (rows.length < visible) rows.push("");
    const footer = this.message || `↑↓ select · Tab complete · Enter open · Esc ${text ? "clear" : "close"}`;
    const count = this.candidates.length ? ` · ${this.selected < 0 ? "–" : this.selected + 1}/${this.candidates.length}` : "";
    const lines = [
      this.theme.fg("borderAccent", `╭${"─".repeat(Math.max(0, width - 2))}╮`),
      this.theme.bold("Quick Open"),
      this.input.render(inner)[0] ?? "",
      this.theme.fg("muted", `${header}${count}`),
      ...rows,
      this.theme.fg(this.message ? "error" : "dim", footer.replace(/[\n\t]/g, " ")),
      this.theme.fg("borderAccent", `╰${"─".repeat(Math.max(0, width - 2))}╯`),
    ];
    return lines.map((line, index) => index === 0 || index === lines.length - 1
      ? truncateToWidth(line, width, "") : truncateToWidth(`  ${line}`, width, ""));
  }
}
