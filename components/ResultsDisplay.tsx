import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnalysisResult } from '../types';
import { Download, Globe, X, Mail, AlertCircle, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface ResultsDisplayProps {
  result: AnalysisResult;
}

const ABSTRACT_API_KEY = '58ca3227ac5441e6b489ba4605bdb2bc';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inline SVG (no network) so html2canvas never taints the canvas on a cross-origin logo.
const PDF_LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='12' fill='%232563eb'/%3E%3Ccircle cx='21' cy='21' r='9' fill='none' stroke='white' stroke-width='4'/%3E%3Cline x1='27' y1='27' x2='38' y2='38' stroke='white' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E";

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Inline markdown -> HTML. Input is escaped first, so the output is XSS-safe. */
const parseLine = (line: string): string =>
  escapeHtml(line)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+?)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline decoration-blue-500/40">$1</a>',
    );

const SECTION_RE = /^#{0,6}\s*\*{0,2}\s*(\d{1,2})\s*[.):-]\s*\*{0,2}\s*/;

/**
 * Split the report into numbered sections, tolerating heading forms like
 * "# 1.", "## 1)", "**1.**", "1 - ". Returns {} if nothing parses.
 */
const getSectionContent = (text: string): Record<number, string[]> => {
  const sections: Record<number, string[]> = {};
  let current = 0;

  for (const line of text.split('\n')) {
    const match = line.trim().match(SECTION_RE);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 20) {
        current = n;
        const title = line.trim().replace(SECTION_RE, '').trim();
        sections[current] = [`# ${current}. ${title}`];
        continue;
      }
    }
    if (current > 0) sections[current].push(line);
  }
  return sections;
};

export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [allowBypass, setAllowBypass] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const autoDownloadedRef = useRef(false);

  const generatePDF = useCallback(async () => {
    const element = printRef.current;
    if (!element) return;

    const domain = result.url.replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '') || 'report';

    element.style.display = 'block';
    element.style.visibility = 'visible';
    element.style.opacity = '1';

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        imageTimeout: 15000,
        backgroundColor: '#ffffff',
        windowWidth: 800,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;

      // Slice the tall capture across as many A4 pages as needed.
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH, undefined, 'FAST');
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH, undefined, 'FAST');
        heightLeft -= pageH;
      }

      pdf.save(`CyberBunny-Forensic-Report-${domain}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Forensic PDF synthesis failed. Please check your connection and try again.');
    } finally {
      element.style.display = 'none';
      element.style.visibility = 'hidden';
      element.style.opacity = '0';
    }
  }, [result.url]);

  // Auto-download once verification flips true while the modal is open.
  useEffect(() => {
    if (isVerified && isModalOpen && !autoDownloadedRef.current) {
      autoDownloadedRef.current = true;
      generatePDF();
      setIsModalOpen(false);
    }
  }, [isVerified, isModalOpen, generatePDF]);

  const handleDownloadClick = () => {
    if (isVerified) {
      generatePDF();
    } else {
      setVerificationError(null);
      setIsModalOpen(true);
    }
  };

  const verifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setVerificationError('Enter a valid email address.');
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);

    try {
      const res = await fetchWithTimeout(
        `https://emailreputation.abstractapi.com/v1/?api_key=${ABSTRACT_API_KEY}&email=${encodeURIComponent(trimmed)}`,
        8000,
      );
      const data = await res.json().catch(() => ({}));
      const status = data?.email_deliverability?.status;

      // Only a definitive "undeliverable" blocks - and only once. The download must
      // never dead-end on a verification-service outage or an ambiguous response.
      if (status === 'undeliverable' && !allowBypass) {
        setVerificationError('That email looks undeliverable. Press "Authorize" again to continue anyway.');
        setAllowBypass(true);
        setIsVerifying(false);
        return;
      }
    } catch {
      // verification service unreachable - proceed regardless
    }

    setIsVerified(true);
    setIsVerifying(false);
  };

  const flushTable = (
    rows: string[][],
    key: string,
    isPdf: boolean,
  ): React.ReactNode | null => {
    const filtered = rows.filter(
      (row) => row.join('').trim() !== '' && !/^[|\s\-:]+$/.test(row.join('')),
    );
    if (filtered.length === 0) return null;
    const header = filtered[0];
    const body = filtered.slice(1);
    return (
      <div
        key={key}
        className={`overflow-x-auto my-6 rounded-xl border ${
          isPdf ? 'border-slate-300' : 'border-slate-700/50 bg-slate-900/20 shadow-inner'
        }`}
      >
        <table className="w-full text-left border-collapse min-w-[500px]">
          <thead>
            <tr className={isPdf ? 'bg-slate-100' : 'bg-slate-800/80'}>
              {header.map((h, j) => (
                <th
                  key={j}
                  className={`p-3 text-[9px] font-black uppercase tracking-wider border-b ${
                    isPdf ? 'text-slate-700 border-slate-300' : 'text-slate-400 border-slate-700/50'
                  }`}
                  dangerouslySetInnerHTML={{ __html: parseLine(h) }}
                />
              ))}
            </tr>
          </thead>
          <tbody className={isPdf ? '' : 'divide-y divide-slate-700/30'}>
            {body.map((row, j) => (
              <tr key={j} className={isPdf ? '' : 'hover:bg-slate-800/30 transition-colors'}>
                {row.map((c, k) => (
                  <td
                    key={k}
                    className={`p-3 text-xs border-b ${
                      isPdf ? 'text-slate-800 border-slate-200' : 'text-slate-300 border-transparent'
                    }`}
                    dangerouslySetInnerHTML={{ __html: parseLine(c) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderMarkdownToHtml = (lines: string[], isPdf = false): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    let table: string[][] = [];
    let inTable = false;

    lines.forEach((line, i) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('|')) {
        const cells = line
          .split('|')
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map((c) => c.trim());
        table = inTable ? [...table, cells] : [cells];
        inTable = true;
        return;
      }

      if (inTable) {
        const node = flushTable(table, `table-${i}`, isPdf);
        if (node) elements.push(node);
        table = [];
        inTable = false;
      }

      if (!trimmed) return;

      if (trimmed.startsWith('#')) {
        const level = trimmed.match(/^#+/)?.[0].length || 1;
        const text = trimmed.replace(/^#+/, '').trim();
        if (level === 1) {
          elements.push(
            <div key={`h-${i}`} className="flex items-center gap-3 mt-10 mb-6 group">
              <div className="h-6 w-1 rounded-full bg-blue-600" />
              <h2
                className={`text-lg md:text-xl font-black tracking-tight uppercase ${
                  isPdf ? 'text-blue-600' : 'text-white'
                }`}
                dangerouslySetInnerHTML={{ __html: parseLine(text) }}
              />
            </div>,
          );
        } else {
          elements.push(
            <h3
              key={`h-${i}`}
              className={`text-base font-bold mt-8 mb-4 uppercase tracking-wide ${
                isPdf ? 'text-blue-500' : 'text-blue-400'
              }`}
              dangerouslySetInnerHTML={{ __html: parseLine(text) }}
            />,
          );
        }
      } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        elements.push(
          <li
            key={`li-${i}`}
            className={`ml-6 mb-3 text-sm list-disc leading-relaxed ${
              isPdf ? 'text-slate-800 marker:text-blue-600' : 'text-slate-300 marker:text-blue-500'
            }`}
            dangerouslySetInnerHTML={{ __html: parseLine(trimmed.replace(/^[-*]\s?/, '')) }}
          />,
        );
      } else {
        elements.push(
          <p
            key={`p-${i}`}
            className={`mb-4 text-sm sm:text-base leading-relaxed font-medium ${
              isPdf ? 'text-slate-800' : 'text-slate-300'
            }`}
            dangerouslySetInnerHTML={{ __html: parseLine(trimmed) }}
          />,
        );
      }
    });

    if (inTable) {
      const node = flushTable(table, 'table-tail', isPdf);
      if (node) elements.push(node);
    }

    return elements;
  };

  const sectionData = getSectionContent(result.rawText);
  const parsedSections = Object.keys(sectionData).length > 0;

  let hostname = result.url;
  try {
    hostname = new URL(result.url).hostname.replace(/^www\./, '');
  } catch {
    hostname = result.url.replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '');
  }
  const dotIndex = hostname.indexOf('.');

  return (
    <div className="space-y-12 animate-fade-in-up">
      {/* Verification Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in no-pdf">
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] w-full max-w-md p-6 sm:p-10 shadow-2xl relative overflow-hidden">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="text-center space-y-5">
              <div className="w-16 h-16 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto">
                <Mail className="w-8 h-8 text-blue-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">Technical PDF Export</h3>
                <p className="text-slate-400 text-xs sm:text-sm">
                  Locked technical observations and forensic summaries are available in the PDF. Verify your email to
                  download.
                </p>
              </div>
              <form onSubmit={verifyEmail} className="space-y-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@business.com"
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                />
                {verificationError && (
                  <div className="text-red-400 text-[10px] font-bold flex items-center gap-2 animate-shake">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {verificationError}
                  </div>
                )}
                <button
                  disabled={isVerifying}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20 text-xs uppercase tracking-widest"
                >
                  {isVerifying ? <Loader2 className="w-5 h-5 animate-spin" /> : allowBypass ? 'Authorize Anyway' : 'Authorize & Download PDF'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Main UI Results Container */}
      <div className="bg-slate-800/40 border border-slate-700 p-6 sm:p-8 md:p-12 rounded-[1.5rem] sm:rounded-[2.5rem] shadow-2xl backdrop-blur-md relative overflow-hidden flex flex-col">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-700/50 mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-2.5 sm:p-3 rounded-2xl shadow-lg shadow-blue-600/20">
              <img
                src="https://i.ibb.co/fzbm79b7/Untitled-design-20260111-175353-0000.png"
                alt="CyberBunny Logo"
                className="w-6 h-6 sm:w-8 sm:h-8 object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[8px] sm:text-[10px] uppercase font-bold text-slate-500 tracking-[0.4em]">
                  Live Forensic Discovery
                </p>
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tighter truncate max-w-[200px] sm:max-w-none">
                {dotIndex === -1 ? (
                  hostname
                ) : (
                  <>
                    {hostname.slice(0, dotIndex)}
                    <span className="text-blue-500">{hostname.slice(dotIndex)}</span>
                  </>
                )}
              </h2>
            </div>
          </div>
          <button
            onClick={handleDownloadClick}
            className="flex items-center gap-3 px-6 sm:px-8 py-3 sm:py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl transition-all text-xs sm:text-sm font-black text-white shadow-xl shadow-blue-600/25 active:scale-95 group"
          >
            {isVerified ? 'Download PDF Report' : 'Unlock PDF Report'}{' '}
            <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
          </button>
        </div>

        <div className="relative prose prose-invert max-w-none">
          {!parsedSections && renderMarkdownToHtml(result.rawText.split('\n'), false)}

          {parsedSections &&
            Object.keys(sectionData)
              .map(Number)
              .sort((a, b) => a - b)
              .map((s) => (
                <div key={s} id={`forensic-sec-${s}`} className="scroll-mt-24">
                  {renderMarkdownToHtml(sectionData[s], false)}
                </div>
              ))}
        </div>
      </div>

      {/* Hidden Container for PDF Rendering */}
      <div
        ref={printRef}
        className="pdf-report-container"
        style={{
          position: 'fixed',
          left: '-10000px',
          top: '0',
          display: 'none',
          visibility: 'hidden',
          opacity: 0,
          zIndex: -1,
          width: '800px',
          backgroundColor: '#ffffff',
        }}
      >
        <div className="pdf-page">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '40px',
              borderBottom: '3px solid #2563eb',
              paddingBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <img src={PDF_LOGO} alt="" style={{ width: '50px', height: '50px' }} />
              <div>
                <h1 style={{ fontSize: '26px', margin: 0, color: '#2563eb', fontWeight: 900, letterSpacing: '-1px' }}>
                  CyberBunny Forensics
                </h1>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                  Technical Architecture Report: {hostname}
                </p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '10px', color: '#475569', fontWeight: 700 }}>
                Generated: {new Date().toLocaleDateString()}
              </p>
              <p style={{ margin: 0, fontSize: '10px', color: '#2563eb', fontWeight: 800 }}>
                ID: CB_FRN_SEC_{Math.floor(Math.random() * 90000) + 10000}
              </p>
            </div>
          </div>

          {parsedSections
            ? Object.keys(sectionData)
                .sort((a, b) => Number(a) - Number(b))
                .map((sectionNum) => (
                  <div key={sectionNum} style={{ marginBottom: '30px' }}>
                    {renderMarkdownToHtml(sectionData[Number(sectionNum)], true)}
                  </div>
                ))
            : renderMarkdownToHtml(result.rawText.split('\n'), true)}

          <div
            className="pdf-footer"
            style={{ borderTop: '1px solid #e2e8f0', marginTop: '50px', paddingTop: '20px', textAlign: 'center' }}
          >
            <p style={{ fontSize: '10px', color: '#475569', margin: '0 0 5px 0' }}>
              This technical discovery was synthesized using the CyberBunny Forensics Engine v3.0.
            </p>
            <p style={{ fontSize: '9px', color: '#94a3b8', margin: 0 }}>
              &copy; {new Date().getFullYear()} Rabbit Marketing House. Professional Technical Auditing Services.
            </p>
          </div>
        </div>
      </div>

      {/* Citations */}
      {result.sources.length > 0 && (
        <section className="bg-slate-900/60 border border-slate-800/50 p-6 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] backdrop-blur-sm no-pdf animate-fade-in">
          <div className="flex items-center gap-3 mb-8 text-slate-500">
            <Globe className="w-5 h-5" />
            <h3 className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em]">Validated Technical Sources</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.sources.map((source, idx) => (
              <a
                key={idx}
                href={source.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-4 p-4 bg-slate-800/30 hover:bg-slate-800/80 border border-slate-700/40 rounded-2xl transition-all group"
              >
                <div className="p-3 bg-slate-900/50 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner">
                  <Globe className="w-3.5 h-3.5" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-200 truncate group-hover:text-blue-400">
                    {source.title}
                  </p>
                  <p className="text-[9px] sm:text-[10px] text-slate-500 truncate font-mono tracking-tight opacity-70">
                    {source.uri}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
