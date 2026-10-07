// glyphShaper/src/core/patch.ts — table-level write path: re-encode only the edited glyphs (glyf, loca, hmtx) and copy every other table byte-for-byte

import type { PathCommand } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One TrueType outline point: font units, and whether it lies on the curve. */
export interface GlyphPoint { x: number; y: number; on: boolean }

/** An sfnt file split into its tables (each a private copy of the bytes). */
export interface SfntTables {
	/** The sfnt version tag (0x00010000 or 'true' for TrueType outlines, 'OTTO' for CFF) */
	sfntVersion: number
	/** Table bytes by four-character tag */
	tables: Record<string, Uint8Array>
}

/** One glyph edit for patchGlyphs(). */
export interface GlyphEdit {
	/** The new outline */
	commands: PathCommand[]
	/** The new advance width in font units (omit to keep the glyph's advance) */
	advanceWidth?: number
}

/** What patchGlyphs() wrote. */
export interface PatchResult {
	/** The new font file */
	bytes: Uint8Array
	/** Glyph ids whose outline was re-encoded */
	edited: number[]
	/**
	 * Glyph ids of a variable font whose point structure changed, so their own variation data was removed:
	 * these glyphs keep one shape at every axis setting. Every other glyph still varies.
	 */
	frozen: number[]
}

/** The result of compareFontTables(). */
export interface TableComparison {
	/** Tables whose bytes are identical in both files */
	kept: string[]
	/** Tables present in both files with different bytes */
	changed: string[]
	/** Tables in the first file that are missing from the second */
	dropped: string[]
	/** Tables in the second file that the first didn't have */
	added: string[]
}

/** sfnt version tags that carry TrueType (glyf) outlines. */
const TRUETYPE_VERSIONS = [0x00010000, 0x74727565]

/** The sfnt version tag of a CFF-flavoured OpenType font ('OTTO'). */
const CFF_VERSION = 0x4f54544f

/** The WOFF 1.0 signature ('wOFF'). */
const WOFF_MAGIC = 0x774f4646

/** Largest coordinate a glyf point can hold (a signed 16-bit value). */
const MAX_GLYF_COORD = 32767

/** How far (font units) an on-curve point may sit from the midpoint of its off-curve neighbours and still be implied. */
const IMPLIED_TOLERANCE = 0.51

/** Tables the patch path reads or rewrites: all must be present. */
const REQUIRED_TABLES = ['glyf', 'loca', 'head', 'maxp', 'hhea', 'hmtx']

// ─── sfnt container ───────────────────────────────────────────────────────────

/** A DataView over a Uint8Array's own bytes. */
function view(u8: Uint8Array): DataView {
	return new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
}

/**
 * Split an sfnt file (TTF or OTF) into its tables. Throws if the buffer is not an sfnt file or a table
 * points outside it.
 *
 * @param buffer - Raw font bytes (not WOFF or WOFF2: decompress those first)
 */
export function readSfnt(buffer: ArrayBuffer | Uint8Array): SfntTables {
	const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	if (u8.length < 12) throw new Error('[glyphshaper] not a font file (too short)')
	const d = view(u8)
	const sfntVersion = d.getUint32(0)
	if (!TRUETYPE_VERSIONS.includes(sfntVersion) && sfntVersion !== CFF_VERSION) {
		throw new Error('[glyphshaper] not an sfnt font file (TTF or OTF)')
	}
	const n = d.getUint16(4)
	if (12 + 16 * n > u8.length) throw new Error('[glyphshaper] the font table directory is cut short')
	const tables: Record<string, Uint8Array> = {}
	for (let i = 0; i < n; i++) {
		const p = 12 + 16 * i
		const tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3])
		const off = d.getUint32(p + 8), len = d.getUint32(p + 12)
		if (off + len > u8.length) throw new Error(`[glyphshaper] table ${tag} points outside the file`)
		tables[tag] = u8.slice(off, off + len)
	}
	return { sfntVersion, tables }
}

/** OpenType table checksum: the sum of big-endian uint32 values, the table zero-padded to four bytes. */
function checksum(u8: Uint8Array): number {
	const d = view(u8)
	const whole = u8.length & ~3
	let s = 0
	for (let i = 0; i < whole; i += 4) s = (s + d.getUint32(i)) >>> 0
	if (whole < u8.length) {
		let last = 0
		for (let i = whole; i < whole + 4; i++) last = (last << 8) | (i < u8.length ? u8[i] : 0)
		s = (s + (last >>> 0)) >>> 0
	}
	return s
}

/**
 * Assemble an sfnt file from tables: writes the directory in tag order, pads each table to four bytes,
 * and recomputes every table checksum and head.checkSumAdjustment.
 *
 * @param sfntVersion - The version tag from readSfnt()
 * @param tables      - Table bytes by tag (head is copied before its checksum field is changed)
 */
export function writeSfnt(sfntVersion: number, tables: Record<string, Uint8Array>): Uint8Array {
	const all = { ...tables }
	if (all.head) {
		all.head = all.head.slice()
		view(all.head).setUint32(8, 0)
	}
	const tags = Object.keys(all).sort()
	const n = tags.length
	const entrySelector = Math.floor(Math.log2(Math.max(1, n)))
	const searchRange = (2 ** entrySelector) * 16
	let off = 12 + 16 * n
	const offsets: Record<string, number> = {}
	for (const t of tags) { offsets[t] = off; off += (all[t].length + 3) & ~3 }
	const out = new Uint8Array(off)
	const d = view(out)
	d.setUint32(0, sfntVersion)
	d.setUint16(4, n)
	d.setUint16(6, searchRange)
	d.setUint16(8, entrySelector)
	d.setUint16(10, n * 16 - searchRange)
	tags.forEach((t, i) => {
		const p = 12 + 16 * i
		for (let k = 0; k < 4; k++) out[p + k] = t.charCodeAt(k)
		d.setUint32(p + 4, checksum(all[t]))
		d.setUint32(p + 8, offsets[t])
		d.setUint32(p + 12, all[t].length)
		out.set(all[t], offsets[t])
	})
	if (all.head) d.setUint32(offsets.head + 8, (0xb1b0afba - checksum(out)) >>> 0)
	return out
}

/**
 * True if the file's outlines can be patched in place: an sfnt file with TrueType (glyf) outlines.
 * CFF and CFF2 fonts return false.
 *
 * @param sfnt - Tables from readSfnt()
 */
export function canPatch(sfnt: SfntTables): boolean {
	return REQUIRED_TABLES.every((t) => !!sfnt.tables[t])
}

/**
 * Unpack a WOFF 1.0 file into the sfnt file inside it. Uses the platform's DecompressionStream; resolves
 * to null when the input isn't WOFF or the platform has no DecompressionStream.
 *
 * @param buffer - Raw WOFF bytes
 */
export async function woffToSfnt(buffer: ArrayBuffer): Promise<Uint8Array | null> {
	const u8 = new Uint8Array(buffer)
	if (u8.length < 44) return null
	const d = view(u8)
	if (d.getUint32(0) !== WOFF_MAGIC) return null
	if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return null
	const sfntVersion = d.getUint32(4)
	const n = d.getUint16(12)
	const tables: Record<string, Uint8Array> = {}
	for (let i = 0; i < n; i++) {
		const p = 44 + 20 * i
		if (p + 20 > u8.length) return null
		const tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3])
		const off = d.getUint32(p + 4), compLen = d.getUint32(p + 8), origLen = d.getUint32(p + 12)
		if (off + compLen > u8.length) return null
		const raw = u8.slice(off, off + compLen)
		if (compLen === origLen) { tables[tag] = raw; continue }
		const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))
		const inflated = new Uint8Array(await new Response(stream).arrayBuffer())
		if (inflated.length !== origLen) return null
		tables[tag] = inflated
	}
	return writeSfnt(sfntVersion, tables)
}

// ─── glyf ─────────────────────────────────────────────────────────────────────

/** Split glyf into one byte slice per glyph, using loca. */
function glyphSlices(tables: Record<string, Uint8Array>): Uint8Array[] {
	const longLoca = view(tables.head).getInt16(50) === 1
	const numGlyphs = view(tables.maxp).getUint16(4)
	const loca = view(tables.loca)
	const at = (i: number) => longLoca ? loca.getUint32(i * 4) : loca.getUint16(i * 2) * 2
	const out: Uint8Array[] = []
	for (let i = 0; i < numGlyphs; i++) {
		const a = at(i), b = at(i + 1)
		if (b < a || b > tables.glyf.length) throw new Error(`[glyphshaper] glyph ${i} points outside the glyf table`)
		out.push(tables.glyf.subarray(a, b))
	}
	return out
}

/**
 * Decode a simple TrueType glyph into contours of points. Returns null for an empty or composite glyph.
 *
 * @param g - One glyph's bytes from the glyf table
 */
export function decodeSimpleGlyph(g: Uint8Array): GlyphPoint[][] | null {
	if (g.length < 10) return null
	const d = view(g)
	const nc = d.getInt16(0)
	if (nc <= 0) return null
	const ends: number[] = []
	let p = 10
	for (let i = 0; i < nc; i++) { ends.push(d.getUint16(p)); p += 2 }
	const nPts = ends[nc - 1] + 1
	p += 2 + d.getUint16(p)
	const flags: number[] = []
	while (flags.length < nPts) {
		const f = g[p++]
		flags.push(f)
		if (f & 8) { let r = g[p++]; while (r-- > 0 && flags.length < nPts) flags.push(f) }
	}
	const xs: number[] = [], ys: number[] = []
	let v = 0
	for (const f of flags) {
		if (f & 2) { const b = g[p++]; v += (f & 16) ? b : -b } else if (!(f & 16)) { v += d.getInt16(p); p += 2 }
		xs.push(v)
	}
	v = 0
	for (const f of flags) {
		if (f & 4) { const b = g[p++]; v += (f & 32) ? b : -b } else if (!(f & 32)) { v += d.getInt16(p); p += 2 }
		ys.push(v)
	}
	const contours: GlyphPoint[][] = []
	let s = 0
	for (const e of ends) {
		const c: GlyphPoint[] = []
		for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) })
		contours.push(c)
		s = e + 1
	}
	return contours
}

/**
 * Encode contours as a simple TrueType glyph: no instructions, 16-bit coordinates. Coordinates are rounded
 * to whole font units. An outline with no points encodes as an empty glyph (zero bytes).
 *
 * @param contours - Closed contours of on-curve and off-curve points
 */
export function encodeSimpleGlyph(contours: GlyphPoint[][]): Uint8Array {
	const live = contours.filter((c) => c.length > 0)
	const pts = live.flat()
	if (pts.length === 0) return new Uint8Array(0)
	if (pts.length > 65535) throw new RangeError('[glyphshaper] a glyph can have at most 65,535 points')
	const xs = pts.map((q) => Math.round(q.x)), ys = pts.map((q) => Math.round(q.y))
	let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
	for (let i = 0; i < pts.length; i++) {
		if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || Math.abs(xs[i]) > MAX_GLYF_COORD || Math.abs(ys[i]) > MAX_GLYF_COORD) {
			throw new RangeError(`[glyphshaper] point ${i} is outside the range a TrueType glyph can hold (±${MAX_GLYF_COORD})`)
		}
		if (xs[i] < xMin) xMin = xs[i]
		if (xs[i] > xMax) xMax = xs[i]
		if (ys[i] < yMin) yMin = ys[i]
		if (ys[i] > yMax) yMax = ys[i]
	}
	const len = 10 + 2 * live.length + 2 + pts.length + 4 * pts.length
	const out = new Uint8Array((len + 3) & ~3)
	const d = view(out)
	d.setInt16(0, live.length)
	d.setInt16(2, xMin); d.setInt16(4, yMin); d.setInt16(6, xMax); d.setInt16(8, yMax)
	let p = 10, e = -1
	for (const c of live) { e += c.length; d.setUint16(p, e); p += 2 }
	d.setUint16(p, 0); p += 2
	for (const q of pts) out[p++] = q.on ? 1 : 0
	let prev = 0
	for (const x of xs) {
		const delta = x - prev
		if (Math.abs(delta) > MAX_GLYF_COORD) throw new RangeError('[glyphshaper] two neighbouring points are too far apart for a TrueType glyph')
		d.setInt16(p, delta); prev = x; p += 2
	}
	prev = 0
	for (const y of ys) {
		const delta = y - prev
		if (Math.abs(delta) > MAX_GLYF_COORD) throw new RangeError('[glyphshaper] two neighbouring points are too far apart for a TrueType glyph')
		d.setInt16(p, delta); prev = y; p += 2
	}
	return out
}

// ─── Path commands → TrueType points ──────────────────────────────────────────

/** True if two coordinates are the same point (within floating-point noise). */
function same(ax: number, ay: number, bx: number, by: number): boolean {
	return Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6
}

/**
 * Convert path commands to TrueType contours with every on-curve point written out. Zero-length lines and
 * the closing point that repeats the start are left out. A cubic curve (C) becomes four quadratic curves,
 * which is an approximation: TrueType outlines have no cubic curves.
 *
 * @param commands - Path commands in font units (y up)
 */
export function commandsToContours(commands: PathCommand[]): GlyphPoint[][] {
	const contours: GlyphPoint[][] = []
	let cur: GlyphPoint[] | null = null
	let px = 0, py = 0
	const finish = () => {
		if (!cur) return
		// The path returns to its start: that last on-curve point is the first one again.
		if (cur.length > 1) {
			const a = cur[0], b = cur[cur.length - 1]
			if (b.on && same(a.x, a.y, b.x, b.y)) cur.pop()
		}
		if (cur.length > 1 || (cur.length === 1 && !cur[0].on)) contours.push(cur)
		cur = null
	}
	const quad = (x1: number, y1: number, x: number, y: number) => {
		if (!cur) cur = [{ x: px, y: py, on: true }]
		if (same(x1, y1, px, py) && same(x, y, px, py)) return
		cur.push({ x: x1, y: y1, on: false }, { x, y, on: true })
		px = x; py = y
	}
	for (const cmd of commands) {
		if (cmd.type === 'M') {
			finish()
			cur = [{ x: cmd.x, y: cmd.y, on: true }]
			px = cmd.x; py = cmd.y
		} else if (cmd.type === 'L') {
			if (!cur) cur = [{ x: px, y: py, on: true }]
			if (!same(cmd.x, cmd.y, px, py)) { cur.push({ x: cmd.x, y: cmd.y, on: true }); px = cmd.x; py = cmd.y }
		} else if (cmd.type === 'Q') {
			quad(cmd.x1, cmd.y1, cmd.x, cmd.y)
		} else if (cmd.type === 'C') {
			// Split the cubic into four pieces; each piece's quadratic control is (3(c1 + c2) − p0 − p3) / 4.
			let p0x = px, p0y = py, c1x = cmd.x1, c1y = cmd.y1, c2x = cmd.x2, c2y = cmd.y2
			const p3x = cmd.x, p3y = cmd.y
			for (let piece = 4; piece >= 1; piece--) {
				const t = 1 / piece
				const ax = p0x + (c1x - p0x) * t, ay = p0y + (c1y - p0y) * t
				const bx = c1x + (c2x - c1x) * t, by = c1y + (c2y - c1y) * t
				const cx = c2x + (p3x - c2x) * t, cy = c2y + (p3y - c2y) * t
				const abx = ax + (bx - ax) * t, aby = ay + (by - ay) * t
				const bcx = bx + (cx - bx) * t, bcy = by + (cy - by) * t
				const mx = abx + (bcx - abx) * t, my = aby + (bcy - aby) * t
				quad((3 * (ax + abx) - p0x - mx) / 4, (3 * (ay + aby) - p0y - my) / 4, mx, my)
				p0x = mx; p0y = my; c1x = bcx; c1y = bcy; c2x = cx; c2y = cy
			}
		} else if (cmd.type === 'Z') {
			finish()
		}
	}
	finish()
	return contours
}

/** Drop on-curve points that sit at the midpoint of two off-curve neighbours (TrueType implies them). */
function dropImpliedPoints(contour: GlyphPoint[]): GlyphPoint[] {
	const n = contour.length
	if (n < 3) return contour
	return contour.filter((q, i) => {
		if (!q.on) return true
		const a = contour[(i + n - 1) % n], b = contour[(i + 1) % n]
		if (a.on || b.on) return true
		const mx = (Math.round(a.x) + Math.round(b.x)) / 2, my = (Math.round(a.y) + Math.round(b.y)) / 2
		return Math.abs(q.x - mx) > IMPLIED_TOLERANCE || Math.abs(q.y - my) > IMPLIED_TOLERANCE
	})
}

/**
 * Line the edited contours up with the original glyph's points. The edited outline has every on-curve point
 * written out; the original leaves out the ones TrueType implies (midway between two off-curve points). The
 * structures match when, with those implied points put back, both have the same contours, the same number
 * of points and the same on/off pattern, and each implied point is still midway between its neighbours.
 * Returns the contours in the original's point numbering, or null when the structure differs.
 */
function alignContours(explicit: GlyphPoint[][], original: GlyphPoint[][]): GlyphPoint[][] | null {
	if (explicit.length !== original.length) return null
	const out: GlyphPoint[][] = []
	for (let k = 0; k < explicit.length; k++) {
		const c = explicit[k], o = original[k]
		// The original with its implied points put back: `implied` marks the ones that are not stored.
		const full: { x: number; y: number; on: boolean; implied: boolean }[] = []
		o.forEach((q, i) => {
			full.push({ ...q, implied: false })
			const next = o[(i + 1) % o.length]
			if (!q.on && !next.on) full.push({ x: (q.x + next.x) / 2, y: (q.y + next.y) / 2, on: true, implied: true })
		})
		const n = full.length
		if (c.length !== n) return null
		let best = -1, bestDist = Infinity
		for (let r = 0; r < n; r++) {
			let dist = 0, ok = true
			for (let i = 0; i < n; i++) {
				const q = c[(i + r) % n]
				if (q.on !== full[i].on) { ok = false; break }
				dist += (q.x - full[i].x) ** 2 + (q.y - full[i].y) ** 2
				if (dist >= bestDist) { ok = false; break }
			}
			if (ok) { best = r; bestDist = dist }
		}
		if (best < 0) return null
		const kept: GlyphPoint[] = []
		for (let i = 0; i < n; i++) {
			const q = c[(i + best) % n]
			if (!full[i].implied) { kept.push(q); continue }
			const a = c[(i + best + n - 1) % n], b = c[(i + best + 1) % n]
			const mx = (Math.round(a.x) + Math.round(b.x)) / 2, my = (Math.round(a.y) + Math.round(b.y)) / 2
			if (Math.abs(q.x - mx) > IMPLIED_TOLERANCE || Math.abs(q.y - my) > IMPLIED_TOLERANCE) return null
		}
		out.push(kept)
	}
	return out
}

/**
 * Turn edited path commands into the contours to write. When the edit only moved points, the result keeps
 * the original glyph's point numbering (`preserved: true`), which is what a variable font's variation data
 * and any point-matched composites index by.
 *
 * @param commands - The edited outline
 * @param original - The glyph's contours before the edit (null for an empty or composite glyph)
 */
export function contoursForEdit(commands: PathCommand[], original: GlyphPoint[][] | null): { contours: GlyphPoint[][]; preserved: boolean } {
	const explicit = commandsToContours(commands)
	if (original) {
		const aligned = alignContours(explicit, original)
		if (aligned) return { contours: aligned, preserved: true }
	}
	return { contours: explicit.map(dropImpliedPoints), preserved: false }
}

// ─── gvar ─────────────────────────────────────────────────────────────────────

/**
 * Remove the variation data of the given glyphs from a gvar table, leaving every other glyph's data as it
 * was. A glyph without variation data keeps its default shape at every axis setting.
 *
 * @param gvar - The gvar table
 * @param gids - Glyph ids to clear
 */
export function clearGvarGlyphs(gvar: Uint8Array, gids: Iterable<number>): Uint8Array {
	const d = view(gvar)
	if (gvar.length < 20) return gvar
	const axisCount = d.getUint16(4)
	const sharedTupleCount = d.getUint16(6)
	const sharedOff = d.getUint32(8)
	const glyphCount = d.getUint16(12)
	const flags = d.getUint16(14)
	const dataOff = d.getUint32(16)
	const long = (flags & 1) === 1
	const at = (i: number) => long ? d.getUint32(20 + i * 4) : d.getUint16(20 + i * 2) * 2
	const clear = new Set(gids)
	const shared = gvar.subarray(sharedOff, sharedOff + sharedTupleCount * axisCount * 2)
	const slices: Uint8Array[] = []
	let total = 0
	for (let i = 0; i < glyphCount; i++) {
		const s = clear.has(i) ? new Uint8Array(0) : gvar.subarray(dataOff + at(i), dataOff + at(i + 1))
		slices.push(s)
		total += s.length
	}
	const offsetsLen = 4 * (glyphCount + 1)
	const out = new Uint8Array(20 + offsetsLen + shared.length + total)
	const o = view(out)
	out.set(gvar.subarray(0, 20))
	o.setUint16(14, flags | 1)
	o.setUint32(8, 20 + offsetsLen)
	o.setUint32(16, 20 + offsetsLen + shared.length)
	out.set(shared, 20 + offsetsLen)
	let p = 0
	slices.forEach((s, i) => {
		o.setUint32(20 + i * 4, p)
		out.set(s, 20 + offsetsLen + shared.length + p)
		p += s.length
	})
	o.setUint32(20 + glyphCount * 4, p)
	return out
}

// ─── Patch ────────────────────────────────────────────────────────────────────

/**
 * Write edited glyphs into a TrueType font and keep everything else.
 *
 * Rewritten: glyf and loca (only the edited glyphs are re-encoded; every other glyph's bytes are copied),
 * the edited glyphs' hmtx entries, and the head, maxp and hhea fields that depend on them. Copied
 * byte-for-byte: every other table, including GSUB, GPOS and kern (ligatures, kerning), fpgm, prep and cvt
 * (hinting programs), and fvar, gvar, HVAR, avar and STAT (variable-font data).
 *
 * Removed: DSIG (a digital signature no longer matches an edited file) and, when an advance width changed,
 * the hdmx and LTSH device-metric caches. The edited glyphs lose their own TrueType instructions. In a
 * variable font, an edit that adds or removes points removes that glyph's variation data (see `frozen`).
 *
 * With no edits the source bytes are returned unchanged.
 *
 * @param source - The original sfnt file (TrueType outlines)
 * @param edits  - New outlines by glyph id
 */
export function patchGlyphs(source: Uint8Array, edits: Map<number, GlyphEdit>): PatchResult {
	if (edits.size === 0) return { bytes: source, edited: [], frozen: [] }
	const { sfntVersion, tables } = readSfnt(source)
	if (!canPatch({ sfntVersion, tables })) {
		throw new Error('[glyphshaper] only fonts with TrueType (glyf) outlines can be patched; this one has CFF outlines')
	}
	const slices = glyphSlices(tables)
	const numGlyphs = slices.length
	const hhea = tables.hhea.slice()
	const numHM = view(hhea).getUint16(34)
	const maxp = tables.maxp.slice()
	const head = tables.head.slice()
	const hd = view(head), mp = view(maxp), hm = view(tables.hmtx)

	// hmtx as plain arrays, so an advance change on a glyph past numberOfHMetrics can be written.
	const advances: number[] = [], lsbs: number[] = []
	for (let i = 0; i < numGlyphs; i++) {
		if (i < numHM) { advances.push(hm.getUint16(i * 4)); lsbs.push(hm.getInt16(i * 4 + 2)) }
		else { advances.push(advances[numHM - 1] ?? 0); lsbs.push(hm.getInt16(numHM * 4 + (i - numHM) * 2)) }
	}

	const edited: number[] = [], frozen: number[] = []
	let advanceChanged = false, widen = false
	for (const [gid, edit] of edits) {
		if (!Number.isInteger(gid) || gid < 0 || gid >= numGlyphs) throw new RangeError(`[glyphshaper] glyph id ${gid} is not in this font`)
		const { contours, preserved } = contoursForEdit(edit.commands, decodeSimpleGlyph(slices[gid]))
		const bytes = encodeSimpleGlyph(contours)
		slices[gid] = bytes
		edited.push(gid)
		if (!preserved && tables.gvar) frozen.push(gid)
		if (bytes.length > 0) {
			const g = view(bytes)
			lsbs[gid] = g.getInt16(2)
			hd.setInt16(36, Math.min(hd.getInt16(36), g.getInt16(2)))
			hd.setInt16(38, Math.min(hd.getInt16(38), g.getInt16(4)))
			hd.setInt16(40, Math.max(hd.getInt16(40), g.getInt16(6)))
			hd.setInt16(42, Math.max(hd.getInt16(42), g.getInt16(8)))
		}
		if (edit.advanceWidth != null) {
			const adv = Math.min(65535, Math.max(0, Math.round(edit.advanceWidth)))
			if (adv !== advances[gid]) {
				advances[gid] = adv
				advanceChanged = true
				if (gid >= numHM - 1 && numHM < numGlyphs) widen = true
			}
		}
		if (mp.byteLength >= 32) {
			const nPts = contours.reduce((s, c) => s + c.length, 0)
			if (nPts > mp.getUint16(6)) mp.setUint16(6, nPts)
			if (contours.length > mp.getUint16(8)) mp.setUint16(8, contours.length)
		}
	}

	// glyf and a long loca: untouched glyphs are copied as they were.
	let total = 0
	for (const s of slices) total += (s.length + 3) & ~3
	const glyf = new Uint8Array(total)
	const loca = new Uint8Array((numGlyphs + 1) * 4)
	const ld = view(loca)
	let o = 0
	slices.forEach((s, i) => { ld.setUint32(i * 4, o); glyf.set(s, o); o += (s.length + 3) & ~3 })
	ld.setUint32(numGlyphs * 4, o)
	hd.setInt16(50, 1)

	// hmtx: the same layout as before unless a trailing glyph's advance changed.
	const outHM = widen ? numGlyphs : numHM
	const hmtx = new Uint8Array(outHM * 4 + (numGlyphs - outHM) * 2)
	const hw = view(hmtx)
	for (let i = 0; i < numGlyphs; i++) {
		if (i < outHM) { hw.setUint16(i * 4, advances[i]); hw.setInt16(i * 4 + 2, lsbs[i]) }
		else hw.setInt16(outHM * 4 + (i - outHM) * 2, lsbs[i])
	}
	const hh = view(hhea)
	hh.setUint16(34, outHM)
	if (advanceChanged) hh.setUint16(10, Math.max(hh.getUint16(10), ...Array.from(edits.keys(), (g) => advances[g])))

	const out: Record<string, Uint8Array> = { ...tables, glyf, loca, head, hmtx, maxp, hhea }
	delete out.DSIG
	if (advanceChanged) { delete out.hdmx; delete out.LTSH }
	if (frozen.length && out.gvar) out.gvar = clearGvarGlyphs(out.gvar, frozen)
	return { bytes: writeSfnt(sfntVersion, out), edited, frozen }
}

// ─── Compare ──────────────────────────────────────────────────────────────────

/** True if two byte arrays hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

/**
 * Compare two font files table by table: which tables are byte-identical, which changed, which are gone and
 * which are new. Use it to check what a write did to a font. head always differs between two different
 * files (it holds the whole-file checksum), so it is compared with that one field ignored.
 *
 * @param original - The font before the write (TTF or OTF bytes)
 * @param written  - The font after the write
 */
export function compareFontTables(original: ArrayBuffer | Uint8Array, written: ArrayBuffer | Uint8Array): TableComparison {
	const a = readSfnt(original).tables, b = readSfnt(written).tables
	const result: TableComparison = { kept: [], changed: [], dropped: [], added: [] }
	const norm = (tag: string, t: Uint8Array) => {
		if (tag !== 'head' || t.length < 12) return t
		const c = t.slice()
		view(c).setUint32(8, 0)
		return c
	}
	for (const tag of Object.keys(a).sort()) {
		if (!b[tag]) result.dropped.push(tag)
		else if (sameBytes(norm(tag, a[tag]), norm(tag, b[tag]))) result.kept.push(tag)
		else result.changed.push(tag)
	}
	for (const tag of Object.keys(b).sort()) if (!a[tag]) result.added.push(tag)
	return result
}
