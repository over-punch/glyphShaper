// vite.config.ts — library-mode build for ESM + CJS + types
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

export default defineConfig({
	plugins: [
		react(),
		dts({ include: ['src'], exclude: ['src/__tests__/**'], rollupTypes: true }),
	],
	build: {
		lib: {
			entry: { index: 'src/index.ts', core: 'src/core.ts' },
			formats: ['es', 'cjs'],
			fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
		},
		rollupOptions: {
			external: ['react', 'react-dom', 'react/jsx-runtime', 'opentype.js', 'wawoff2'],
		},
	},
})
