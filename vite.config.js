import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути: сайт работает и в корне домена, и в подпапке (GitHub Pages: /имя-репозитория/).
  base: './',
  server: { port: 5180, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
