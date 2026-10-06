// glyphShaper/src/core/forge.ts — font parsing, glyph extraction, and @font-face override

import type { Font as OpentypeFont } from 'opentype.js'
import type { PathCommand, GlyphShaperOptions } from './types'

// ─── Internal font handle ────────────────────────────────────────────────────

/**
 * Opaque wrapper around an opentype.js Font object.
 * Do not construct directly — use parseFont().
 */
export type GlyphFont = { _font: OpentypeFont }

/** What applyFontBlob needs to know about the font a blob came from. */
interface FontMeta {
	/** The font had variable axes (fvar): the override is a static snapshot for every weight */
	variable: boolean
	/** OS/2 usWeightClass (e.g. 700 for a bold file) */
	weight: number
	/** OS/2 fsSelection italic bit */
	italic: boolean
}

/** Metadata per serialised blob (set by fontToBlob, read by applyFontBlob). */
const blobMeta = new WeakMap<Blob, FontMeta>()

/** Most path commands accepted for one glyph (larger paths overflow opentype.js's serialiser). */
const MAX_COMMANDS = 10000

/** Coordinate range font units can hold (CFF and TrueType outlines use 16-bit values). */
const MAX_COORD = 32767

// ─── WOFF2 decompression ──────────────────────────────────────────────────────

/** WOFF2 magic bytes: "wOF2" (0x774F4632) at byte offset 0 */
const WOFF2_MAGIC = 0x774f4632

/**
 * Return true if the buffer starts with the WOFF2 signature.
 * Does not validate the rest of the header.
 */
function isWoff2(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < 4) return false
	return new DataView(buffer).getUint32(0, false) === WOFF2_MAGIC
}

/**
 * A function that decompresses a WOFF2 ArrayBuffer to a raw OTF/TTF ArrayBuffer.
 * Pass one to parseFont() when handling WOFF2 input — the library does not bundle
 * a decompressor itself to stay browser-safe.
 *
 * Example using wawoff2 in a Node.js / server context (the result is a view into wawoff2's WebAssembly
 * memory, so copy just its bytes — `result.buffer` alone is the whole heap, not the font):
 * ```ts
 * import { decompress } from 'wawoff2'
 * const decompressor: Woff2Decompressor = async (buf) => {
 *   const result = await decompress(new Uint8Array(buf))
 *   return result.slice().buffer
 * }
 * ```
 *
 * Example using a fetch-based proxy (browser-safe):
 * ```ts
 * const decompressor: Woff2Decompressor = async (buf) => {
 *   const res = await fetch('/api/decompress-woff2', { method: 'POST', body: buf })
 *   return res.arrayBuffer()
 * }
 * ```
 */
export type Woff2Decompressor = (woff2Buffer: ArrayBuffer) => Promise<ArrayBuffer>

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse an ArrayBuffer into a GlyphFont handle.
 * Accepts TTF, OTF, and WOFF1 natively. For WOFF2 input, provide a
 * woff2Decompressor — the library does not bundle one to stay browser-safe.
 * Throws if the buffer is not a valid font.
 *
 * @param buffer           - Raw font bytes from fetch().arrayBuffer() or FileReader
 * @param woff2Decompressor - Optional decompressor for WOFF2 input (see Woff2Decompressor type)
 */
export async function parseFont(buffer: ArrayBuffer, woff2Decompressor?: Woff2Decompressor): Promise<GlyphFont> {
	let raw = buffer
	if (isWoff2(buffer)) {
		if (!woff2Decompressor) {
			throw new Error(
				'[glyphshaper] WOFF2 input requires a woff2Decompressor. ' +
				'Pass one to parseFont(), or convert the font to TTF / OTF / WOFF first.'
			)
		}
		raw = await woff2Decompressor(buffer)
	}

	// Dynamic import keeps opentype.js out of the critical path and SSR-safe
	const { parse } = await import('opentype.js')
	let font
	try {
		font = parse(raw)
	} catch (err) {
		if (err instanceof Error && /not yet supported|lookup type/i.test(err.message)) {
			throw new Error(
				'This font uses an OpenType feature not yet supported by opentype.js ' +
				`(${err.message}). Try a different font — Inter, Roboto, and most system fonts work well.`
			)
		}
		throw err
	}

	// GSUB (glyph substitution) and GPOS (glyph positioning) tables use features
	// that opentype.js 1.x cannot re-serialise (e.g. lookup type 6 format 2).
	// We only need raw path commands for glyph editing, so drop these tables before
	// they cause toArrayBuffer() to throw. The browser handles shaping on its own.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const t = (font as any).tables
	delete t.gsub
	delete t.gpos
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(font as any).substitution = null
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(font as any).position = null

	// Warn callers if this is a variable font — opentype.js toArrayBuffer() does not
	// re-serialise gvar/fvar/avar/HVAR/MVAR/STAT, so the injected font is a static
	// snapshot. Any CSS font-variation-settings on the page will have no effect after
	// applyFontBlob() is called.
	const isVariable = !!(t.fvar)
	if (isVariable && typeof console !== 'undefined') {
		console.warn(
			'[glyphshaper] This font has variable-font axes (fvar table). ' +
			'After applyFontBlob() the injected override is a static snapshot — ' +
			'opentype.js does not re-serialise gvar/fvar/avar/HVAR/MVAR/STAT. ' +
			'CSS font-variation-settings will have no effect on the overridden family.'
		)
	}

	return { _font: font }
}

// ─── Glyph path access ────────────────────────────────────────────────────────

/**
 * Extract a deep copy of the path commands for the given character.
 * Returns an empty array if the character has no outlines (e.g., space).
 *
 * @param font - Parsed font handle
 * @param char - Single character to look up
 */
export function getGlyphCommands(font: GlyphFont, char: string): PathCommand[] {
	const idx = font._font.charToGlyphIndex(char)
	// Index 0 is the .notdef glyph — returned by opentype.js when the character is
	// not in the cmap. Treat this as "no glyph found" to avoid silently editing .notdef.
	if (idx === 0) return []
	const glyph = font._font.glyphs.get(idx)
	if (!glyph?.path?.commands) return []
	// Deep-copy so the editor state is independent of the font's internal data
	return glyph.path.commands.map(cmd => ({ ...cmd }) as PathCommand)
}

/**
 * The horizontal extent of the outline itself: on-curve points plus the extremes of each curve (not the
 * control points, which can lie far outside the ink).
 */
function pathXBounds(cmds: PathCommand[]): { xMin: number; xMax: number } | null {
	let xMin = Infinity, xMax = -Infinity
	let px = 0
	const add = (x: number) => { if (x < xMin) xMin = x; if (x > xMax) xMax = x }
	for (const cmd of cmds) {
		if (cmd.type === 'Z') continue
		if (cmd.type === 'C') {
			// Extremes of a cubic in x: roots of the derivative.
			const a = -px + 3 * cmd.x1 - 3 * cmd.x2 + cmd.x
			const b = 2 * (px - 2 * cmd.x1 + cmd.x2)
			const c = cmd.x1 - px
			const ts = Math.abs(a) < 1e-9 ? (Math.abs(b) < 1e-9 ? [] : [-c / b]) : (() => {
				const d = b * b - 4 * a * c
				if (d < 0) return []
				const sq = Math.sqrt(d)
				return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]
			})()
			for (const t of ts) {
				if (t > 0 && t < 1) {
					const mt = 1 - t
					add(mt * mt * mt * px + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t * t * t * cmd.x)
				}
			}
		} else if (cmd.type === 'Q') {
			const den = px - 2 * cmd.x1 + cmd.x
			if (Math.abs(den) > 1e-9) {
				const t = (px - cmd.x1) / den
				if (t > 0 && t < 1) add((1 - t) * (1 - t) * px + 2 * (1 - t) * t * cmd.x1 + t * t * cmd.x)
			}
		}
		add(cmd.x)
		px = cmd.x
	}
	return xMin === Infinity ? null : { xMin, xMax }
}

/** Throw a clear error if commands can't be written into a font (non-numbers, out of range, too many). */
function validateCommands(commands: PathCommand[]): void {
	if (!Array.isArray(commands)) throw new TypeError('[glyphshaper] commands must be an array of path commands')
	if (commands.length > MAX_COMMANDS) {
		throw new RangeError(`[glyphshaper] a glyph can have at most ${MAX_COMMANDS} path commands; got ${commands.length}`)
	}
	const keys: Record<string, string[]> = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] }
	commands.forEach((cmd, i) => {
		const fields = cmd && keys[(cmd as { type: string }).type]
		if (!fields) throw new TypeError(`[glyphshaper] command ${i} has an unknown type ${JSON.stringify((cmd as { type?: unknown })?.type)}`)
		for (const k of fields) {
			const v = (cmd as unknown as Record<string, unknown>)[k]
			if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_COORD) {
				throw new RangeError(`[glyphshaper] command ${i} (${cmd.type}) ${k} must be a number between -${MAX_COORD} and ${MAX_COORD}; got ${String(v)}`)
			}
		}
	})
}

/**
 * Write modified path commands back into the font's glyph.
 * This mutates the font object in place so the next call to fontToBlob()
 * regenerates with these commands applied. The left side bearing and advance width follow the new
 * outline (its real extent, keeping the original right side bearing). Throws a RangeError / TypeError
 * for commands that can't be written into a font (non-numbers, coordinates beyond ±32767, more than
 * 10,000 commands) — the font is left unchanged.
 *
 * @param font     - Parsed font handle (mutated in place)
 * @param char     - Character whose glyph to update
 * @param commands - New path commands (from the editor)
 */
export function setGlyphCommands(font: GlyphFont, char: string, commands: PathCommand[]): void {
	const idx = font._font.charToGlyphIndex(char)
	// Index 0 is .notdef — refuse to write it to avoid silently corrupting the wrong glyph
	if (idx === 0) return
	const glyph = font._font.glyphs.get(idx)
	if (!glyph?.path) return
	validateCommands(commands)

	// Preserve the right-side bearing (whitespace cushion after the ink) before mutating the path.
	// advanceWidth = path xMax + RSB, so RSB = advanceWidth - xMax.
	const oldBounds = pathXBounds(glyph.path.commands as PathCommand[])
	const rsb = oldBounds !== null ? (glyph.advanceWidth ?? 0) - oldBounds.xMax : 0

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	glyph.path.commands = commands.map((c) => ({ ...c })) as any

	// Update hmtx metrics to match the new path extent.
	// LSB tracks the new left edge; advanceWidth = new right edge + original RSB.
	if (glyph.advanceWidth !== undefined) {
		const newBounds = pathXBounds(commands)
		if (newBounds !== null) {
			glyph.leftSideBearing = Math.round(newBounds.xMin)
			glyph.advanceWidth = Math.min(65535, Math.max(0, Math.round(newBounds.xMax + rsb)))
		}
	}
}

// ─── Regenerate ───────────────────────────────────────────────────────────────

/**
 * Serialise the (possibly edited) font back to a Blob.
 * The Blob contains a valid OTF/TTF binary and can be used to create a Blob URL.
 *
 * @param font - Parsed (and optionally edited) font handle
 */
export function fontToBlob(font: GlyphFont): Blob {
	// toArrayBuffer() is a public method on opentype.js Font objects; it is what font.download() calls
	// internally. Note: it writes CFF outlines and leaves out GSUB/GPOS/kern (kerning, ligatures),
	// hinting and variable-font tables.
	let buffer: ArrayBuffer
	try {
		buffer = font._font.toArrayBuffer()
	} catch (err) {
		throw new Error(`[glyphshaper] this font could not be written back (${err instanceof Error ? err.message : String(err)})`)
	}
	const blob = new Blob([buffer], { type: 'font/opentype' })
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const t = (font._font as any).tables
	blobMeta.set(blob, {
		variable: !!t?.fvar,
		weight: Number(t?.os2?.usWeightClass) || 400,
		italic: !!((Number(t?.os2?.fsSelection) || 0) & 1),
	})
	return blob
}

// ─── Apply override ───────────────────────────────────────────────────────────

/** Attribute marking an injected @font-face override style (its value is the family). */
const STYLE_ATTR = 'data-glyphshaper-override'

/** The override style element and family for each Blob URL created by applyFontBlob. */
const overrideByUrl = new Map<string, { style: HTMLStyleElement; family: string }>()

/** A CSS string literal: quotes, backslashes and control characters escaped the CSS way. */
function cssString(value: string): string {
	return '"' + value.replace(/[\\"\u0000-\u001f\u007f]/g, (ch) => {
		if (ch === '\\' || ch === '"') return '\\' + ch
		return '\\' + ch.charCodeAt(0).toString(16) + ' '
	}) + '"'
}

/**
 * Inject a dynamic @font-face rule that overrides the named font family with
 * the provided Blob. All text on the page using fontFamily will re-render.
 *
 * If existingUrl is provided it will be revoked before creating the new one.
 * Returns the new Blob URL so the caller can revoke it later.
 *
 * @param fontFamily  - CSS font-family value to override
 * @param blob        - Font data blob from fontToBlob()
 * @param existingUrl - Previously active Blob URL to revoke (optional)
 * @param options     - font-weight / font-style for the @font-face rule
 */
/**
 * Strip characters that could break out of a CSS descriptor value.
 * Allows alphanumeric, spaces, hyphens, and dots — sufficient for font-weight
 * (e.g. "400", "bold", "100 900") and font-style ("normal", "italic", "oblique").
 */
function sanitizeCSSDescriptor(value: string): string {
	return value.replace(/[^a-zA-Z0-9 .\-]/g, '')
}

/**
 * The page's own @font-face for this family that the edited font corresponds to: for a variable font, the
 * face declared with a weight range (else the first); for a static font, the face whose weight covers the
 * font's own weight. Faces glyphShaper injected itself are skipped.
 */
function existingFace(fontFamily: string, meta: FontMeta | undefined): { weight: string; style: string } | null {
	if (typeof document === 'undefined' || !document.fonts) return null
	const faces: FontFace[] = []
	document.fonts.forEach((f) => {
		if (f.family.replace(/^["']|["']$/g, '') === fontFamily) faces.push(f)
	})
	if (faces.length === 0) return null
	const covers = (f: FontFace, w: number) => {
		const [lo, hi] = f.weight.split(/\s+/).map((v) => v === 'normal' ? 400 : v === 'bold' ? 700 : Number(v))
		return Number.isFinite(lo) && w >= lo && w <= (Number.isFinite(hi) ? hi : lo)
	}
	let face: FontFace | undefined
	if (meta?.variable) face = faces.find((f) => /\s/.test(f.weight.trim())) ?? faces[0]
	else if (meta) face = faces.find((f) => covers(f, meta.weight) && (f.style === 'italic') === meta.italic) ?? faces.find((f) => covers(f, meta.weight))
	if (!face) return null
	return { weight: face.weight, style: face.style }
}

export function applyFontBlob(
	fontFamily: string,
	blob: Blob,
	existingUrl?: string,
	options: GlyphShaperOptions = {},
): string {
	if (typeof document === 'undefined') throw new Error('[glyphshaper] applyFontBlob needs a browser document')
	if (existingUrl) revokeFont(existingUrl)
	const url = URL.createObjectURL(blob)
	// Default descriptors: those of the family's existing @font-face that this font replaces (an override only
	// replaces a face whose descriptors match — a variable family declared "100 1000" kept its original when
	// the override said "normal"), else the font's own: every weight for a variable font's static snapshot.
	const meta = blobMeta.get(blob)
	const existing = existingFace(fontFamily, meta)
	const weight = sanitizeCSSDescriptor(String(options.fontWeight ?? existing?.weight ?? (meta ? (meta.variable ? '1 1000' : String(meta.weight)) : 'normal')))
	const style  = sanitizeCSSDescriptor(String(options.fontStyle  ?? existing?.style ?? (meta?.italic ? 'italic' : 'normal')))

	// Save scroll position — font-driven relayout can cause scroll-jump on iOS Safari
	const scrollY = typeof window !== 'undefined' ? window.scrollY : 0

	// One override per family: replace this family's previous one, leave other families' alone.
	document.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ATTR}]`).forEach((old) => {
		if (old.getAttribute(STYLE_ATTR) === fontFamily) old.remove()
	})

	const el = document.createElement('style')
	el.setAttribute(STYLE_ATTR, fontFamily)
	el.textContent = [
		`@font-face {`,
		`  font-family: ${cssString(fontFamily)};`,
		`  src: url(${cssString(url)}) format('opentype');`,
		`  font-weight: ${weight};`,
		`  font-style: ${style};`,
		`  font-display: swap;`,
		`}`,
	].join('\n')
	document.head.appendChild(el)
	overrideByUrl.set(url, { style: el, family: fontFamily })

	// Restore scroll after the font-driven relayout settles (iOS Safari fix)
	if (typeof window !== 'undefined') {
		requestAnimationFrame(() => {
			if (Math.abs(window.scrollY - scrollY) > 2) {
				window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
			}
		})
	}

	return url
}

/**
 * Revoke a previously created Blob URL and remove the override style that uses it (other families'
 * overrides are left alone). Call this when the editor is unmounted or the font is replaced.
 *
 * @param url - Blob URL previously returned by applyFontBlob()
 */
export function revokeFont(url: string): void {
	if (typeof URL !== 'undefined' && url) URL.revokeObjectURL(url)
	const entry = overrideByUrl.get(url)
	if (entry) {
		entry.style.remove()
		overrideByUrl.delete(url)
	}
}

// ─── SVG path helpers ─────────────────────────────────────────────────────────

/**
 * Convert an array of PathCommands to an SVG path `d` attribute string.
 * Uses the glyph coordinate system (y-up) — apply a flip transform in SVG.
 *
 * @param commands - Path commands to serialise
 */
export function commandsToPathD(commands: PathCommand[]): string {
	return commands.map(cmd => {
		switch (cmd.type) {
			case 'M': return `M ${cmd.x} ${cmd.y}`
			case 'L': return `L ${cmd.x} ${cmd.y}`
			case 'C': return `C ${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y}`
			case 'Q': return `Q ${cmd.x1} ${cmd.y1} ${cmd.x} ${cmd.y}`
			case 'Z': return 'Z'
			default:  return ''
		}
	}).filter(Boolean).join(' ')
}
