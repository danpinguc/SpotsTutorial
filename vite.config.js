import { defineConfig } from 'vite';

/** Static preview with live reload (plain HTML/CSS/JS, no bundle). */
export default defineConfig({
  server: {
    port: 5500,
    open: true,
    watch: {
      usePolling: true,
    },
  },
});
