// glyphShaper/src/react/useGlyphFont.ts — React hook for loading and parsing a font

'use client'

import { useState, useEffect } from 'react'
import { parseFont } from '../core/forge'
import type { GlyphFont } from '../core/forge'

/** State returned by useGlyphFont */
export interface GlyphFontState {
	/** Parsed font handle, or null while loading / on error */
	font: GlyphFont | null
	/** True while the font is being fetched or parsed */
	loading: boolean
	/** Human-readable error message, or null if no error */
	error: string | null
}

/**
 * Load and parse a font from a URL or a File object.
 *
 * - Pass a URL string to fetch over HTTP (TTF, OTF, or WOFF1 — not WOFF2,
 *   because this hook does not accept a woff2Decompressor parameter;
 *   use parseFont() directly if you need WOFF2 support).
 * - Pass a File object for user-uploaded fonts (any TTF, OTF, or WOFF1).
 * - Pass null to reset to idle state.
 *
 * The returned font object is stable across re-renders as long as source
 * identity does not change (URL string equality, or File object identity).
 *
 * @param source - Font URL, File, or null
 */
export function useGlyphFont(source: string | File | null): GlyphFontState {
	const [state, setState] = useState<GlyphFontState>({
		font: null,
		loading: false,
		error: null,
	})

	useEffect(() => {
		if (!source) {
			setState({ font: null, loading: false, error: null })
			return
		}

		let cancelled = false
		setState(s => ({ ...s, loading: true, error: null }))

		async function load() {
			try {
				let buffer: ArrayBuffer
				if (typeof source === 'string') {
					const res = await fetch(source)
					if (!res.ok) throw new Error(`HTTP ${res.status} fetching font`)
					buffer = await res.arrayBuffer()
				} else {
					buffer = await (source as File).arrayBuffer()
				}
				if (cancelled) return
				const font = await parseFont(buffer)
				if (cancelled) return
				setState({ font, loading: false, error: null })
			} catch (err) {
				if (cancelled) return
				setState({
					font: null,
					loading: false,
					error: err instanceof Error ? err.message : 'Failed to load font',
				})
			}
		}

		load()
		return () => { cancelled = true }
	// URLs compare by value, Files by identity (two different files can share a name and size).
	}, [source])

	return state
}
