# Glyph Shaper

[![npm](https://img.shields.io/npm/v/%40liiift-studio%2Fglyphshaper.svg)](https://www.npmjs.com/package/@liiift-studio/glyphshaper) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![part of liiift type-tools](https://img.shields.io/badge/liiift-type--tools-blueviolet)](https://github.com/Liiift-Studio/type-tools)

CSS and JavaScript have no native way to reshape individual glyph outlines after the font loads. `glyphShaper` parses the font binary in the browser, lets you drag bezier control points to edit any character's outline, then regenerates the font and injects a `@font-face` override — every instance of that character on the page re-renders instantly, no page reload required.

<p align="center">
  <img src="https://raw.githubusercontent.com/Liiift-Studio/glyphShaper/main/assets/editor.png?v=1" width="420" alt="The glyphShaper bezier editor open on the letter 'g': every anchor point (filled circles) and bezier handle (outlined circles) of the glyph outline is draggable, with Adjust/Path tabs and an 'Apply to page' button." />
</p>

**[Try it live at glyphshaper.com →](https://glyphshaper.com)** · [npm](https://www.npmjs.com/package/@liiift-studio/glyphshaper) · [GitHub](https://github.com/Liiift-Studio/glyphShaper)

> **What you can build:** bespoke display lettering and logotypes, one-off headline cuts, reshaped terminals or swashes on a single hero letter — any per-glyph outline edit that propagates live to real page text. Drag points in the editor, or drive the lower-level functions to transform outlines programmatically.

TypeScript · React · Requires `opentype.js` (peer dep) · Optional: `wawoff2` for WOFF2 support

---

## Install

```bash
npm install @liiift-studio/glyphshaper opentype.js
```

`opentype.js` is a required peer dependency and must be installed alongside this package.

`wawoff2` is an **optional** peer dependency needed only when working with WOFF2 fonts. Install it if you need to pass a WOFF2 buffer to `parseFont()`:

```bash
npm install wawoff2
```

---

## Usage

> **Next.js App Router:** this library uses browser APIs. Add `"use client"` to any component file that imports from it.

> **Font format:** `glyphShaper` accepts TTF, OTF, WOFF1, and — with the optional `wawoff2` dep and a supplied decompressor — WOFF2. The font must be loaded from a URL accessible to `fetch()` (or supplied as a `File` object via `<input type="file">`). **WOFF2 needs a decompressor:** `useGlyphFont` cannot take one, so it throws on WOFF2 input — for WOFF2, call `parseFont(buffer, woff2Decompressor)` directly (see [`parseFont`](#parsefontbuffer-woff2decompressor) below).

> **Variable fonts:** opentype.js re-serialises only the static outline, not the `gvar`/`fvar`/`avar`/`STAT` tables. After `applyFontBlob()`, the overridden family is a **static snapshot** — any CSS `font-variation-settings` on the page will no longer take effect for that family. `glyphShaper` logs a `console.warn` when it detects a variable font.

### React component

The `GlyphShaperEditor` component handles font loading, character palette, the SVG bezier editor, undo history, and the apply-to-page step in one self-contained component.

```tsx
'use client'
import { useGlyphFont, GlyphShaperEditor } from '@liiift-studio/glyphshaper'

export default function MyPage() {
  const { font } = useGlyphFont('/fonts/MyFont.ttf')

  return (
    <GlyphShaperEditor font={font} fontFamily="MyFont" text="Headline">
      <h1 style={{ fontFamily: 'MyFont' }}>Headline</h1>
    </GlyphShaperEditor>
  )
}
```

The `fontFamily` prop must match the CSS `font-family` value already applied to your page text — this is what the `@font-face` override targets.

<p align="center">
  <img src="https://raw.githubusercontent.com/Liiift-Studio/glyphShaper/main/assets/hero.png?v=1" width="760" alt="The interactive demo: global width and shoulder sliders reshape every glyph at once, with the bezier editor open on one character — the editorial paragraphs below re-render live in the widened, reshaped font." />
</p>

Edited glyphs live only for the page session — to keep one, pass the `Blob` from `fontToBlob(font)` to `URL.createObjectURL()` and offer it via an `<a download="edited.otf">`.

### React hook — font loading only

Use `useGlyphFont` alone when you want to drive the lower-level functions directly.

```tsx
'use client'
import { useGlyphFont, getGlyphCommands, setGlyphCommands, fontToBlob, applyFontBlob } from '@liiift-studio/glyphshaper'

export default function MyEditor() {
  const { font, loading, error } = useGlyphFont('/fonts/MyFont.ttf')

  if (loading) return <p>Loading…</p>
  if (error)   return <p>Error: {error}</p>
  if (!font)   return null

  const cmds = getGlyphCommands(font, 'A')
  // … modify cmds …
  setGlyphCommands(font, 'A', cmds)
  const blob = fontToBlob(font)
  applyFontBlob('MyFont', blob)
}
```

### Vanilla JS

```ts
import { parseFont, getGlyphCommands, setGlyphCommands, fontToBlob, applyFontBlob } from '@liiift-studio/glyphshaper'

const res    = await fetch('/fonts/MyFont.ttf')
const buffer = await res.arrayBuffer()
const font   = await parseFont(buffer)

// Read glyph outline commands for 'A'
const cmds = getGlyphCommands(font, 'A')

// Modify commands (e.g. shift the first anchor point)
const modified = cmds.map((cmd, i) =>
  i === 0 && cmd.type === 'M' ? { ...cmd, x: cmd.x + 20 } : cmd
)

// Write back and inject override
setGlyphCommands(font, 'A', modified)
const blob = fontToBlob(font)
applyFontBlob('MyFont', blob)
```

### TypeScript

```ts
import type { GlyphFont, PathCommand, GlyphShaperOptions, CmdM, CmdL, CmdC, CmdQ, CmdZ } from '@liiift-studio/glyphshaper'

const opts: GlyphShaperOptions = {
  fontWeight: 'bold',
  fontStyle: 'normal',
}
```

---

## API

### `useGlyphFont(source)`

React hook. Fetches and parses a font from a URL string or `File` object. Returns `{ font, loading, error }`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string \| File \| null` | Font URL, user-uploaded `File`, or `null` to reset |

### `parseFont(buffer, woff2Decompressor?)`

Async. Parses an `ArrayBuffer` (TTF, OTF, or WOFF1) into a `GlyphFont` handle. For WOFF2 input, you must provide a `woff2Decompressor` function — WOFF2 decompression is not automatic. Without one, parsing a WOFF2 buffer throws with a descriptive error.

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `ArrayBuffer` | Raw font bytes |
| `woff2Decompressor` | `Woff2Decompressor \| undefined` | Optional decompressor for WOFF2 input (see `Woff2Decompressor` type) |

### `getGlyphCommands(font, char)`

Returns a deep copy of the path commands for `char` as a `PathCommand[]`. Returns `[]` for characters with no outlines (e.g., space).

### `setGlyphCommands(font, char, commands)`

Writes modified commands back into the font object in place. The change takes effect on the next `fontToBlob()` call.

### `fontToBlob(font)`

Serialises the (possibly modified) font using opentype.js's `toArrayBuffer()` and wraps the bytes in a `Blob` (`font/opentype`), ready to pass to `applyFontBlob()`.

### `applyFontBlob(fontFamily, blob, previousUrl?, options?)`

Injects a `@font-face` override rule targeting `fontFamily` with the supplied blob. Creates a Blob URL, appends a `<style>` tag to the document, and returns the Blob URL so it can be revoked later. If `previousUrl` is supplied it is revoked before the new rule is injected.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fontFamily` | `string` | CSS font-family value to override |
| `blob` | `Blob` | Font data from `fontToBlob()` |
| `previousUrl` | `string \| undefined` | Blob URL from a previous call to revoke |
| `options` | `GlyphShaperOptions \| undefined` | `fontWeight` and `fontStyle` for the `@font-face` descriptor |

### `revokeFont(url)`

Revokes a Blob URL returned by `applyFontBlob` and removes the corresponding `<style>` tag from the document.

### `commandsToPathD(commands)`

Converts a `PathCommand[]` to an SVG `d` string suitable for use in a `<path>` element.

### `GlyphSvgEditor`

Lower-level React component that exposes only the SVG bezier editor. Use this when you want to manage font loading and command state yourself. Accepts `GlyphSvgEditorProps` — see source types for the full prop list.

---

## `GlyphShaperEditor` props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `font` | `GlyphFont \| null` | — | Parsed font from `useGlyphFont()` or `parseFont()`. Pass `null` while loading |
| `fontFamily` | `string` | — | CSS font-family name the `@font-face` override will target |
| `text` | `string` | `'Typography'` | Text used to derive the character palette. Unique printable characters appear as clickable tiles |
| `children` | `ReactNode` | — | Content rendered with the font applied. If omitted, `text` is rendered as a paragraph |
| `selectedChar` | `string \| null \| undefined` | `undefined` | Controlled selected character. Pass `null` to close the editor programmatically. Omit for uncontrolled mode |
| `onClose` | `() => void` | — | Called when the editor closes (Cancel or after Apply). Use this to reset `selectedChar` in the parent |
| `onApply` | `(char: string, commands: PathCommand[]) => void` | — | Called after "Apply to page" with the edited character and its new commands |
| `hidePalette` | `boolean` | `false` | Hide the character tile palette row (useful when selection is driven externally) |

---

## How it works

**Font parsing:** `parseFont()` uses dynamic `import('opentype.js')` so the parser is only loaded when called. WOFF2 fonts are first decompressed with `import('wawoff2')` (WASM brotli decoder), then passed to opentype.js as raw bytes.

**Path command model:** opentype.js exposes each glyph's outline as a flat array of path commands (`M`, `L`, `C`, `Q`, `Z`). `glyphShaper` deep-copies this array into React state so edits are non-destructive until the user clicks "Apply".

**SVG editor:** The inline bezier editor renders the glyph outline in a fixed-coordinate SVG (`viewBox 0 0 360 360`). A `y-flip` transform reconciles glyph space (y-up) with SVG space (y-down). Pointer capture keeps drags active when the cursor leaves a control point circle. `getScreenCTM().inverse()` converts pointer events at any CSS scale back to viewBox coordinates.

**Undo:** Each drag operation pushes a pre-drag snapshot of the commands array onto a bounded history stack (max 50 entries). Undo restores the last snapshot. `Ctrl+Z` / `Cmd+Z` is handled via a `keydown` listener while the editor panel is open.

**Font-face override:** After "Apply", `setGlyphCommands` writes the modified path back into the live opentype.js font object, `fontToBlob()` re-serialises the entire font to an `ArrayBuffer`, and `applyFontBlob()` creates a Blob URL and injects a late `@font-face` rule reusing the same family name. Because `@font-face` resolves by family name and source order (not selector specificity), the later rule wins, and every instance of the character on the page re-renders immediately without a reload.

---

## Privacy & lifecycle

- **Everything runs in the browser.** The font is parsed, edited, and re-serialised entirely client-side. `glyphShaper` makes no network calls and sends no telemetry — your font bytes never leave the page.
- **The override is ephemeral.** `applyFontBlob()` creates a same-origin `blob:` URL and a `<style>` tag that live only for the page session. Nothing is persisted; a reload restores the original font.
- **Clean up to avoid leaks.** Each `applyFontBlob()` returns its Blob URL. Pass it back as `previousUrl` on the next call, or call `revokeFont(url)` when done — otherwise the Blob URL and its `<style>` tag are orphaned. `GlyphShaperEditor` manages this for you; if you drive the lower-level functions yourself, you own the cleanup.
- **Licensing is your responsibility.** Reshaping and re-serialising a font may be restricted by its EULA. Only edit fonts you are licensed to modify.

---

## Peer dependencies

| Package | Required? | Purpose |
|---------|-----------|---------|
| `opentype.js` | Yes | Font parsing, glyph path access, and font serialisation |
| `wawoff2` | Optional | WOFF2 decompression (WASM brotli) — only needed when passing a WOFF2 buffer to `parseFont()` |
| `react` / `react-dom` | Optional | Only needed for `GlyphShaperEditor`, `GlyphSvgEditor`, and `useGlyphFont` |

If you are bundling for the browser and your bundler tries to resolve Node.js built-ins (`fs`, `path`) pulled in by `wawoff2`, stub them as empty modules. For webpack / Next.js:

```js
// next.config.ts / webpack config
config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false }
```
