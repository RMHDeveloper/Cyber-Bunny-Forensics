import { GoogleGenAI } from "@google/genai";
import { AnalysisResult, GroundingSource } from "../types";

const MODEL = "gemini-3-flash-preview";
const PROXY_TIMEOUT_MS = 12000;

interface Proxy {
  name: string;
  build: (url: string) => string;
  extract: (res: Response) => Promise<string>;
}

/**
 * Public CORS proxies, tried in order. They come and go and rate-limit constantly,
 * so the engine treats every one as best-effort and falls back to search grounding
 * if none return usable HTML.
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

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
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
    head ? head[0].slice(0, 15000) : "not captured",
    ``,
    `BODY_SEGMENT:`,
    html.slice(0, 30000),
  ].join("\n");
};

const fetchSourceCode = async (
  url: string,
  onLog: (msg: string) => void,
  onProgress: (p: number) => void,
): Promise<string | null> => {
  let progress = 5;
  onProgress(progress);

  for (const proxy of PROXIES) {
    try {
      onLog(`Attempting fetch via ${proxy.name}...`);
      const res = await fetchWithTimeout(proxy.build(url), PROXY_TIMEOUT_MS);
      progress = Math.min(progress + 8, 45);
      onProgress(progress);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await proxy.extract(res);
      if (html && html.length > 300 && looksLikeHtml(html)) {
        onLog(`SUCCESS: ${proxy.name} retrieved source (${(html.length / 1024).toFixed(1)} KB).`);
        onProgress(50);
        return buildHints(url, html);
      }
      onLog(`${proxy.name} responded but returned no usable HTML.`);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const reason = e?.name === "AbortError" ? "timed out" : e?.message || "unknown error";
      onLog(`Proxy ${proxy.name} failed: ${reason}`);
    }
  }

  onLog("Direct source fetch unavailable. Falling back to search-grounded reconstruction...");
  onProgress(50);
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
    : `Direct source was not retrieved. Use Google Search to reconstruct the public profile from indexed data, public tech-lookup sites, and documentation.`
}

Return GitHub-flavored Markdown with EXACTLY these nine sections, each heading on its own
line, formatted precisely as "# N. TITLE":

${SECTIONS}

RULES:
- Sections 1-8 MUST be Markdown tables with columns: | Category | Details | Identification Method | AI Summary |
- Section 9 MUST be narrative prose using "- " bullet points (no table).
- Every heading MUST match "# N. TITLE" exactly: one "#", a space, the number, a period, a space.
- "Identification Method" = how it was detected (e.g. "/wp-content/ path", "gtag.js init", "response header").
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

const extractSources = (response: unknown): GroundingSource[] => {
  const chunks =
    (response as {
      candidates?: { groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] } }[];
    })?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const out: GroundingSource[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push({ title: c.web?.title || uri, uri });
    }
  }
  return out;
};

export const analyzeWebsite = async (
  url: string,
  onLog: (message: string) => void,
  onProgress: (percent: number) => void,
): Promise<AnalysisResult> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Gemini API key configured. Add GEMINI_API_KEY to .env.local and restart the dev server.",
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  onLog(`Initializing High-Fidelity Technology Profile: ${url}`);

  const observed = await fetchSourceCode(url, onLog, onProgress);

  const run = async (prompt: string, useSearch: boolean) => {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        temperature: 0.15,
        ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });
    return { response, text: normalizeHeadings((response.text || "").trim()) };
  };

  try {
    onLog("Synthesizing technical signatures with Gemini Search grounding...");
    onProgress(70);
    let { response, text } = await run(primaryPrompt(url, observed), true);

    if (isRefusal(text) || !hasSectionHeadings(text)) {
      onLog("Primary synthesis inconclusive. Retrying with constrained profiler prompt...");
      onProgress(85);
      ({ response, text } = await run(retryPrompt(url, observed), false));
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
      sources: extractSources(response),
      rawText: text,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Deep synthesis aborted.";
    onLog(`ENGINE ERROR: ${message}`);
    console.error("Forensic Engine Error:", error);
    throw new Error(message);
  }
};
