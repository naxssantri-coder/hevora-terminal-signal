import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'public',
      emptyOutDir: true,
    },
    // static/ holds hand-placed assets (logo, PWA manifest/icons) that must survive a production
    // build. publicDir was previously `false` because outDir ('public') doubles as the build
    // output folder - emptyOutDir wipes it on every build, so anything placed directly in
    // public/ (rather than copied in by Vite) would be deleted on the next `vite build`. Vite
    // copies publicDir's contents into outDir automatically as part of the build, which both
    // fixes that and makes these assets served natively by Vite's dev server too (no more manual
    // express.static wiring needed in server.ts for this).
    publicDir: path.resolve(__dirname, 'static'),
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
