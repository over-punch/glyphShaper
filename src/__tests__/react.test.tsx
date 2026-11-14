// glyphShaper/src/__tests__/react.test.tsx — @testing-library/react tests for useGlyphFont and GlyphShaperEditor

import React from 'react'
import { render, renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGlyphFont } from '../react/useGlyphFont'
import { GlyphShaperEditor } from '../react/GlyphShaperEditor'
import type { GlyphFont } from '../core/forge'
import type { PathCommand } from '../core/types'

// ─── Minimal mock font ────────────────────────────────────────────────────────

/** Minimal path commands for a mock glyph */
const MOCK_COMMANDS: PathCommand[] = [
	{ type: 'M', x: 10, y: 0 },
	{ type: 'L', x: 100, y: 0 },
	{ type: 'Z' },
]

/**
 * Build a minimal GlyphFont mock that satisfies all internal accesses
 * made by GlyphShaperEditor and useGlyphFont.
 */
function makeMockFont(): GlyphFont {
	const glyph = {
		path: { commands: MOCK_COMMANDS.map(c => ({ ...c })) as PathCommand[] },
		leftSideBearing: 0,
		advanceWidth: 500,
	}
	return {
		_font: {
			charToGlyphIndex: () => 65,
			glyphs: { get: () => glyph },
			unitsPerEm: 1000,
			ascender: 800,
			descender: -200,
			toArrayBuffer: () => new ArrayBuffer(4),
		} as unknown as GlyphFont['_font'],
	}
}

// ─── fetch mock ───────────────────────────────────────────────────────────────

/**
 * Stub global fetch to return a minimal ArrayBuffer that opentype.js would
 * receive. We also mock parseFont so no real font parsing occurs in the hook.
 */
function stubFetch(ok = true) {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
		ok,
		status: ok ? 200 : 404,
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
	}))
}

// ─── parseFont mock ───────────────────────────────────────────────────────────

/** Mock the forge module so parseFont returns our fake GlyphFont without opentype.js.
 *  All values are inlined here — vi.mock factories are hoisted before any const declarations. */
vi.mock('../core/forge', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../core/forge')>()
	// Inline a minimal GlyphFont — cannot reference MOCK_COMMANDS or makeMockFont here
	const inlineGlyph = {
		path: {
			commands: [
				{ type: 'M', x: 10, y: 0 },
				{ type: 'L', x: 100, y: 0 },
				{ type: 'Z' },
			],
		},
		leftSideBearing: 0,
		advanceWidth: 500,
	}
	const inlineMockFont = {
		_font: {
			charToGlyphIndex: () => 65,
			glyphs: { get: () => inlineGlyph },
			unitsPerEm: 1000,
			ascender: 800,
			descender: -200,
			toArrayBuffer: () => new ArrayBuffer(4),
		},
	}
	return {
		...actual,
		parseFont: vi.fn().mockResolvedValue(inlineMockFont),
	}
})

// ─── URL mock (for applyFontBlob inside GlyphShaperEditor) ──────────────────

beforeEach(() => {
	vi.stubGlobal('URL', {
		createObjectURL: vi.fn(() => 'blob:mock-url'),
		revokeObjectURL: vi.fn(),
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	document.head.innerHTML = ''
})

// ─── useGlyphFont tests ───────────────────────────────────────────────────────

describe('useGlyphFont', () => {
	it('mounts without throwing when source is null', () => {
		expect(() => renderHook(() => useGlyphFont(null))).not.toThrow()
	})

	it('returns idle state when source is null', () => {
		const { result } = renderHook(() => useGlyphFont(null))
		expect(result.current.font).toBeNull()
		expect(result.current.loading).toBe(false)
		expect(result.current.error).toBeNull()
	})

	it('starts loading when a URL is provided', async () => {
		stubFetch()
		const { result } = renderHook(() => useGlyphFont('/fonts/test.ttf'))
		// loading should be true synchronously after first render
		expect(result.current.loading).toBe(true)
	})

	it('resolves to a font after successful fetch', async () => {
		stubFetch()
		const { result } = renderHook(() => useGlyphFont('/fonts/test.ttf'))
		// Wait for the async load to settle
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(result.current.loading).toBe(false)
		expect(result.current.font).not.toBeNull()
		expect(result.current.error).toBeNull()
	})

	it('sets error on failed fetch (non-OK response)', async () => {
		stubFetch(false)
		const { result } = renderHook(() => useGlyphFont('/fonts/missing.ttf'))
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(result.current.loading).toBe(false)
		expect(result.current.font).toBeNull()
		expect(result.current.error).toMatch(/HTTP 404/)
	})

	it('unmounts without throwing', () => {
		stubFetch()
		const { unmount } = renderHook(() => useGlyphFont(null))
		expect(() => unmount()).not.toThrow()
	})

	it('re-runs and loads again when URL changes', async () => {
		stubFetch()
		const initialProps: { url: string | null } = { url: null }
		const { result, rerender } = renderHook(
			({ url }: { url: string | null }) => useGlyphFont(url),
			{ initialProps },
		)
		expect(result.current.font).toBeNull()
		rerender({ url: '/fonts/test.ttf' })
		expect(result.current.loading).toBe(true)
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(result.current.font).not.toBeNull()
	})

	it('resets to idle when source changes to null', async () => {
		stubFetch()
		const { result, rerender } = renderHook(
			({ url }: { url: string | null }) => useGlyphFont(url),
			{ initialProps: { url: '/fonts/test.ttf' as string | null } },
		)
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 0))
		})
		expect(result.current.font).not.toBeNull()
		rerender({ url: null })
		expect(result.current.font).toBeNull()
		expect(result.current.loading).toBe(false)
		expect(result.current.error).toBeNull()
	})
})

// ─── GlyphShaperEditor tests ──────────────────────────────────────────────────

describe('GlyphShaperEditor', () => {
	it('renders without throwing when font is null', () => {
		expect(() =>
			render(<GlyphShaperEditor font={null} fontFamily="TestFamily" />)
		).not.toThrow()
	})

	it('renders without throwing when font is provided', () => {
		const font = makeMockFont()
		expect(() =>
			render(<GlyphShaperEditor font={font} fontFamily="TestFamily" text="Ag" />)
		).not.toThrow()
	})

	it('unmounts without throwing', () => {
		const font = makeMockFont()
		const { unmount } = render(
			<GlyphShaperEditor font={font} fontFamily="TestFamily" />
		)
		expect(() => unmount()).not.toThrow()
	})

	it('renders children when provided', () => {
		const font = makeMockFont()
		const { container } = render(
			<GlyphShaperEditor font={font} fontFamily="TestFamily">
				<p data-testid="child">Hello</p>
			</GlyphShaperEditor>
		)
		expect(container.textContent).toContain('Hello')
	})

	it('renders text prop as fallback when no children', () => {
		const font = makeMockFont()
		const { container } = render(
			<GlyphShaperEditor font={font} fontFamily="TestFamily" text="Agogô" />
		)
		expect(container.textContent).toContain('Agogô')
	})

	it('shows "No font loaded" message when font is null', () => {
		const { container } = render(
			<GlyphShaperEditor font={null} fontFamily="TestFamily" />
		)
		expect(container.textContent).toContain('No font loaded')
	})

	it('renders character palette buttons when font is provided', () => {
		const font = makeMockFont()
		const { container } = render(
			<GlyphShaperEditor font={font} fontFamily="TestFamily" text="Ag" />
		)
		// Palette should contain buttons for 'A' and 'g'
		const buttons = container.querySelectorAll('button')
		expect(buttons.length).toBeGreaterThanOrEqual(2)
	})

	it('hides palette when hidePalette is true', () => {
		const font = makeMockFont()
		const { container } = render(
			<GlyphShaperEditor font={font} fontFamily="TestFamily" text="Ag" hidePalette />
		)
		// No palette group should be present
		const group = container.querySelector('[role="group"]')
		expect(group).toBeNull()
	})

	it('calls onClose after Cancel is clicked when in controlled mode', async () => {
		const onClose = vi.fn()
		const font = makeMockFont()
		const { container, rerender } = render(
			<GlyphShaperEditor
				font={font}
				fontFamily="TestFamily"
				text="A"
				selectedChar="A"
				onClose={onClose}
			/>
		)
		// Editor panel should be open with a Cancel button
		const cancelBtn = Array.from(container.querySelectorAll('button')).find(
			b => b.textContent === 'Cancel',
		)
		expect(cancelBtn).toBeDefined()
		await act(async () => {
			cancelBtn!.click()
		})
		expect(onClose).toHaveBeenCalled()
		void rerender // suppress unused warning
	})
})
