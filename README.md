# pi-view

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Preview Markdown, code, images, and PDFs inside [Pi](https://pi.dev) and [Oh My Pi](https://github.com/can1357/oh-my-pi). File contents stay out of the model context.

- **Quick Open** — jump to session files with **Cmd+P**, **Ctrl+P on Windows**, or `/view`.
- **Path completion** — press **Tab** to complete a path, then **Enter** to open.
- **Search and navigate** — find text, flip PDF pages, zoom and pan images.
- **Live reload** — previews refresh when the file changes.
- **Edit in place (optional)** — press **`e`** in a text or Markdown preview to edit the real file with [Neovim](#editing-with-neovim).

## Add to your agent

```bash
# Pi
pi install git:github.com/boonlai/pi-view

# Oh My Pi
omp install git+https://github.com/boonlai/pi-view.git
```

Requires **Node.js 22.19+**. Restart your agent after installing.

For OMP's image worker, `node` must be on `PATH`, or set `PI_VIEW_NODE` to its executable path. Package dependencies are installed with pi-view; optional tools for PDFs and editing are described below.

<details>
<summary>Using SSH instead</summary>

```bash
pi install git:git@github.com/boonlai/pi-view
omp install git+ssh://git@github.com/boonlai/pi-view.git
```

</details>

## What works out of the box

After installing pi-view and the requirements above, Quick Open, path completion, text search, and live reload need no extra tools. These preview formats are included:

| Format | Support |
| --- | --- |
| Markdown | Rendered text, local images, source toggle |
| UTF-8 text and code | Syntax highlighting where available, search, wrapping, line numbers |
| PNG, JPEG, GIF, WebP | Zoom and pan in a graphics-capable terminal; GIFs are static |
| SVG | Rasterized; external resources are rejected |

Previews do not open HTML/webpages or execute scripts. Remote Markdown images stay blocked until you press **`R`**, then **`y`**—only allow URLs you trust.

Image decoding is included; you do not need a separate image-conversion utility. See [inline graphics](#inline-graphics) for terminal requirements.

## Optional support

Install only the tools for the features you want. After installing tools or changing `PATH`, open a new terminal and restart your agent so it can find them.

### PDF previews with Poppler

PDF page images and searchable extracted text require **Poppler's command-line tools**: `pdfinfo`, `pdftoppm`, and `pdftotext`. All three must be on `PATH`. PDF text extraction does not perform OCR.

| Platform | Install |
| --- | --- |
| macOS (Homebrew) | `brew install poppler` |
| Debian / Ubuntu | `sudo apt install poppler-utils` |
| Windows (Chocolatey) | `choco install poppler` |

On Windows, Chocolatey's Poppler package does not add its tools directory to `PATH`. Add the installed `Library\bin` directory, typically `C:\ProgramData\chocolatey\lib\poppler\tools\poppler-<version>\Library\bin`, to your user `PATH`. Use the actual installed version directory, not the placeholder.

Check from the terminal where you start Pi or OMP:

```bash
pdfinfo -v
pdftoppm -v
pdftotext -v
```

The output should identify Poppler, not similarly named Xpdf tools. Without Poppler, PDFs cannot be previewed; text, Markdown, and image previews still work.

### Editing with Neovim

Editing requires **Neovim 0.9 or newer**, with `nvim` on `PATH`. No Neovim plugins, Python provider, or language server are required.

| Platform | Install |
| --- | --- |
| macOS (Homebrew) | `brew install neovim` |
| Debian / Ubuntu | `sudo apt install neovim` |
| Windows (Chocolatey) | `choco install neovim` |

Verify with `nvim --version`. Some distribution packages are older than 0.9; if needed, use the [official Neovim installation instructions](https://github.com/neovim/neovim/blob/master/INSTALL.md) to install a supported version.

Press **`e`** while previewing a text, code, or Markdown file to edit the actual file on disk with `nvim`, embedded over pipes without taking over the terminal. Neovim reads the file itself; it does not edit a rendered or sanitized preview copy. Files must first pass the viewer's supported-format and size checks.

- `:w` saves; `:q` / `:wq` return to the refreshed preview; `:q!` discards and returns. Normal Neovim protections stay intact—dirty `:q` refuses, and changed-on-disk warnings apply.
- While editing, keys—including `Esc`, `Ctrl+C`, and the configured Quick Open shortcut—and the mouse wheel go to Neovim. Exit with `:q`, `:wq`, or `:q!` before opening another preview.
- User startup files and user plugins are not loaded; ShaDa and modelines are disabled. Built-in filetype and syntax support remains available. This is a real local editor, not a sandbox: commands you enter can run programs.
- Forced shutdown attempts to preserve Neovim's swap file. If a swap survives, use Neovim's recovery prompt or `nvim -r <file>`; recovery is not a substitute for `:w`.
- Missing or too-old Neovim shows an actionable message and the preview stays usable—press `e` again to retry.

### Inline graphics

Inline images, Markdown images, and PDF page images need a graphics-capable terminal supported by your host. pi-view follows the host's detected image protocol; there is no extra image tool to install.

Unsupported terminals fall back to image labels and PDF text. The PDF text fallback still requires Poppler. Use `/view --diagnostics` to inspect terminal and tool support, or set `PI_VIEW_IMAGES=off` before starting the host to force these fallbacks.

## Open a file

```text
/view README.md
/v src/index.ts
/view "design files/mockup.png"
/view reports/summary.pdf
/view
```

`/v` is shorthand for `/view`. Omit the path for **Quick Open**, or pass a directory to browse it. In Quick Open, use arrows to select, **Tab** to complete, and **Enter** to open.

## Choose a shortcut

Set `PI_VIEW_SHORTCUT` before starting either host to override the default:

```bash
PI_VIEW_SHORTCUT=ctrl+alt+p omp
```

```powershell
$env:PI_VIEW_SHORTCUT = "ctrl+alt+p"
omp
```

Use `ctrl`, `alt`, `shift`, or `super` (Cmd) with a key, such as `ctrl+alt+p`. The binding takes precedence over host shortcuts—including Ctrl+P model cycling on Windows. Restart the host after changing it.

## Keys at a glance

| Action | Keys |
| --- | --- |
| Close | `Esc` / `Ctrl+C` |
| Scroll text | Arrows, `j` / `k`, `PgUp` / `PgDn`, wheel |
| Search text or filter a directory; next / previous match | `/`, then `n` / `N` for search matches |
| Markdown source / PDF text view | `s` |
| Edit the file with embedded Neovim | `e` (text / Markdown previews) |
| Focus a Markdown image / return | `Enter` or `i` / `b` |
| Zoom; fit / actual raster size | `+` / `-`; `0` / `1` |
| Pan a zoomed image or PDF | Arrows |
| Turn PDF pages in image view | `[` / `]`, `PgUp` / `PgDn`, wheel |
| Jump to a PDF page | `g`, page number, `Enter` |
| Reload / browse the directory | `r` / `o` |
| Help / diagnostics | `?` / `d` |

The wheel scrolls text or turns PDF pages—it never zooms. PDF wheel paging has a **200 ms cooldown**; reversing direction is immediate. In PDF text view, the wheel and `PgUp` / `PgDn` scroll text instead.

<details>
<summary>Terminal shortcuts and limits</summary>

- Standalone Quick Open in OMP uses keyboard navigation; wheel input works when it is layered over a preview.
- If the terminal intercepts your shortcut, use `/view` or choose another binding. Ghostty can forward the default Cmd+P with:

  ```ini
  keybind = super+p=csi:112;9u
  ```

- File-size limits: **2 MiB** text (including PDF extraction), **32 MiB** images, **128 MiB** PDFs. Source images are capped at **40 MP** and downsampled to **4096 px per side**; PDF pages to **2400 px** on the longest side. Actual-size zoom uses the rendered raster.

</details>

## Working on pi-view

```bash
npm install
npm run check
npm run build
npm test

pi -e ./dist/index.js
# or
omp -e ./dist/index.js
```

`npm run watch` rebuilds on edits. Restart the host to load a changed bundle, and commit the updated `dist/` files with source changes.
