import type { Metadata } from "next"
import "./globals.css"
// Inter is also loaded locally in the demo (public/fonts/inter-300.woff) for glyph editing —
// the two copies serve different purposes: this one styles the page shell, the local copy is
// parsed as binary by glyphShaper so users can edit its glyphs. Do not remove either.
import { Inter } from "next/font/google"
import SiteHeader from "../components/SiteHeader"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
	title: "glyphShaper — Live glyph path editor for the browser",
	icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
	description: "Click any character, drag its bezier control points, every instance on the page updates instantly. opentype.js-powered font regeneration — no server, no export.",
	keywords: ["typography", "glyph", "bezier", "font editor", "opentype", "path editing", "font-face", "interactive", "TypeScript", "npm", "react"],
	openGraph: {
		title: "glyphShaper — Live glyph path editor for the browser",
		description: "Click any character, reshape its bezier curves, watch every instance update instantly. opentype.js-powered font regeneration — no server, no export.",
		url: "https://glyphshaper.com",
		siteName: "glyphShaper",
		type: "website",
		images: [
			{
				url: "https://glyphshaper.com/opengraph-image",
				width: 1200,
				height: 630,
				alt: "glyphShaper — Live bezier glyph editor in the browser",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		site: "@liiift_studio",
		creator: "@liiift_studio",
		title: "glyphShaper — Live glyph path editor for the browser",
		description: "Click any character, reshape its bezier curves, watch every instance update instantly. opentype.js-powered font regeneration — no server, no export.",
	},
	metadataBase: new URL("https://glyphshaper.com"),
	alternates: { canonical: "https://glyphshaper.com" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`h-full antialiased ${inter.variable}`}>
			<body className="min-h-full flex flex-col">
				<SiteHeader current="glyphShaper" githubUrl="https://github.com/Liiift-Studio/glyphShaper" />{children}</body>
		</html>
	)
}
