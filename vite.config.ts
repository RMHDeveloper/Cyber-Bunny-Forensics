import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite's `define` only rewrites `process.env.*` during `vite build`; in `vite dev`
 * the client-side define pass is skipped, so `process.env.API_KEY` would reach the
 * browser verbatim and throw "process is not defined". This dev-only plugin does the
 * same substitution the build does, so `npm run dev` works without touching app code.
 */
const injectEnvInDev = (value: string): Plugin => ({
  name: 'inject-gemini-key-dev',
  apply: 'serve',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('/node_modules/') || !/\.[jt]sx?$/.test(id)) return null;
    if (!code.includes('process.env.API_KEY') && !code.includes('process.env.GEMINI_API_KEY')) return null;
    return code
      .replace(/process\.env\.API_KEY/g, value)
      .replace(/process\.env\.GEMINI_API_KEY/g, value);
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Always a string literal (never `undefined`) so `process.env.API_KEY` can't
    // become a bare ReferenceError in the browser when the key is unset.
    const key = JSON.stringify(env.GEMINI_API_KEY || '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), injectEnvInDev(key)],
      define: {
        'process.env.API_KEY': key,
        'process.env.GEMINI_API_KEY': key
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
