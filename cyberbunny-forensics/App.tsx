
import React, { useState } from 'react';
import { AnalysisForm } from './components/AnalysisForm';
import { ResultsDisplay } from './components/ResultsDisplay';
import { analyzeWebsite } from './services/gemini';
import { AnalysisResult } from './types';
import { ShieldCheck, Zap, Terminal, Code2, Box, ShieldAlert, MousePointer2, Tag, Layout } from 'lucide-react';

const DUMMY_RESULT: AnalysisResult = {
  url: "https://example-sample-site.com",
  techStack: { summary: "Sample Forensic Report" },
  sources: [
    { title: "Wappalyzer Technical Profile", uri: "https://www.wappalyzer.com" },
    { title: "BuiltWith Architecture Audit", uri: "https://builtwith.com" }
  ],
  rawText: `# 1. ARCHITECTURAL OVERVIEW
| Component | Details | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| CMS | WordPress 6.4.2 | /wp-includes/ path match | Site runs on the latest stable WordPress core. |
| Active Theme | Astra (v4.6.0) | Style.css header parsing | A lightweight, modern multipurpose theme is active. |
| Architecture | SSR | Server-side rendering headers | Dynamic content generated server-side for SEO. |

# 2. FRONTEND ECOSYSTEM & LIBRARIES
| Technology | Library/Framework | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| UI Framework | Tailwind CSS | Utility class patterns | Frontend uses a utility-first CSS approach. |
| JavaScript Lib | React.js | DOM mutation signatures | Interactive components built with React 18. |
| Icons | FontAwesome | CDN link resolution | Vector icons loaded via official Pro CDN. |

# 3. PLUGINS & EXTENSIONS
| Plugin Name | Function | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| Elementor Pro | Page Builder | /plugins/elementor-pro/ | Drag-and-drop builder handles visual layout. |
| Yoast SEO | Search Optimization | XML sitemap footprint | Manages on-page meta and search indexing. |
| WP Rocket | Performance | Comment tags in HTML | Active page caching and script minification. |

# 4. INFRASTRUCTURE & HOSTING
| Service | Provider | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| Hosting | Hostinger | IP Range & DNS Records | Hosted on Hostinger's Premium Cloud stack. |
| CDN | Cloudflare | CF-Cache-Status Header | Global edge delivery with active DDoS protection. |
| DNS | Hostinger DNS | NS record lookup | Domain managed via Hostinger's nameservers. |

# 5. MARKETING & TRACKING (DATA FLOW)
| Tool | Detail | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| Google Analytics | GA4 (G-8V6Z29L9W1) | gtag.js initialization | Advanced user flow and traffic tracking active. |
| Meta Pixel | ID: 987654321 | fbevents.js firing | Retargeting pixel active for FB/IG advertising. |
| Hotjar | Heatmaps | hjs.js script load | Session recording and visual user behavior active. |

# 6. SECURITY & HARDENING
| Layer | Status/Detail | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| SSL | Let's Encrypt | Certificate chain audit | Industry-standard encryption active and valid. |
| WAF | Cloudflare | Challenge-JS injection | Robust firewall protecting against SQLi and XSS. |
| Headers | HSTS Active | Strict-Transport-Security | Forces browser interaction via HTTPS only. |

# 7. FORENSIC SCRIPT ANALYSIS
| Script Source | Type | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| ads.js | Advertising | Outbound network calls | Third-party display ads script detected. |
| gtm.js | Management | Container hook analysis | Centralized tag management for all scripts. |

# 8. FORENSIC OBSERVATIONS
| Metric | Analysis | Identification Method | AI Summary |
| :--- | :--- | :--- | :--- |
| Performance | 85/100 | Simulation | High speed scores due to aggressive caching. |
| Tech Debt | High Plugin Count | Audit | 24 plugins active; risk of update conflicts. |

# 9. AI FORENSIC SUMMARY & SECURITY THREATS
Based on the forensic audit of the target architecture, CyberBunny has identified several critical security vectors and technical health markers.

- **Information Disclosure**: The presence of server headers reveals stack details.
- **Vulnerable Scripting**: Detected legacy JS fallbacks in source.
- **Data Privacy Compliance**: Behavioral tracking tools active without masking.
- **Security Verdict**: High Hardening status. Perimeter shielded by Cloudflare.
`
};

const HeaderCard: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="bg-slate-800/60 border border-slate-700 p-4 sm:p-5 rounded-2xl flex items-center gap-4 hover:border-slate-500 transition-all hover:-translate-y-1 shadow-xl shadow-black/10 group min-w-0 h-full overflow-hidden">
    <div className="p-3 bg-slate-900/80 rounded-2xl shadow-inner group-hover:scale-105 transition-transform flex-shrink-0">
      {icon}
    </div>
    <div className="min-w-0 flex-1 py-1">
      <span className="text-[9px] uppercase font-black text-slate-500 block tracking-widest mb-1 leading-none">{label}</span>
      <span className="text-xs sm:text-[13px] font-black text-slate-200 block tracking-tight leading-tight truncate sm:whitespace-normal">{value}</span>
    </div>
  </div>
);

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="p-6 sm:p-8 bg-slate-800/30 border border-slate-700/50 rounded-3xl flex flex-col gap-4 transition-all hover:bg-slate-800/60 hover:border-slate-500 hover:-translate-y-1 shadow-lg group">
    <div className="flex items-center gap-3">
      <div className="p-3 bg-slate-900/50 rounded-xl group-hover:scale-110 transition-transform group-hover:shadow-blue-500/10">
        {icon}
      </div>
      <h3 className="font-black text-slate-100 tracking-tight">{title}</h3>
    </div>
    <p className="text-sm text-slate-400 leading-relaxed font-medium">{description}</p>
  </div>
);

const App: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ id: string; msg: string; timestamp: string }[]>([]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, { 
      id: Math.random().toString(36).substr(2, 9), 
      msg, 
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
    }].slice(-50));
  };

  const handleAnalyze = async (url: string) => {
    setLoading(true);
    setProgress(0);
    setError(null);
    setResult(null);
    setLogs([]); 

    try {
      addLog("Booting CyberBunny High-Precision Inspection Engine...");
      const data = await analyzeWebsite(url, addLog, setProgress);
      setResult(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      addLog(`CRITICAL ERROR: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const showSampleAudit = () => {
    setResult(DUMMY_RESULT);
    setError(null);
    setLogs([]);
  };

  const LogTerminal = () => (
    <div className="w-full mt-8 animate-fade-in">
      <div className="bg-slate-900/95 border border-slate-700 rounded-2xl shadow-xl overflow-hidden backdrop-blur-lg">
        <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Forensic Logs</span>
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`}></div>
            <span className="text-[8px] font-mono text-slate-500 uppercase tracking-tighter">{loading ? 'Active' : 'Process Finalized'}</span>
          </div>
        </div>
        <div className="h-32 sm:h-40 overflow-y-auto p-4 font-mono text-[10px] sm:text-[11px] space-y-2 scrollbar-thin scrollbar-thumb-slate-700 bg-black/20">
          {logs.length === 0 && !loading && <div className="text-slate-600">No logs in current session...</div>}
          {logs.map(log => (
            <div key={log.id} className="flex gap-3 border-l border-slate-800/50 pl-3">
              <span className="text-slate-600 font-light select-none tabular-nums">[{log.timestamp}]</span>
              <span className={log.msg.includes('ERROR') ? 'text-red-400' : log.msg.includes('SUCCESS') ? 'text-blue-300 font-bold' : 'text-slate-300'}>
                {log.msg.startsWith('>') ? log.msg : `> ${log.msg}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const StatsGrid = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 w-full animate-fade-in">
      <HeaderCard icon={<Box className="text-blue-400 w-5 h-5" />} label="Infrastructure" value="Cloud & DNS Stack" />
      <HeaderCard icon={<ShieldAlert className="text-red-400 w-5 h-5" />} label="Compliance" value="Security Hardening" />
      <HeaderCard icon={<MousePointer2 className="text-green-400 w-5 h-5" />} label="Analytics" value="Behavioral Tracking" />
      <HeaderCard icon={<Tag className="text-yellow-400 w-5 h-5" />} label="Platform" value="CMS & Theme Tech" />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 pb-32 transition-colors duration-500">
      <header className="w-full max-w-5xl mb-12 text-center animate-fade-in">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-5">
          <div className="bg-blue-600 p-3 sm:p-3.5 rounded-2xl shadow-2xl shadow-blue-500/20 transform hover:rotate-3 transition-transform cursor-pointer">
            <img src="https://i.ibb.co/fzbm79b7/Untitled-design-20260111-175353-0000.png" alt="CyberBunny Logo" className="w-8 h-8 object-contain" />
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tighter">
            CyberBunny <span className="text-blue-500">Forensics</span>
          </h1>
        </div>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl max-w-2xl mx-auto font-medium px-4">
          Multi-proxy <span className="text-blue-400 font-bold">Source Auditing</span> combined with AI Grounding.
        </p>
      </header>

      <main className="w-full max-w-4xl space-y-10">
        <section className="bg-slate-800/50 border border-slate-700 rounded-[1.5rem] sm:rounded-[2.5rem] p-5 sm:p-8 md:p-12 shadow-2xl backdrop-blur-md relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 bg-blue-500/5 animate-pulse pointer-events-none" />
          )}
          
          <AnalysisForm onAnalyze={handleAnalyze} isLoading={loading} />
          
          {!loading && !result && (
            <div className="mt-8 flex justify-center">
              <button 
                onClick={showSampleAudit}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest text-blue-400 transition-all active:scale-95 group"
              >
                <Layout className="w-4 h-4 group-hover:rotate-6 transition-transform" />
                View Sample Forensic Audit
              </button>
            </div>
          )}

          {error && (
            <div className="mt-8 p-4 sm:p-5 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-sm flex items-start sm:items-center gap-4 animate-shake">
              <div className="p-2 bg-red-500/20 rounded-lg flex-shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <span className="font-bold tracking-tight">{error}</span>
            </div>
          )}
        </section>

        {loading && (
          <div className="flex flex-col items-center justify-center space-y-8 py-12">
            <div className="relative flex items-center justify-center w-32 h-32 sm:w-40 sm:h-40">
              <div className="absolute inset-0 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin"></div>
              <div className="flex flex-col items-center justify-center text-center p-4">
                <span className="text-2xl sm:text-3xl font-black text-white mono tracking-tighter leading-none">{progress}%</span>
                <span className="text-[7px] sm:text-[9px] uppercase font-black text-blue-500 tracking-[0.15em] mt-1.5 leading-tight">Audit<br/>Progress</span>
              </div>
              <div className="absolute -top-1 -right-1 sm:-top-2 sm:-right-2 bg-slate-900 border border-slate-700 p-2 rounded-xl shadow-2xl animate-bounce">
                <Code2 className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-blue-400" />
              </div>
            </div>
            
            <div className="text-center space-y-4 w-full max-w-md px-4">
              <p className="text-lg sm:text-xl font-black text-white tracking-tight italic">
                {progress < 50 ? 'Retaining Forensic Data...' : 'Deep AI Synthesis...'}
              </p>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                <div 
                  className="h-full bg-blue-500 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(59,130,246,0.6)]"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            <LogTerminal />
            <StatsGrid />
          </div>
        )}

        {result && (
          <div className="space-y-12">
            <ResultsDisplay result={result} />
            <div className="space-y-8">
              <LogTerminal />
              <StatsGrid />
              <div className="flex justify-center">
                <button 
                  onClick={() => {setResult(null); setLogs([]);}}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors py-2 px-4"
                >
                  New Analysis
                </button>
              </div>
            </div>
          </div>
        )}

        {!result && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12">
            <FeatureCard 
              icon={<Code2 className="w-5 h-5 text-blue-400" />}
              title="Verified Source"
              description="Extracts theme paths directly from HTML source via redundant proxies."
            />
            <FeatureCard 
              icon={<ShieldCheck className="w-5 h-5 text-green-400" />}
              title="Architectural Audit"
              description="Identifies CMS, plugins, and libraries using codebase fingerprints."
            />
            <FeatureCard 
              icon={<Zap className="w-5 h-5 text-yellow-400" />}
              title="AI Forensic synthesis"
              description="Validates hosting and domain infrastructure via Search grounding."
            />
          </div>
        )}
      </main>

      <footer className="mt-20 py-8 border-t border-slate-800/50 w-full max-w-4xl px-4">
        <div className="flex flex-col items-center gap-3">
          <p className="text-slate-500 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.4em] text-center opacity-70">
            CyberBunny Forensics • Engine v3.0
          </p>
          <p className="text-slate-400 text-xs font-medium text-center">
            Developed by <a href="https://rabbitmarketinghouse.in" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 transition-colors underline underline-offset-4 decoration-blue-500/20">Rabbit Marketing House</a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
