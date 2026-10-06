// Server-side WOFF2 decompression for the demo — keeps wawoff2 (Node.js-only) out of the browser bundle.
// Accepts only same-origin WOFF2 uploads up to 10 MB that declare at most 20 MB of decompressed font data.
import { NextRequest, NextResponse } from 'next/server'

/** Largest accepted upload, in bytes (the demo's own limit). */
const MAX_BODY_BYTES = 10 * 1024 * 1024

/** Largest decompressed font accepted, in bytes (WOFF2 header totalSfntSize). */
const MAX_SFNT_BYTES = 20 * 1024 * 1024

/** Largest accepted ratio of decompressed to compressed size. */
const MAX_EXPANSION = 64

/** WOFF2 signature "wOF2". */
const WOFF2_MAGIC = 0x774f4632

/** A plain-text error response. */
function fail(status: number, message: string) {
	return new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * Read the request body, stopping as soon as it exceeds `limit` bytes (so a large upload never sits in
 * memory whole). Returns null when it is too large.
 */
async function readLimited(req: NextRequest, limit: number): Promise<Uint8Array | null> {
	const declared = Number(req.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > limit) return null
	if (!req.body) return new Uint8Array(0)
	const reader = req.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > limit) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	const out = new Uint8Array(total)
	let offset = 0
	for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
	return out
}

export async function POST(req: NextRequest) {
	// Same-origin only: this endpoint exists for the demo on this site.
	const origin = req.headers.get('origin')
	const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
	let originHost: string | null = null
	try { originHost = origin ? new URL(origin).host : null } catch { originHost = 'invalid' }
	if (originHost && originHost !== host) return fail(403, 'Cross-origin requests are not accepted.')

	const bytes = await readLimited(req, MAX_BODY_BYTES)
	if (!bytes) return fail(413, 'The font is larger than 10 MB.')
	if (bytes.byteLength < 48) return fail(400, 'Not a WOFF2 font.')

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.getUint32(0, false) !== WOFF2_MAGIC) return fail(400, 'Not a WOFF2 font.')
	// WOFF2 header: totalSfntSize (uint32) at byte 16 is the size of the decompressed font.
	const declaredSize = view.getUint32(16, false)
	if (declaredSize === 0 || declaredSize > MAX_SFNT_BYTES) return fail(413, 'The decompressed font would be larger than 20 MB.')
	// Real WOFF2 fonts expand 2–5×; a header claiming far more is a decompression bomb.
	if (declaredSize > bytes.byteLength * MAX_EXPANSION) return fail(400, 'This WOFF2 font declares an implausible decompressed size.')

	try {
		const { decompress } = await import('wawoff2')
		const result: Uint8Array = await decompress(bytes)
		if (result.byteLength > MAX_SFNT_BYTES) return fail(413, 'The decompressed font would be larger than 20 MB.')
		// Copy just the font's bytes (the result is a view into wawoff2's WebAssembly memory).
		const out = result.slice()
		return new NextResponse(out.buffer as ArrayBuffer, {
			headers: { 'Content-Type': 'font/ttf', 'Cache-Control': 'no-store' },
		})
	} catch {
		return fail(400, 'This WOFF2 font could not be decompressed.')
	}
}
