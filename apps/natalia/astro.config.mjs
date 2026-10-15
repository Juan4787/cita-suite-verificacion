import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  vite: { plugins: [tailwindcss()], build: { cssMinify: true } }
});
