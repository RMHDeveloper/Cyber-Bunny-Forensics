import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite's `define` only rewrites `process.env.*` during `vite build`; in `vite dev`
 * the client-side define pass is skipped, so `process.env.OPENROUTER_API_KEY` would
 * reach the browser verbatim and throw "process is not defined". This dev-only
 * plugin does the same substitution the build does, so `npm run dev` works without
 * touching app code.
 */
const injectEnvInDev = (replacements: Record<string, string>): Plugin => ({
  name: 'inject-env-dev',
  apply: 'serve',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('/node_modules/') || !/\.[jt]sx?$/.test(id)) return null;
    let out = code;
    let touched = false;
    for (const [expr, literal] of Object.entries(replacements)) {
      if (out.includes(expr)) {
        out = out.split(expr).join(literal);
        touched = true;
      }
    }
    return touched ? out : null;
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Always a string literal (never `undefined`) so `process.env.*` can't
    // become a bare ReferenceError in the browser when the key is unset.
    const openRouterKey = JSON.stringify(env.OPENROUTER_API_KEY || '');
    const replacements = {
      'process.env.OPENROUTER_API_KEY': openRouterKey,
      'process.env.API_KEY': openRouterKey,
    };
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), injectEnvInDev(replacements)],
      define: replacements,
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
