import { GoogleGenAI } from "@google/genai";
import { AnalysisResult, TechStackInfo, GroundingSource } from "../types";

/**
 * Tries to fetch the website source using multiple CORS proxies with progress tracking.
 */
const fetchSourceCode = async (
  url: string, 
  onLog: (msg: string) => void,
  onProgress: (p: number) => void
): Promise<string | null> => {
  const proxies = [
    { name: "AllOrigins", url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, type: 'json' },
    { name: "CorsProxy.io", url: `https://corsproxy.io/?${encodeURIComponent(url)}`, type: 'text' },
    { name: "CodeTabs", url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, type: 'text' }
  ];

  let currentProgress = 5;
  onProgress(currentProgress);

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    try {
      onLog(`Attempting fetch via ${proxy.name}...`);
      const response = await fetch(proxy.url, { cache: 'no-store' });
      
      currentProgress += 10;
      onProgress(currentProgress);

      if (!response.ok) throw new Error(`${proxy.name} returned status ${response.status}`);
      
      let html = '';
      if (proxy.type === 'json') {
        const data = await response.json();
        html = data.contents;
      } else {
        html = await response.text();
      }

      if (html && html.length > 200) {
        onLog(`SUCCESS: ${proxy.name} retrieved source (${(html.length / 1024).toFixed(1)} KB).`);
        onProgress(50);
        
        const themeMatches = html.match(/wp-content\/themes\/([^/]+)\//g) || [];
        const uniqueThemes = [...new Set(themeMatches.map(m => m.split('/')[2]))];
        
        const pluginMatches = html.match(/wp-content\/plugins\/([^/]+)\//g) || [];
        const uniquePlugins = [...new Set(pluginMatches.map(m => m.split('/')[2]))];

        const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
        const bodyPreview = html.slice(0, 40000); 

        return `
          URL: ${url}
          ENGINE_HINTS:
          - CMS: ${html.includes('wp-content') ? 'WordPress' : html.includes('shopify') ? 'Shopify' : 'Check source'}
          - THEMES: ${uniqueThemes.join(', ')}
          - PLUGINS: ${uniquePlugins.join(', ')}
          
          PAGE_SOURCE_SEGMENT:
          ${bodyPreview}
          
          HEAD_TAGS:
          ${headMatch ? headMatch[0].slice(0, 15000) : "Not captured"}
        `;
      }
    } catch (error: any) {
      onLog(`Proxy ${proxy.name} failed: ${error.message}`);
    }
  }

  onLog("CRITICAL: Direct source fetch failed. Initializing deep search forensics...");
  onProgress(50);
  return null;
};

export const analyzeWebsite = async (
  url: string, 
  onLog: (message: string) => void,
  onProgress: (percent: number) => void
): Promise<AnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  onLog(`Initializing High-Fidelity Forensic Audit: ${url}`);
  
  const rawHtmlData = await fetchSourceCode(url, onLog, onProgress);

  const prompt = `
    ROLE: Senior Web Forensic Architect at CyberBunny.
    TASK: Generate a high-fidelity technical discovery report for: ${url}

    ${rawHtmlData ? `PRIMARY SOURCE DATA:
    ---
    ${rawHtmlData}
    ---` : `
    NOTE: Direct source access limited. Use Google Search grounding to reconstruct the stack.
    `}

    MANDATORY REPORT STRUCTURE (ALL HEADINGS MUST BE NUMBERED STARTING FROM 1):
    # 1. ARCHITECTURAL OVERVIEW
    CMS, Active Theme, Parent Theme, and Site Architecture.

    # 2. FRONTEND ECOSYSTEM & LIBRARIES
    UI Frameworks, JS Libraries, Icon sets, Typography.

    # 3. PLUGINS & EXTENSIONS
    WordPress plugins or Shopify apps detected in paths.

    # 4. INFRASTRUCTURE & HOSTING
    Hosting Provider, Nameservers, CDN, IP range.

    # 5. MARKETING & TRACKING (DATA FLOW)
    IMPORTANT: Search the source code for specific tracking IDs.
    - Extract Google Analytics IDs (e.g., G-XXXXXX or UA-XXXXX).
    - Extract Google Tag Manager IDs (e.g., GTM-XXXXXX).
    - Extract Meta/Facebook Pixel IDs.
    List these explicitly in the 'Details' column.

    # 6. SECURITY & HARDENING
    SSL status, Security Headers (HSTS, CSP), WAF presence. Provide FULL DATA.

    # 7. FORENSIC SCRIPT ANALYSIS
    Third-party external scripts, unusual tracking behavior. Provide FULL DATA.

    # 8. FORENSIC OBSERVATIONS
    Performance metrics, Tech debt markers, Bloat analysis. Provide FULL DATA.

    # 9. AI FORENSIC SUMMARY & SECURITY THREATS
    IMPORTANT: This final section must be a narrative technical summary instead of a table. Analyze the gathered data for potential security risks, AI-identified vulnerabilities, and a final technical security verdict.

    STRICT RULES:
    - Sections 1 through 8 MUST be presented as Markdown tables.
    - Section 9 MUST be a narrative text summary with bullet points for specific threats.
    - EVERY heading MUST be numbered (1, 2, ... 9).
    - For tables, use these columns: | Category | Details | Identification Method | AI Summary |
    - "Identification Method" explains how the tech was spotted (e.g., "JS fingerprint", "/wp-content/ path").
    - "AI Summary" is a single sentence takeaway for that item.
    - NO concluding signatures.
  `;

  try {
    onLog("Synthesizing technical signatures with Gemini Search Grounding...");
    onProgress(70);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    onLog("Report finalized. Formatting Forensic Blueprint...");
    onProgress(100);

    const rawText = response.text || "Forensic report generation failed.";
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: GroundingSource[] = groundingChunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        title: chunk.web.title,
        uri: chunk.web.uri,
      }));

    return {
      url,
      techStack: { summary: rawText },
      sources,
      rawText
    };
  } catch (error) {
    onLog("FATAL ENGINE ERROR: Deep synthesis aborted.");
    console.error("Forensic Engine Error:", error);
    throw new Error("Target is heavily shielded or the engine encountered an error.");
  }
};