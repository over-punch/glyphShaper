// glyphShaper/src/__tests__/forge.test.ts — unit tests for core forge functions

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
	commandsToPathD,
	getGlyphCommands,
	setGlyphCommands,
	fontToBlob,
	applyFontBlob,
	revokeFont,
	parseFont,
} from '../core/forge'
import type { GlyphFont } from '../core/forge'
import type { PathCommand } from '../core/types'

// ─── Mock font ─────────────────────────────────────────────────────────────────

/** Minimal glyph path for a made-up character */
const MOCK_COMMANDS: PathCommand[] = [
	{ type: 'M', x: 10,  y: 0   },
	{ type: 'L', x: 100, y: 0   },
	{ type: 'C', x1: 110, y1: 0, x2: 120, y2: 50, x: 120, y: 100 },
	{ type: 'Q', x1: 120, y1: 150, x: 60, y: 150 },
	{ type: 'Z' },
]

/** Create a minimal GlyphFont mock whose single glyph has MOCK_COMMANDS.
 *  glyphs.get() always returns the SAME glyph object so mutations via
 *  setGlyphCommands are visible to subsequent reads.
 *  charMap allows simulating different glyphs per character for routing tests. */
function makeMockFont(
	commands: PathCommand[] = MOCK_COMMANDS,
	charMap?: Record<string, number>,
): GlyphFont {
	// Single shared glyph instance — mutations are visible across calls
	const glyph = {
		path: { commands: commands.map(c => ({ ...c })) as PathCommand[] },
		leftSideBearing: 0,
		advanceWidth: 500,
	}
	return {
		_font: {
			charToGlyphIndex: (char: string) => charMap ? (charMap[char] ?? 65) : 65,
			glyphs: { get: (_idx: number) => glyph },
		} as unknown as GlyphFont['_font'],
	}
}

/** Minimal mock of a GlyphFont whose toArrayBuffer() returns a small buffer */
function makeMockFontWithBuffer(): GlyphFont {
	const glyph = {
		path: { commands: MOCK_COMMANDS.map(c => ({ ...c })) as PathCommand[] },
		leftSideBearing: 0,
		advanceWidth: 500,
	}
	return {
		_font: {
			charToGlyphIndex: () => 65,
			glyphs: { get: () => glyph },
			toArrayBuffer: () => new ArrayBuffer(4),
		} as unknown as GlyphFont['_font'],
	}
}

// ─── commandsToPathD ──────────────────────────────────────────────────────────

describe('commandsToPathD', () => {
	it('produces correct M command', () => {
		expect(commandsToPathD([{ type: 'M', x: 10, y: 20 }])).toBe('M 10 20')
	})

	it('produces correct L command', () => {
		expect(commandsToPathD([{ type: 'L', x: 50, y: 75 }])).toBe('L 50 75')
	})

	it('produces correct C command', () => {
		expect(commandsToPathD([
			{ type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
		])).toBe('C 1 2 3 4 5 6')
	})

	it('produces correct Q command', () => {
		expect(commandsToPathD([
			{ type: 'Q', x1: 10, y1: 20, x: 30, y: 40 },
		])).toBe('Q 10 20 30 40')
	})

	it('produces correct Z command', () => {
		expect(commandsToPathD([{ type: 'Z' }])).toBe('Z')
	})

	it('joins multiple commands with spaces', () => {
		const cmds: PathCommand[] = [
			{ type: 'M', x: 0, y: 0 },
			{ type: 'L', x: 100, y: 0 },
			{ type: 'Z' },
		]
		expect(commandsToPathD(cmds)).toBe('M 0 0 L 100 0 Z')
	})

	it('returns empty string for empty array', () => {
		expect(commandsToPathD([])).toBe('')
	})

	it('round-trips the full MOCK_COMMANDS sequence', () => {
		const d = commandsToPathD(MOCK_COMMANDS)
		expect(d).toBe('M 10 0 L 100 0 C 110 0 120 50 120 100 Q 120 150 60 150 Z')
	})
})

// ─── getGlyphCommands ─────────────────────────────────────────────────────────

describe('getGlyphCommands', () => {
	it('returns a deep copy of the glyph path commands', () => {
		const font = makeMockFont()
		const cmds = getGlyphCommands(font, 'A')
		expect(cmds).toHaveLength(MOCK_COMMANDS.length)
		expect(cmds[0]).toEqual(MOCK_COMMANDS[0])
	})

	it('returns a copy — mutating the result does not affect subsequent calls', () => {
		const font = makeMockFont()
		const cmds = getGlyphCommands(font, 'A')
		// Mutate the returned copy
		;(cmds[0] as { type: 'M'; x: number; y: number }).x = 999
		// A second call should return the original (unmodified) mock values
		const cmds2 = getGlyphCommands(font, 'A')
		expect((cmds2[0] as { type: 'M'; x: number; y: number }).x).toBe(10)
	})

	it('returns an empty array for a glyph with no path', () => {
		const emptyFont: GlyphFont = {
			_font: {
				charToGlyphIndex: () => 0,
				glyphs: {
					get: () => ({ path: null }),
				},
			} as unknown as GlyphFont['_font'],
		}
		expect(getGlyphCommands(emptyFont, ' ')).toEqual([])
	})
})

// ─── setGlyphCommands ─────────────────────────────────────────────────────────

describe('setGlyphCommands', () => {
	it('replaces the glyph path commands in place', () => {
		const newCmds: PathCommand[] = [
			{ type: 'M', x: 0, y: 0 },
			{ type: 'L', x: 200, y: 200 },
			{ type: 'Z' },
		]
		const font = makeMockFont()
		// Grab a reference to the internal glyph object to inspect after mutation
		const glyph = font._font.glyphs.get(65)
		setGlyphCommands(font, 'A', newCmds)
		expect(glyph!.path!.commands).toEqual(newCmds)
	})

	it('is a no-op when the glyph has no path', () => {
		const font: GlyphFont = {
			_font: {
				charToGlyphIndex: () => 0,
				glyphs: { get: () => ({ path: null }) },
			} as unknown as GlyphFont['_font'],
		}
		// Should not throw
		expect(() => setGlyphCommands(font, ' ', [])).not.toThrow()
	})

	it('round-trips through getGlyphCommands', () => {
		const font = makeMockFont()
		const edited: PathCommand[] = [
			{ type: 'M', x: 5, y: 5 },
			{ type: 'Z' },
		]
		setGlyphCommands(font, 'A', edited)
		const result = getGlyphCommands(font, 'A')
		expect(result).toEqual(edited)
	})

	it('updates advanceWidth and leftSideBearing when path extent changes', () => {
		// MOCK_COMMANDS: xMin=10, xMax=120, advanceWidth=500 → RSB=380
		const font = makeMockFont()
		const glyph = font._font.glyphs.get(65)!
		// Wider path: xMin=20, xMax=200
		setGlyphCommands(font, 'A', [
			{ type: 'M', x: 20, y: 0 },
			{ type: 'L', x: 200, y: 100 },
			{ type: 'Z' },
		])
		// advanceWidth = new xMax (200) + original RSB (500-120=380) = 580
		expect(glyph.advanceWidth).toBe(580)
		expect(glyph.leftSideBearing).toBe(20)
	})

	it('handles narrower path — advanceWidth shrinks', () => {
		// MOCK_COMMANDS: xMin=10, xMax=120, advanceWidth=500 → RSB=380
		const font = makeMockFont()
		const glyph = font._font.glyphs.get(65)!
		// Narrower path: xMin=5, xMax=60
		setGlyphCommands(font, 'A', [
			{ type: 'M', x: 5, y: 0 },
			{ type: 'L', x: 60, y: 100 },
			{ type: 'Z' },
		])
		// advanceWidth = 60 + 380 = 440
		expect(glyph.advanceWidth).toBe(440)
		expect(glyph.leftSideBearing).toBe(5)
	})

	it('handles negative x coordinates (negative LSB)', () => {
		const font = makeMockFont()
		const glyph = font._font.glyphs.get(65)!
		setGlyphCommands(font, 'A', [
			{ type: 'M', x: -20, y: 0 },
			{ type: 'L', x: 80, y: 100 },
			{ type: 'Z' },
		])
		expect(glyph.leftSideBearing).toBe(-20)
	})

	it('is a no-op for all-Z commands (null bounds path)', () => {
		const font = makeMockFont()
		const glyph = font._font.glyphs.get(65)!
		const originalAdvance = glyph.advanceWidth
		setGlyphCommands(font, 'A', [{ type: 'Z' }])
		// bounds are null — advanceWidth should be unchanged
		expect(glyph.advanceWidth).toBe(originalAdvance)
	})

	it('skips metric update when glyph.advanceWidth is undefined', () => {
		const glyph = {
			path: { commands: MOCK_COMMANDS.map(c => ({ ...c })) as PathCommand[] },
			leftSideBearing: 0,
			advanceWidth: undefined as unknown as number,
		}
		const font: GlyphFont = {
			_font: {
				charToGlyphIndex: () => 65,
				glyphs: { get: () => glyph },
			} as unknown as GlyphFont['_font'],
		}
		// Should not throw and should not change advanceWidth
		expect(() => setGlyphCommands(font, 'A', [
			{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'Z' },
		])).not.toThrow()
	})

	it('returns empty array when glyphs.get() returns null', () => {
		const font: GlyphFont = {
			_font: {
				charToGlyphIndex: () => 99,
				glyphs: { get: () => null },
			} as unknown as GlyphFont['_font'],
		}
		expect(getGlyphCommands(font, 'X')).toEqual([])
	})
})

// ─── fontToBlob ───────────────────────────────────────────────────────────────

describe('fontToBlob', () => {
	it('returns a Blob with font/opentype MIME type', () => {
		const font = makeMockFontWithBuffer()
		const blob = fontToBlob(font)
		expect(blob).toBeInstanceOf(Blob)
		expect(blob.type).toBe('font/opentype')
	})

	it('blob size matches the buffer byte length', () => {
		const font = makeMockFontWithBuffer()
		const blob = fontToBlob(font)
		expect(blob.size).toBe(4)
	})
})

// ─── applyFontBlob / revokeFont ───────────────────────────────────────────────

describe('applyFontBlob', () => {
	let createdUrls: string[] = []

	beforeEach(() => {
		// Reset DOM
		document.head.innerHTML = ''
		createdUrls = []

		// Stub URL methods
		let counter = 0
		vi.stubGlobal('URL', {
			createObjectURL: (_blob: Blob) => {
				const url = `blob:mock-${++counter}`
				createdUrls.push(url)
				return url
			},
			revokeObjectURL: vi.fn(),
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('appends a <style> element to document.head', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		applyFontBlob('TestFamily', blob)
		const el = document.querySelector('style[data-glyphshaper-override="TestFamily"]')
		expect(el).not.toBeNull()
		expect(el?.tagName).toBe('STYLE')
	})

	it('style contains the font-family name', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		applyFontBlob('MyFont', blob)
		const el = document.querySelector('style[data-glyphshaper-override="MyFont"]')!
		expect(el.textContent).toContain('"MyFont"')
	})

	it('revokes existingUrl when provided', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		const existingUrl = 'blob:old-url'
		applyFontBlob('MyFont', blob, existingUrl)
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(existingUrl)
	})

	it('replaces previous <style> element on second call', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		applyFontBlob('MyFont', blob)
		applyFontBlob('MyFont', blob)
		const els = document.querySelectorAll('style[data-glyphshaper-override]')
		expect(els.length).toBe(1)
	})

	it("keeps another family's override (one override per family)", () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		applyFontBlob('FamilyA', blob)
		applyFontBlob('FamilyB', blob)
		expect(document.querySelectorAll('style[data-glyphshaper-override]').length).toBe(2)
	})

	it('escapes the family name the CSS way (quotes, backslashes, newlines)', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		applyFontBlob('a"b\\c\nd', blob)
		const el = document.querySelector('style[data-glyphshaper-override]')!
		expect(el.textContent).toContain('font-family: "a\\"b\\\\c\\a d";')
	})

	it('returns the newly created Blob URL', () => {
		const blob = new Blob([''], { type: 'font/opentype' })
		const url = applyFontBlob('MyFont', blob)
		expect(url).toBe('blob:mock-1')
	})
})

describe('revokeFont', () => {
	beforeEach(() => {
		document.head.innerHTML = ''
		vi.stubGlobal('URL', {
			createObjectURL: () => 'blob:mock-1',
			revokeObjectURL: vi.fn(),
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('revokes the Blob URL', () => {
		revokeFont('blob:mock-1')
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
	})

	it("removes the style that uses the URL and leaves other families' overrides", () => {
		let n = 0
		vi.stubGlobal('URL', { createObjectURL: () => `blob:mock-${++n}`, revokeObjectURL: vi.fn() })
		const blob = new Blob([''], { type: 'font/opentype' })
		const a = applyFontBlob('FamilyA', blob)
		applyFontBlob('FamilyB', blob)
		revokeFont(a)
		const left = Array.from(document.querySelectorAll('style[data-glyphshaper-override]'), (e) => e.getAttribute('data-glyphshaper-override'))
		expect(left).toEqual(['FamilyB'])
	})
})

// ─── parseFont WOFF2 branch ───────────────────────────────────────────────────

describe('parseFont', () => {
	it('throws a descriptive error for WOFF2 input without a decompressor', async () => {
		// WOFF2 magic: 0x774F4632
		const buf = new ArrayBuffer(4)
		new DataView(buf).setUint32(0, 0x774f4632, false)
		await expect(parseFont(buf)).rejects.toThrow(/WOFF2 input requires a woff2Decompressor/)
	})

	it('calls the decompressor for WOFF2 input', async () => {
		const woff2Buf = new ArrayBuffer(4)
		new DataView(woff2Buf).setUint32(0, 0x774f4632, false)

		// Decompressor returns a minimal valid buffer — opentype.parse will fail
		// but we only assert the decompressor was called
		const decompressor = vi.fn().mockResolvedValue(new ArrayBuffer(8))
		await expect(parseFont(woff2Buf, decompressor)).rejects.toThrow()
		expect(decompressor).toHaveBeenCalledWith(woff2Buf)
	})
})

// ─── Review fixes (2026-10) ──────────────────────────────────────────────────

describe('review fixes', () => {
	afterEach(() => { vi.unstubAllGlobals() })

	it('rejects coordinates that cannot be written into a font, leaving the glyph unchanged', () => {
		const font = makeMockFont()
		const before = getGlyphCommands(font, 'A')
		for (const bad of [NaN, Infinity, 40000, '12' as unknown as number]) {
			expect(() => setGlyphCommands(font, 'A', [{ type: 'M', x: bad, y: 0 }, { type: 'L', x: 10, y: 10 }])).toThrow()
		}
		expect(getGlyphCommands(font, 'A')).toEqual(before)
	})

	it('rejects paths with more than 10,000 commands', () => {
		const font = makeMockFont()
		const huge: PathCommand[] = Array.from({ length: 10001 }, (_, i) => ({ type: 'L', x: i % 100, y: 0 }))
		expect(() => setGlyphCommands(font, 'A', huge)).toThrow(RangeError)
	})

	it('measures the advance from the outline, not from far-off control points', () => {
		const font = makeMockFont([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'Z' }])
		const glyph = font._font.glyphs.get(65) as unknown as { advanceWidth: number }
		const rsb = glyph.advanceWidth - 100
		// A curve from (100,0) back to (0,0) whose control points sit at x = 5000 bulges out to x ≈ 3775.
		setGlyphCommands(font, 'A', [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'C', x1: 5000, y1: 100, x2: 5000, y2: 200, x: 0, y: 300 }, { type: 'Z' }])
		expect(glyph.advanceWidth).toBeLessThan(5000 + rsb)
		expect(glyph.advanceWidth).toBeGreaterThan(3700 + rsb)
	})

	it('a variable font override covers every weight by default; a static one uses its own weight', () => {
		let n = 0
		vi.stubGlobal('URL', { createObjectURL: () => `blob:v-${++n}`, revokeObjectURL: vi.fn() })
		const make = (tables: object) => ({ _font: { toArrayBuffer: () => new ArrayBuffer(4), tables } } as unknown as GlyphFont)
		applyFontBlob('Var', fontToBlob(make({ fvar: {}, os2: { usWeightClass: 400, fsSelection: 0 } })))
		applyFontBlob('Bold', fontToBlob(make({ os2: { usWeightClass: 700, fsSelection: 1 } })))
		const css = (f: string) => document.querySelector(`style[data-glyphshaper-override="${f}"]`)!.textContent!
		expect(css('Var')).toContain('font-weight: 1 1000;')
		expect(css('Bold')).toContain('font-weight: 700;')
		expect(css('Bold')).toContain('font-style: italic;')
	})

	it('fontToBlob explains when opentype.js cannot write the font', () => {
		const font = { _font: { toArrayBuffer: () => { throw new Error('boom') } } } as unknown as GlyphFont
		expect(() => fontToBlob(font)).toThrow(/could not be written back/)
	})
})
