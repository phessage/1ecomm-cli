import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: { port: 5173, strictPort: false },
  // @1ecomm/dt-ui-vue ships .vue single-file components rather than a build, so
  // Vite must compile them like first-party code. Excluding them from
  // pre-bundling is what makes that work.
  optimizeDeps: { exclude: ['@1ecomm/dt-ui-vue', '@1ecomm/dt-ui-core'] },
});
