import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/mkj-inventory/',
  build: {
    target: 'es2020',
    cssTarget: 'safari14',
  },
})
