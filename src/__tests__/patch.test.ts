// glyphShaper/src/__tests__/patch.test.ts — the patch write path on real fonts: only the edited glyph changes, every other table is kept

// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { parse } from 'opentype.js'
import { parseFont, getGlyphCommands, setGlyphCommands, fontToBlob, getWriteInfo, getFontSource } from '../core/forge'
import {
	readSfnt, writeSfnt, canPatch, patchGlyphs, compareFontTables, commandsToContours, contoursForEdit,
	decodeSimpleGlyph, encodeSimpleGlyph, clearGvarGlyphs, woffToSfnt,
} from '../core/patch'
import type { PathCommand } from '../core/types'
import { movePoint } from '../react/GlyphShaperEditor'

/** Read a font from the site's public folder (both are OFL; licences sit beside them). */
function load(name: string): ArrayBuffer {
	const b = readFileSync(fileURLToPath(new URL(`../../site/public/fonts/${name}`, import.meta.url)))
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** PT Serif Regular: static TrueType with kerning (GPOS and kern), ligatures (GSUB) and hinting. */
const PT_SERIF = load('PTSerif-Regular.ttf')

/** Roboto Flex: a variable TrueType font with thirteen axes. */
const ROBOTO_FLEX = load('RobotoFlex-VF.ttf')

/** Move every point of an outline up by dy font units: an edit that keeps the point structure. */
function raise(cmds: PathCommand[], dy: number): PathCommand[] {
	return cmds.map((c) => {
		const o = { ...c } as Record<string, unknown>
		for (const k of ['y', 'y1', 'y2']) if (typeof o[k] === 'number') o[k] = (o[k] as number) + dy
		return o as unknown as PathCommand
	})
}

/** The bytes of a blob. */
async function bytes(blob: Blob): Promise<ArrayBuffer> {
	return blob.arrayBuffer()
}

describe('sfnt container', () => {
	it('round-trips a font file with every table byte-identical', () => {
		const { sfntVersion, tables } = readSfnt(PT_SERIF)
		const out = writeSfnt(sfntVersion, tables)
		const cmp = compareFontTables(PT_SERIF, out)
		expect(cmp.changed).toEqual([])
		expect(cmp.dropped).toEqual([])
		expect(cmp.added).toEqual([])
		expect(cmp.kept.length).toBe(Object.keys(tables).length)
	})

	it('writes checksums a parser accepts', () => {
		const { sfntVersion, tables } = readSfnt(PT_SERIF)
		expect(() => parse(writeSfnt(sfntVersion, tables).buffer as ArrayBuffer)).not.toThrow()
	})

	it('rejects input that is not an sfnt file', () => {
		expect(() => readSfnt(new Uint8Array(4))).toThrow(/too short/)
		expect(() => readSfnt(new Uint8Array(64))).toThrow(/not an sfnt/)
		const cut = new Uint8Array(PT_SERIF.slice(0, 200))
		expect(() => readSfnt(cut)).toThrow()
	})

	it('says a CFF-flavoured file cannot be patched', () => {
		const { sfntVersion, tables } = readSfnt(PT_SERIF)
		const noGlyf = { ...tables }
		delete noGlyf.glyf
		expect(canPatch({ sfntVersion, tables })).toBe(true)
		expect(canPatch({ sfntVersion, tables: noGlyf })).toBe(false)
		expect(() => patchGlyphs(writeSfnt(sfntVersion, noGlyf), new Map([[5, { commands: [] }]]))).toThrow(/TrueType/)
	})
})

describe('glyph encoding', () => {
	it('decodes and re-encodes a simple glyph to the same points', () => {
		const contours = [[{ x: 0, y: 0, on: true }, { x: 50, y: 120, on: false }, { x: 100, y: 0, on: true }], [{ x: 10, y: 10, on: true }, { x: 20, y: 10, on: true }, { x: 15, y: 30, on: true }]]
		expect(decodeSimpleGlyph(encodeSimpleGlyph(contours))).toEqual(contours)
	})

	it('encodes an empty outline as an empty glyph', () => {
		expect(encodeSimpleGlyph([]).length).toBe(0)
		expect(decodeSimpleGlyph(new Uint8Array(0))).toBeNull()
	})

	it('refuses coordinates a TrueType glyph cannot hold', () => {
		expect(() => encodeSimpleGlyph([[{ x: 40000, y: 0, on: true }, { x: 0, y: 0, on: true }]])).toThrow(RangeError)
		expect(() => encodeSimpleGlyph([[{ x: NaN, y: 0, on: true }, { x: 0, y: 0, on: true }]])).toThrow(RangeError)
	})

	it('turns path commands into contours without the repeated closing point or zero-length lines', () => {
		const c = commandsToContours([
			{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'L', x: 100, y: 0 },
			{ type: 'Q', x1: 100, y1: 100, x: 0, y: 100 }, { type: 'L', x: 0, y: 0 }, { type: 'Z' },
		])
		expect(c).toEqual([[{ x: 0, y: 0, on: true }, { x: 100, y: 0, on: true }, { x: 100, y: 100, on: false }, { x: 0, y: 100, on: true }]])
	})

	it('approximates a cubic curve with four quadratic curves that end where the cubic ends', () => {
		const c = commandsToContours([{ type: 'M', x: 0, y: 0 }, { type: 'C', x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 }, { type: 'Z' }])
		expect(c[0].length).toBe(9)
		expect(c[0][8]).toEqual({ x: 100, y: 0, on: true })
		// The middle of the cubic is (50, 75); the fourth point is the end of the second quadratic.
		expect(c[0][4].x).toBeCloseTo(50, 6)
		expect(c[0][4].y).toBeCloseTo(75, 6)
	})

	it('keeps the original point numbering when an edit only moves points', async () => {
		const font = await parseFont(PT_SERIF)
		const { tables } = readSfnt(PT_SERIF)
		const gid = font._font.charToGlyphIndex('o')
		const head = new DataView(tables.head.buffer), loca = new DataView(tables.loca.buffer)
		const long = head.getInt16(50) === 1
		const at = (i: number) => long ? loca.getUint32(i * 4) : loca.getUint16(i * 2) * 2
		const original = decodeSimpleGlyph(tables.glyf.subarray(at(gid), at(gid + 1)))!
		const moved = contoursForEdit(raise(getGlyphCommands(font, 'o'), 40), original)
		expect(moved.preserved).toBe(true)
		expect(moved.contours.map((c) => c.length)).toEqual(original.map((c) => c.length))
		moved.contours.forEach((c, k) => c.forEach((q, i) => {
			expect(q.on).toBe(original[k][i].on)
			expect(Math.round(q.x)).toBe(original[k][i].x)
			expect(Math.round(q.y)).toBe(original[k][i].y + 40)
		}))
	})

	it('reports a changed structure when an edit adds a point', async () => {
		const font = await parseFont(PT_SERIF)
		const cmds = getGlyphCommands(font, 'H')
		const withExtra = [...cmds.slice(0, 2), { type: 'L', x: 5, y: 5 } as PathCommand, ...cmds.slice(2)]
		expect(contoursForEdit(withExtra, commandsToContours(cmds)).preserved).toBe(false)
	})
})

describe('patch write path: PT Serif (static, hinted, kerned)', () => {
	it('parseFont keeps the source bytes and fontToBlob returns them untouched when nothing was edited', async () => {
		const font = await parseFont(PT_SERIF)
		expect(getFontSource(font)!.byteLength).toBe(PT_SERIF.byteLength)
		const blob = fontToBlob(font)
		expect(blob.type).toBe('font/ttf')
		expect(getWriteInfo(blob)).toEqual({ method: 'patch', editedGlyphs: [], dependentGlyphs: [], frozenGlyphs: [] })
		expect(new Uint8Array(await bytes(blob))).toEqual(new Uint8Array(PT_SERIF))
	})

	it('an edit to one glyph changes only the outline tables and the header, and drops only the signature', async () => {
		const font = await parseFont(PT_SERIF)
		setGlyphCommands(font, 'A', raise(getGlyphCommands(font, 'A'), 60))
		const blob = fontToBlob(font)
		const cmp = compareFontTables(PT_SERIF, await bytes(blob))
		expect(cmp.dropped).toEqual(['DSIG'])
		expect(cmp.added).toEqual([])
		for (const t of cmp.changed) expect(['glyf', 'head', 'loca', 'maxp', 'hmtx', 'hhea'], t).toContain(t)
		expect(cmp.kept.length + cmp.changed.length + cmp.dropped.length).toBe(Object.keys(readSfnt(PT_SERIF).tables).length)
		for (const t of ['GPOS', 'GSUB', 'kern', 'cvt ', 'fpgm', 'prep', 'gasp', 'cmap', 'name', 'OS/2', 'post', 'hdmx', 'LTSH']) {
			expect(cmp.kept, t).toContain(t)
		}
		expect(cmp.changed).toContain('glyf')
		expect(getWriteInfo(blob)!.editedGlyphs).toEqual([font._font.charToGlyphIndex('A')])
	})

	it('the edited glyph has the new outline and every other glyph has its original bytes', async () => {
		const font = await parseFont(PT_SERIF)
		const before = getGlyphCommands(font, 'A')
		setGlyphCommands(font, 'A', raise(before, 60))
		const out = await bytes(fontToBlob(font))
		const reparsed = parse(out)
		const a = reparsed.charToGlyph('A').path.commands as PathCommand[]
		expect(a.length).toBe(before.length)
		expect((a[0] as { y: number }).y).toBe((before[0] as { y: number }).y + 60)

		const src = readSfnt(PT_SERIF).tables, dst = readSfnt(out).tables
		const slice = (t: Record<string, Uint8Array>, gid: number) => {
			const long = new DataView(t.head.buffer).getInt16(50) === 1
			const l = new DataView(t.loca.buffer)
			const at = (i: number) => long ? l.getUint32(i * 4) : l.getUint16(i * 2) * 2
			return t.glyf.subarray(at(gid), at(gid + 1))
		}
		const gidA = font._font.charToGlyphIndex('A')
		const n = new DataView(src.maxp.buffer).getUint16(4)
		let identical = 0
		for (let g = 0; g < n; g++) {
			if (g === gidA) continue
			expect(Array.from(slice(dst, g)), `glyph ${g}`).toEqual(Array.from(slice(src, g)))
			identical++
		}
		expect(identical).toBe(n - 1)
	})

	it('accented letters built from an edited letter are reported, and follow its new width', async () => {
		const font = await parseFont(PT_SERIF)
		const gid = font._font.charToGlyphIndex('o')
		const before = font._font.glyphs.get(gid).advanceWidth!
		setGlyphCommands(font, 'o', getGlyphCommands(font, 'o').map((c) => {
			const o = { ...c } as Record<string, unknown>
			for (const k of ['x', 'x1', 'x2']) if (typeof o[k] === 'number') o[k] = (o[k] as number) * 1.4
			return o as unknown as PathCommand
		}))
		const blob = fontToBlob(font)
		const info = getWriteInfo(blob)!
		const reparsed = parse(await bytes(blob))
		const after = reparsed.glyphs.get(gid).advanceWidth!
		expect(after).toBeGreaterThan(before)
		const oDieresis = font._font.charToGlyphIndex('ö'), oAcute = font._font.charToGlyphIndex('ó')
		expect(info.editedGlyphs).toEqual([gid])
		expect(info.dependentGlyphs).toContain(oDieresis)
		expect(info.dependentGlyphs).toContain(oAcute)
		expect(reparsed.glyphs.get(oDieresis).advanceWidth).toBe(after)
		expect(reparsed.glyphs.get(oAcute).advanceWidth).toBe(after)
		// A letter that isn't built from o keeps its width, and isn't listed.
		const n = font._font.charToGlyphIndex('n')
		expect(info.dependentGlyphs).not.toContain(n)
		expect(reparsed.glyphs.get(n).advanceWidth).toBe(font._font.glyphs.get(n).advanceWidth)
	})

	it('compareFontTables is strict: head counts as changed once anything else did', async () => {
		const font = await parseFont(PT_SERIF)
		setGlyphCommands(font, 'A', raise(getGlyphCommands(font, 'A'), 60))
		const cmp = compareFontTables(PT_SERIF, await bytes(fontToBlob(font)))
		expect(cmp.changed.sort()).toEqual(['glyf', 'head', 'loca'])
		expect(cmp.kept.length).toBe(16)
		expect(cmp.dropped).toEqual(['DSIG'])
	})

	it('putting the original outline back is not an edit', async () => {
		const font = await parseFont(PT_SERIF)
		const before = getGlyphCommands(font, 'A')
		setGlyphCommands(font, 'A', raise(before, 60))
		setGlyphCommands(font, 'A', before)
		const blob = fontToBlob(font)
		expect(getWriteInfo(blob)!.editedGlyphs).toEqual([])
		expect(new Uint8Array(await bytes(blob))).toEqual(new Uint8Array(PT_SERIF))
	})

	it('a wider glyph gets a wider advance, and the device-metric caches are dropped with it', async () => {
		const font = await parseFont(PT_SERIF)
		const gid = font._font.charToGlyphIndex('o')
		const before = font._font.glyphs.get(gid).advanceWidth!
		setGlyphCommands(font, 'o', getGlyphCommands(font, 'o').map((c) => {
			const o = { ...c } as Record<string, unknown>
			for (const k of ['x', 'x1', 'x2']) if (typeof o[k] === 'number') o[k] = (o[k] as number) * 1.5
			return o as unknown as PathCommand
		}))
		const out = await bytes(fontToBlob(font))
		expect(parse(out).glyphs.get(gid).advanceWidth).toBeGreaterThan(before)
		const cmp = compareFontTables(PT_SERIF, out)
		expect(cmp.dropped.sort()).toEqual(['DSIG', 'LTSH', 'hdmx'])
		expect(cmp.kept).toContain('GPOS')
		expect(cmp.changed).toContain('hmtx')
	})

	it('write: rebuild still gives the opentype.js file, without the kerning and hinting tables', async () => {
		const font = await parseFont(PT_SERIF)
		const blob = fontToBlob(font, { write: 'rebuild' })
		expect(blob.type).toBe('font/opentype')
		expect(getWriteInfo(blob)!.method).toBe('rebuild')
		const cmp = compareFontTables(PT_SERIF, await bytes(blob))
		for (const t of ['GPOS', 'GSUB', 'kern', 'fpgm', 'prep', 'glyf']) expect(cmp.dropped, t).toContain(t)
		expect(cmp.added).toContain('CFF ')
	})

	it('rejects an unknown write mode and write: patch on a font without source bytes', async () => {
		const font = await parseFont(PT_SERIF)
		expect(() => fontToBlob(font, { write: 'fast' as never })).toThrow(TypeError)
		expect(() => fontToBlob({ _font: font._font }, { write: 'patch' })).toThrow(/can't be patched/)
	})

	it('a composite glyph that is edited becomes a simple glyph; the others are left alone', async () => {
		const font = await parseFont(PT_SERIF)
		const cmds = getGlyphCommands(font, 'é')
		expect(cmds.length).toBeGreaterThan(0)
		setGlyphCommands(font, 'é', raise(cmds, 10))
		const out = await bytes(fontToBlob(font))
		const got = parse(out).charToGlyph('é').path.commands as PathCommand[]
		expect(got.filter((c) => c.type === 'Z').length).toBe(cmds.filter((c) => c.type === 'Z').length)
		expect(compareFontTables(PT_SERIF, out).kept).toContain('GPOS')
	})

	it('unpacks WOFF 1.0 input so it can be patched too', async () => {
		const { sfntVersion, tables } = readSfnt(PT_SERIF)
		const tags = Object.keys(tables).sort()
		const packed = tags.map((t) => { const z = deflateSync(tables[t]); return z.length < tables[t].length ? z : Buffer.from(tables[t]) })
		let off = 44 + 20 * tags.length
		const woff = new Uint8Array(off + packed.reduce((s, z) => s + ((z.length + 3) & ~3), 0))
		const d = new DataView(woff.buffer)
		d.setUint32(0, 0x774f4646); d.setUint32(4, sfntVersion); d.setUint32(8, woff.length); d.setUint16(12, tags.length)
		tags.forEach((t, i) => {
			const p = 44 + 20 * i
			for (let k = 0; k < 4; k++) woff[p + k] = t.charCodeAt(k)
			d.setUint32(p + 4, off); d.setUint32(p + 8, packed[i].length); d.setUint32(p + 12, tables[t].length)
			woff.set(packed[i], off)
			off += (packed[i].length + 3) & ~3
		})
		const sfnt = await woffToSfnt(woff.buffer)
		expect(sfnt).not.toBeNull()
		expect(compareFontTables(PT_SERIF, sfnt!).changed).toEqual([])
		expect(await woffToSfnt(PT_SERIF)).toBeNull()
		const font = await parseFont(woff.buffer)
		expect(getFontSource(font)).not.toBeNull()
		expect(getWriteInfo(fontToBlob(font))!.method).toBe('patch')
	})
})

describe('patch write path: Roboto Flex (variable)', () => {
	it('an edit that only moves points keeps every variation table byte-identical', async () => {
		const font = await parseFont(ROBOTO_FLEX)
		setGlyphCommands(font, 'A', raise(getGlyphCommands(font, 'A'), 80))
		const blob = fontToBlob(font)
		const info = getWriteInfo(blob)!
		expect(info.method).toBe('patch')
		expect(info.frozenGlyphs).toEqual([])
		const cmp = compareFontTables(ROBOTO_FLEX, await bytes(blob))
		for (const t of ['fvar', 'gvar', 'HVAR', 'MVAR', 'avar', 'STAT', 'GPOS', 'GSUB', 'GDEF']) expect(cmp.kept, t).toContain(t)
		expect(cmp.dropped).toEqual([])
	})

	it('an edit that adds a point removes only that glyph\'s variation data', async () => {
		const font = await parseFont(ROBOTO_FLEX)
		const cmds = getGlyphCommands(font, 'H')
		const first = cmds[1] as { x: number; y: number }
		const extra: PathCommand = { type: 'L', x: first.x + 7, y: first.y + 13 }
		setGlyphCommands(font, 'H', [cmds[0], extra, ...cmds.slice(1)])
		const blob = fontToBlob(font)
		const gid = font._font.charToGlyphIndex('H')
		expect(getWriteInfo(blob)!.frozenGlyphs).toEqual([gid])
		const out = await bytes(blob)
		const cmp = compareFontTables(ROBOTO_FLEX, out)
		expect(cmp.changed).toContain('gvar')
		for (const t of ['fvar', 'HVAR', 'avar', 'STAT', 'GPOS', 'GSUB']) expect(cmp.kept, t).toContain(t)

		// Every other glyph's variation data is the same bytes as before.
		const data = (gvar: Uint8Array, g: number) => {
			const d = new DataView(gvar.buffer, gvar.byteOffset, gvar.byteLength)
			const long = (d.getUint16(14) & 1) === 1, base = d.getUint32(16)
			const at = (i: number) => long ? d.getUint32(20 + i * 4) : d.getUint16(20 + i * 2) * 2
			return gvar.subarray(base + at(g), base + at(g + 1))
		}
		const a = readSfnt(ROBOTO_FLEX).tables.gvar, b = readSfnt(out).tables.gvar
		const count = new DataView(a.buffer).getUint16(12)
		expect(data(b, gid).length).toBe(0)
		for (const g of [0, 1, gid - 1, gid + 1, count - 1]) expect(Array.from(data(b, g))).toEqual(Array.from(data(a, g)))
	})

	it('clearGvarGlyphs with no glyphs keeps every glyph\'s data', () => {
		const gvar = readSfnt(ROBOTO_FLEX).tables.gvar
		const out = clearGvarGlyphs(gvar, [])
		const total = (t: Uint8Array) => {
			const d = new DataView(t.buffer, t.byteOffset, t.byteLength)
			const n = d.getUint16(12), long = (d.getUint16(14) & 1) === 1
			return long ? d.getUint32(20 + n * 4) : d.getUint16(20 + n * 2) * 2
		}
		expect(total(out)).toBe(total(gvar))
	})

	it('rebuilding a variable font warns once that the result is static', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const font = await parseFont(ROBOTO_FLEX)
		expect(warn).not.toHaveBeenCalled()
		fontToBlob(font)
		expect(warn).not.toHaveBeenCalled()
		try { fontToBlob(font, { write: 'rebuild' }) } catch { /* opentype.js may refuse this font; the warning comes first */ }
		try { fontToBlob(font, { write: 'rebuild' }) } catch { /* same */ }
		expect(warn).toHaveBeenCalledTimes(1)
		warn.mockRestore()
	})
})

describe('editor: moving a point of a TrueType outline', () => {
	it('moves welded anchors together, so a variable glyph keeps its point structure and still varies', async () => {
		const font = await parseFont(ROBOTO_FLEX)
		const cmds = getGlyphCommands(font, 'V')
		// The first curve or line end that another anchor of the same contour repeats.
		const idx = cmds.findIndex((c, i) => c.type !== 'Z' && c.type !== 'M' && cmds.some((d, j) => j !== i && d.type !== 'Z' && d.x === c.x && d.y === c.y))
		expect(idx).toBeGreaterThan(0)
		const at = cmds[idx] as { x: number; y: number }
		const moved = movePoint(cmds, idx, 'xy', at.x + 40, at.y + 25)
		expect(moved.filter((c) => c.type !== 'Z' && c.x === at.x + 40 && c.y === at.y + 25).length).toBeGreaterThan(1)
		setGlyphCommands(font, 'V', moved)
		const info = getWriteInfo(fontToBlob(font))!
		expect(info.editedGlyphs.length).toBe(1)
		expect(info.frozenGlyphs).toEqual([])
	})

	it('leaves anchors of other contours alone, and moves a handle on its own', () => {
		const cmds: PathCommand[] = [
			{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'Q', x1: 10, y1: 10, x: 0, y: 0 }, { type: 'Z' },
			{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 5, y: 5 }, { type: 'Z' },
		]
		const moved = movePoint(cmds, 0, 'xy', 3, 4)
		expect(moved[0]).toEqual({ type: 'M', x: 3, y: 4 })
		expect(moved[2]).toEqual({ type: 'Q', x1: 10, y1: 10, x: 3, y: 4 })
		expect(moved[4]).toEqual({ type: 'M', x: 0, y: 0 })
		expect(movePoint(cmds, 2, 'x1y1', 7, 7)[2]).toEqual({ type: 'Q', x1: 7, y1: 7, x: 0, y: 0 })
	})
})
