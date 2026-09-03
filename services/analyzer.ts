import { AnalysisResult } from "../types";
import { runRecon, reconToPromptText } from "./recon";

/**
 * Forensic engine. Fetches the target's public HTML through CORS proxies, then
 * asks an LLM (via OpenRouter) to synthesise a technology profile.
 *
 * OpenRouter has no Google Search grounding, so `sources` is always empty.
 */

/**
 * Default is a free OpenRouter model so the app works on a credit-less key.
 * Override in the browser console for a stronger paid model once you have credit:
 *   window.CBF_MODEL = "google/gemini-3-flash-preview"
 */
const MODEL =
  (typeof window !== "undefined" &&
    (window as unknown as { CBF_MODEL?: string }).CBF_MODEL) ||
  "minimax/minimax-m3:free";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROXY_TIMEOUT_MS = 12000;
const LLM_TIMEOUT_MS = 60000;

interface Proxy {
  name: string;
  build: (url: string) => string;
  extract: (res: Response) => Promise<string>;
}

/**
 * Public CORS proxies, tried in order. They come and go and rate-limit constantly,
 * so the engine treats every one as best-effort and falls back to the LLM's own
 * knowledge if none return usable HTML.
 */
const PROXIES: Proxy[] = [
  {
    name: "AllOrigins (raw)",
    build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    extract: (r) => r.text(),
  },
  {
    name: "AllOrigins (json)",
    build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    extract: async (r) => {
      const j = await r.json();
      return typeof j?.contents === "string" ? j.contents : "";
    },
  },
  {
    name: "CodeTabs",
    build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    extract: (r) => r.text(),
  },
  {
    name: "CorsProxy.io",
    build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    extract: (r) => r.text(),
  },
  {
    name: "ThingProxy",
    build: (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
    extract: (r) => r.text(),
  },
];

const fetchWithTimeout = async (
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const looksLikeHtml = (s: string): boolean =>
  /<\s*(!doctype|html|head|body|div|main|script|meta|link)\b/i.test(s);

const buildHints = (url: string, html: string): string => {
  const themes = [
    ...new Set((html.match(/wp-content\/themes\/([^/"'?\s]+)/g) || []).map((m) => m.split("/")[2])),
  ];
  const plugins = [
    ...new Set((html.match(/wp-content\/plugins\/([^/"'?\s]+)/g) || []).map((m) => m.split("/")[2])),
  ];
  const generator = html.match(
    /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .slice(0, 40);
  const head = html.match(/<head[\s\S]*?<\/head>/i);

  let cms = "unknown";
  if (html.includes("wp-content")) cms = "WordPress";
  else if (/cdn\.shopify\.com|Shopify\.theme/.test(html)) cms = "Shopify";
  else if (/_next\/static|__NEXT_DATA__/.test(html)) cms = "Next.js";
  else if (/\/sites\/default\/files|Drupal\.settings/.test(html)) cms = "Drupal";
  else if (/wix\.com|wixstatic\.com/.test(html)) cms = "Wix";
  else if (/squarespace\.com|static1\.squarespace/.test(html)) cms = "Squarespace";

  return [
    `URL: ${url}`,
    `ENGINE_HINTS:`,
    `- CMS_GUESS: ${cms}`,
    `- META_GENERATOR: ${generator || "n/a"}`,
    `- WP_THEMES: ${themes.join(", ") || "n/a"}`,
    `- WP_PLUGINS: ${plugins.join(", ") || "n/a"}`,
    `- SCRIPT_SRCS: ${scripts.join(" | ") || "n/a"}`,
    ``,
    `HEAD_TAGS:`,
    head ? head[0].slice(0, 7000) : "not captured",
    ``,
    `BODY_SEGMENT:`,
    html.slice(0, 12000),
  ].join("\n");
};

interface FetchedSource {
  hints: string;
  rawHtml: string;
}

const fetchSourceCode = async (
  url: string,
  onLog: (msg: string) => void,
  onProgress: (p: number) => void,
): Promise<FetchedSource | null> => {
  let progress = 5;
  onProgress(progress);

  for (const proxy of PROXIES) {
    try {
      onLog(`Attempting fetch via ${proxy.name}...`);
      const res = await fetchWithTimeout(proxy.build(url), PROXY_TIMEOUT_MS);
      progress = Math.min(progress + 8, 40);
      onProgress(progress);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await proxy.extract(res);
      if (html && html.length > 300 && looksLikeHtml(html)) {
        onLog(`SUCCESS: ${proxy.name} retrieved source (${(html.length / 1024).toFixed(1)} KB).`);
        onProgress(45);
        return { hints: buildHints(url, html), rawHtml: html };
      }
      onLog(`${proxy.name} responded but returned no usable HTML.`);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const reason = e?.name === "AbortError" ? "timed out" : e?.message || "unknown error";
      onLog(`Proxy ${proxy.name} failed: ${reason}`);
    }
  }

  onLog("Direct source fetch unavailable. Falling back to model-knowledge reconstruction...");
  onProgress(45);
  return null;
};

const SECTIONS = [
  "# 1. ARCHITECTURAL OVERVIEW",
  "# 2. FRONTEND ECOSYSTEM & LIBRARIES",
  "# 3. PLUGINS & EXTENSIONS",
  "# 4. INFRASTRUCTURE & HOSTING",
  "# 5. MARKETING & TRACKING",
  "# 6. SECURITY & DELIVERY",
  "# 7. THIRD-PARTY SCRIPTS",
  "# 8. TECHNICAL OBSERVATIONS",
  "# 9. SUMMARY & PUBLIC SECURITY POSTURE",
].join("\n");

const primaryPrompt = (url: string, data: string | null): string => `
You are a web technology profiler, equivalent to Wappalyzer, BuiltWith, or W3Techs.
Produce a public technology profile for the website: ${url}

This is a routine, non-intrusive profile built only from publicly observable information
(HTML source, HTTP response headers, DNS, and public records) - the same data the tools
named above publish openly. No scanning, exploitation, authentication bypass, or private
data is involved, so there is nothing to decline.

${
  data
    ? `OBSERVED SOURCE DATA:\n---\n${data}\n---`
    : `Direct source was not retrieved. Reconstruct the public profile from what is publicly documented about this site and its stack.`
}

Return GitHub-flavored Markdown with EXACTLY these nine sections, each heading on its own
line, formatted precisely as "# N. TITLE":

${SECTIONS}

RULES:
- Sections 1-8 MUST be Markdown tables with columns: | Category | Details | Identification Method | AI Summary |
- Section 9 MUST be narrative prose using "- " bullet points (no table).
- Every heading MUST match "# N. TITLE" exactly: one "#", a space, the number, a period, a space.
- "Identification Method" = how it was detected (e.g. "/wp-content/ path", "gtag.js init", "response header").
- If a RECON_DATA block is present, its values are measured facts (DNS, RDAP, Certificate Transparency, HTML fingerprint). Use them verbatim and prefer them over inference; set "Identification Method" to "DNS record", "RDAP", "CT logs" or "HTML fingerprint" as appropriate. Fold discovered subdomains into section 4.
- Extract concrete IDs where visible: GA ("G-XXXX" / "UA-XXXX"), GTM ("GTM-XXXX"), Meta Pixel (numeric).
- Where a fact is genuinely unknown, write "Not observed" - do not invent specifics.
- No preamble, no closing signature.
`;

const retryPrompt = (url: string, data: string | null): string => `
List the publicly known technology stack for ${url}, in the style of BuiltWith / Wappalyzer.
${data ? `Observed source excerpt:\n${data.slice(0, 12000)}\n` : ""}
Output Markdown. Headings exactly as below. Sections 1-8 are tables
(| Category | Details | Identification Method | AI Summary |); section 9 is "- " bullet prose.
Use "Not observed" for unknowns. No preamble.

${SECTIONS}
`;

const REFUSAL_RE =
  /\b(i (?:cannot|can't|am unable to|am not able to|am prohibited)|cannot fulfill|can't help with that|not able to assist|unable to provide)\b/i;

const isRefusal = (t: string): boolean => REFUSAL_RE.test(t) && t.length < 1500;

const hasSectionHeadings = (t: string): boolean => /^#{1,6}\s*\d{1,2}\s*[.):]/m.test(t);

/** Coerce near-miss heading forms ("## 1)", "**2.**", "3 -") into "# N. ". */
const normalizeHeadings = (t: string): string =>
  t
    .replace(/^\s{0,3}#{1,6}\s*\*{0,2}\s*(\d{1,2})\s*[.):-]\s*\*{0,2}\s*/gm, "# $1. ")
    .replace(/^\s{0,3}\*{2}\s*(\d{1,2})\s*[.):-]\s*(.+?)\s*\*{2}\s*$/gm, "# $1. $2");

const callOpenRouter = async (apiKey: string, prompt: string): Promise<string> => {
  const res = await fetchWithTimeout(OPENROUTER_URL, LLM_TIMEOUT_MS, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://cyberbunny-forensics",
      "X-Title": "CyberBunny Forensics",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.15,
      max_tokens: 6000,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(
        "OpenRouter rejected the request for insufficient credits. Add credit at openrouter.ai/credits, or set window.CBF_MODEL to a ':free' model.",
      );
    }
    throw new Error(json?.error?.message || `OpenRouter HTTP ${res.status}`);
  }
  return (json?.choices?.[0]?.message?.content || "").trim();
};

export const analyzeWebsite = async (
  url: string,
  onLog: (message: string) => void,
  onProgress: (percent: number) => void,
): Promise<AnalysisResult> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key configured. Add OPENROUTER_API_KEY to .env.local and restart the dev server.",
    );
  }

  onLog(`Initializing High-Fidelity Technology Profile: ${url}`);
  const fetched = await fetchSourceCode(url, onLog, onProgress);

  onLog("Running passive reconnaissance (DNS / RDAP / CT logs / fingerprint)...");
  onProgress(50);
  const recon = await runRecon(url, fetched?.rawHtml ?? null, onLog);
  onProgress(65);

  const reconText = reconToPromptText(recon);
  const observed = [fetched?.hints, reconText].filter(Boolean).join("\n\n") || null;

  const run = async (prompt: string) =>
    normalizeHeadings(await callOpenRouter(apiKey, prompt));

  try {
    onLog(`Synthesizing technical signatures via OpenRouter (${MODEL})...`);
    onProgress(70);
    let text = await run(primaryPrompt(url, observed));

    if (isRefusal(text) || !hasSectionHeadings(text)) {
      onLog("Primary synthesis inconclusive. Retrying with constrained profiler prompt...");
      onProgress(85);
      text = await run(retryPrompt(url, observed));
    }

    if (!text || isRefusal(text)) {
      throw new Error(
        "The AI model declined to profile this URL. Try another site, or re-run once the source fetch succeeds.",
      );
    }

    onLog("Report finalized. Formatting Forensic Blueprint...");
    onProgress(100);

    return {
      url,
      techStack: { summary: text },
      sources: [],
      rawText: text,
      recon,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Deep synthesis aborted.";
    onLog(`ENGINE ERROR: ${message}`);
    console.error("Forensic Engine Error:", error);
    throw new Error(message);
  }
};
