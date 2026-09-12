import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: false },
  // @1ecomm/dt-ui-react ships TypeScript source rather than a build, so Vite
  // must compile it like first-party code. Excluding it from pre-bundling is
  // what makes that work; without this the dev server serves raw .tsx to the
  // browser and every component import fails.
  optimizeDeps: { exclude: ['@1ecomm/dt-ui-react', '@1ecomm/dt-ui-core'] },
});
