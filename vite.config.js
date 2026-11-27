import { defineConfig } from 'vite';
import { thirdPartyNotices } from './build/third-party-notices.js';

export default defineConfig({
  plugins: [thirdPartyNotices()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('/node_modules/@firebase/firestore/')) return 'firestore';
          if (id.includes('/node_modules/@firebase/auth/')) return 'auth';
        }
      }
    }
  }
});
