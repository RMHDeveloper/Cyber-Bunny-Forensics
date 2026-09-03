# CyberBunny Forensics

Website technology-profiling tool. Fetches a target site's public HTML through
CORS proxies, then asks an LLM (via OpenRouter) to synthesise a 9-section
technical report. Built with React 19 + Vite.

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```
   npm install
   ```
2. Create `.env.local` with an OpenRouter API key:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   ```
   Get one free at https://openrouter.ai/keys
3. Start the dev server: 
   ```
   npm run dev
   ```
   Opens on http://localhost:3000

The default model is `minimax/minimax-m3:free` (works on a credit-less key).
To use a stronger paid model, in the browser console:
`window.CBF_MODEL = "google/gemini-3-flash-preview"`

## Deploy to Vercel

1. Import this repo in Vercel (framework preset: **Vite** — `vercel.json` sets it).
2. Project → **Settings → Environment Variables** → add `OPENROUTER_API_KEY`
   for Production, Preview and Development.
3. Deploy (or **Redeploy without build cache** if the project already existed).

> The key is inlined into the client bundle at build time, so it is visible in
> the deployed site's JavaScript. Use a restricted / free key, rotate it if it
> leaks, and move the API call behind a serverless function for anything
> sensitive.

If no `OPENROUTER_API_KEY` is set at build time, the deployed site still loads:
it shows a key field and stores whatever the visitor pastes in their browser's
`localStorage` only. After changing the deployment branch or env vars, trigger a
fresh deploy ("Redeploy without build cache") — the old bundle is served until
you do.

## Build

```
npm run build      # -> dist/
npm run preview     # serve the production build locally
```
