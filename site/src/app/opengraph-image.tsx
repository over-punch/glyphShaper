// glyphShaper/site/src/app/opengraph-image.tsx — OG image for glyphshaper.com
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt = 'glyphShaper — Live bezier glyph editor in the browser'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
	const interLight = await readFile(join(process.cwd(), 'public/fonts/inter-300.woff'))
	return new ImageResponse(
		(
			<div style={{ background: '#002126', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', fontFamily: 'Inter, sans-serif' }}>
				{/* Eyebrow label */}
				<span style={{ fontSize: 13, letterSpacing: '0.18em', color: '#acc3c3', textTransform: 'uppercase' }}>glyph shaper</span>

				{/* Bezier preview + headline */}
				<div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
					<div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginBottom: 40 }}>
						{/* Bezier path hint — stylised anchor + handle circles */}
						<svg width="120" height="120" viewBox="0 0 120 120">
							{/* Curve */}
							<path d="M 10 100 C 10 20 110 20 110 100" fill="none" stroke="#acc3c3" strokeWidth="2" />
							{/* Handle lines */}
							<line x1="10" y1="100" x2="10" y2="20" stroke="#707d7e" strokeWidth="1" strokeDasharray="3 3" />
							<line x1="110" y1="100" x2="110" y2="20" stroke="#707d7e" strokeWidth="1" strokeDasharray="3 3" />
							{/* Anchors (filled) */}
							<circle cx="10"  cy="100" r="7" fill="#acc3c3" />
							<circle cx="110" cy="100" r="7" fill="#acc3c3" />
							{/* Handles (outlined) */}
							<circle cx="10"  cy="20" r="5" fill="none" stroke="#acc3c3" strokeWidth="1.5" />
							<circle cx="110" cy="20" r="5" fill="none" stroke="#acc3c3" strokeWidth="1.5" />
						</svg>
					</div>
					<div style={{ fontSize: 76, color: '#eff7f7', lineHeight: 1.06, fontWeight: 300 }}>Edit a glyph.</div>
					<div style={{ fontSize: 76, color: '#acc3c3', lineHeight: 1.06, fontWeight: 300 }}>Keep the font.</div>
				</div>

				{/* Footer */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
					<div style={{ fontSize: 14, color: '#acc3c3', letterSpacing: '0.04em', display: 'flex', gap: 20 }}>
						<span>TypeScript</span><span style={{ color: '#707d7e' }}>·</span>
						<span>opentype.js</span><span style={{ color: '#707d7e' }}>·</span>
						<span>React + Vanilla JS</span>
					</div>
					<div style={{ fontSize: 13, color: '#8b9c9d', letterSpacing: '0.04em' }}>glyphshaper.com</div>
				</div>
			</div>
		),
		{ ...size, fonts: [{ name: 'Inter', data: interLight, style: 'normal', weight: 300 }] },
	)
}
