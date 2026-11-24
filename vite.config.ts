import { defineConfig } from 'vite';

// COOP/COEP включают cross-origin isolation: Chrome даёт таймеры
// с точностью 5 мкс вместо 100 мкс — это важно для честной оценки тайминга.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { port: 5173, strictPort: false, headers: isolation },
  preview: { port: 5173, headers: isolation },
});
