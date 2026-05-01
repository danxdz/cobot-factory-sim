import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      define: {
        'process.env.API_KEY' : JSON.stringify('api-key-this-is-not-used-can-be-ignored!'),
      },
      server: {
        proxy: {
          '/api-proxy': 'http://localhost:5000',
          '/ws-proxy': {target: 'ws://localhost:5000', ws: true},
        },
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        exclude: ['@babylonjs/core', '@babylonjs/havok'],
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: (id) => {
              if (id.includes('@babylonjs')) {
                return 'babylon';
              }
            }
          }
        }
      }
    };
});
