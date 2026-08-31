import React, { useState, useRef, useEffect } from 'react';
import { AnalysisResult } from '../types';
import { Download, Globe, Lock, X, Mail, CheckCircle2, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface ResultsDisplayProps {
  result: AnalysisResult;
}

export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Auto-trigger download if verified and modal was open
  useEffect(() => {
    if (isVerified && isModalOpen) {
      generatePDF();
      setIsModalOpen(false);
    }
  }, [isVerified]);

  const handleDownloadClick = () => {
    if (isVerified) {
      generatePDF();
    } else {
      setIsModalOpen(true);
    }
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    
    try {
      const element = printRef.current;
      const domain = result.url.replace(/^https?:\/\//, '').replace(/[\/\?#]/g, '-');

      // Make it capture-able by removing display:none and visibility:hidden
      element.style.display = 'block';
      element.style.visibility = 'visible';
      element.style.opacity = '1';

      // We use a specific window width to ensure the layout matches our design for capture
      const canvas = await html2canvas(element, {
        scale: 2, // Retains high fidelity
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: 800,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'px',
        format: [800, (canvas.height * 800) / canvas.width],
        hotfixes: ["px_scaling"]
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`CyberBunny-Forensic-Report-${domain}.pdf`);

      // Hide again after capture
      element.style.display = 'none';
      element.style.visibility = 'hidden';
      element.style.opacity = '0';
    } catch (err) {
      console.error('PDF Generation failed:', err);
      alert('Forensic PDF synthesis failed. Please verify your connection and try again.');
    }
  };

  const verifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsVerifying(true);
    setVerificationError(null);

    try {
      // Abstract API Email Verification
      const response = await fetch(`https://emailreputation.abstractapi.com/v1/?api_key=58ca3227ac5441e6b489ba4605bdb2bc&email=${encodeURIComponent(email)}`);
      const data = await response.json();

      if (data.email_deliverability?.status === 'deliverable') {
        setIsVerified(true);
        // The useEffect will trigger generatePDF()
      } else {
        setVerificationError("The provided email is undeliverable or invalid.");
        setIsVerifying(false);
      }
    } catch (err) {
      setVerificationError("Verification service currently unavailable.");
      setIsVerifying(false);
    }
  };

  const getSectionContent = (text: string) => {
    const sections: Record<number, string[]> = {};
    const lines = text.split('\n');
    let currentSection = 0;

    lines.forEach(line => {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/^# (\d)\./);
      if (match) {
        currentSection = parseInt(match[1]);
        sections[currentSection] = [line];
      } else if (currentSection > 0) {
        sections[currentSection].push(line);
      }
    });
    return sections;
  };

  const parseLine = (line: string) => {
    return line
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong>$1</strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  };

  const renderMarkdownToHtml = (lines: string[], isPdf: boolean = false) => {
    const elements: React.ReactNode[] = [];
    let currentTable: string[][] = [];
    let inTable = false;

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('|')) {
        const cells = line.split('|').filter((_, index, array) => index > 0 && index < array.length - 1).map(c => c.trim());
        if (!inTable) {
          inTable = true;
          currentTable = [cells];
        } else {
          currentTable.push(cells);
        }
        return;
      } else {
        if (inTable) {
          const filteredRows = currentTable.filter(row => row.join('').trim() !== '' && !/^[|\s-:]+$/.test(row.join('')));
          if (filteredRows.length > 0) {
            const header = filteredRows[0];
            const body = filteredRows.slice(1);
            elements.push(
              <div key={`table-wrapper-${i}`} className={`overflow-x-auto my-6 rounded-xl border ${isPdf ? 'border-slate-300' : 'border-slate-700/50 bg-slate-900/20 shadow-inner'}`}>
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead>
                    <tr className={isPdf ? 'bg-slate-100' : 'bg-slate-800/80'}>
                      {header.map((h, j) => (
                        <th key={j} className={`p-3 text-[9px] font-black uppercase tracking-wider border-b ${isPdf ? 'text-slate-700 border-slate-300' : 'text-slate-400 border-slate-700/50'}`} dangerouslySetInnerHTML={{ __html: parseLine(h) }} />
                      ))}
                    </tr>
                  </thead>
                  <tbody className={isPdf ? '' : 'divide-y divide-slate-700/30'}>
                    {body.map((row, j) => (
                      <tr key={j} className={isPdf ? '' : 'hover:bg-slate-800/30 transition-colors'}>
                        {row.map((c, k) => (
                          <td key={k} className={`p-3 text-xs border-b ${isPdf ? 'text-slate-800 border-slate-200' : 'text-slate-300 border-transparent'}`} dangerouslySetInnerHTML={{ __html: parseLine(c) }} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          currentTable = [];
          inTable = false;
        }

        if (!trimmed) return;

        if (trimmed.startsWith('#')) {
          const level = trimmed.match(/^#+/)?.[0].length || 1;
          const text = trimmed.replace(/^#+/, '').trim();
          if (level === 1) {
            elements.push(
              <div key={`h-${i}`} className="flex items-center gap-3 mt-10 mb-6 group">
                <div className={`h-6 w-1 rounded-full bg-blue-600`}></div>
                <h2 className={`text-lg md:text-xl font-black tracking-tight uppercase ${isPdf ? 'text-blue-600' : 'text-white'}`} dangerouslySetInnerHTML={{ __html: parseLine(text) }} />
              </div>
            );
          } else {
            elements.push(<h3 key={`h-${i}`} className={`text-base font-bold mt-8 mb-4 uppercase tracking-wide ${isPdf ? 'text-blue-500' : 'text-blue-400'}`} dangerouslySetInnerHTML={{ __html: parseLine(text) }} />);
          }
        } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          elements.push(<li key={`li-${i}`} className={`ml-6 mb-3 text-sm list-disc leading-relaxed ${isPdf ? 'text-slate-800 marker:text-blue-600' : 'text-slate-300 marker:text-blue-500'}`} dangerouslySetInnerHTML={{ __html: parseLine(trimmed.replace(/^-|\*/, '').trim()) }} />);
        } else {
          elements.push(<p key={`p-${i}`} className={`mb-4 text-sm sm:text-base leading-relaxed font-medium ${isPdf ? 'text-slate-800' : 'text-slate-300'}`} dangerouslySetInnerHTML={{ __html: parseLine(trimmed) }} />);
        }
      }
    });

    return elements;
  };

  const sectionData = getSectionContent(result.rawText);
  const domain = result.url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const freeSections = [1, 2, 3, 4, 5, 6];
  const restrictedSections = [7, 8, 9];

  return (
    <div className="space-y-12 animate-fade-in-up">
      {/* Verification Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in no-pdf">
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] w-full max-w-md p-6 sm:p-10 shadow-2xl relative overflow-hidden">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="text-center space-y-5">
              <div className="w-16 h-16 bg-blue-600/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto">
                <Mail className="w-8 h-8 text-blue-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">Technical PDF Export</h3>
                <p className="text-slate-400 text-xs sm:text-sm">Locked technical observations and forensic summaries are available in the PDF. Verify your email to download.</p>
              </div>
              <form onSubmit={verifyEmail} className="space-y-4">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm" />
                {verificationError && <div className="text-red-400 text-[10px] font-bold flex items-center gap-2 animate-shake"><AlertCircle className="w-4 h-4" /> {verificationError}</div>}
                <button disabled={isVerifying} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-3 disabled:opacity-50 transition-all shadow-xl shadow-blue-600/20 text-xs uppercase tracking-widest">
                  {isVerifying ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Authorize & Download PDF'}
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
              <img src="https://i.ibb.co/fzbm79b7/Untitled-design-20260111-175353-0000.png" alt="CyberBunny Logo" className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <p className="text-[8px] sm:text-[10px] uppercase font-bold text-slate-500 tracking-[0.4em]">Live Forensic Discovery</p>
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tighter truncate max-w-[200px] sm:max-w-none">
                {domain.split('.')[0]}.<span className="text-blue-500">{domain.split('.').slice(1).join('.')}</span>
              </h2>
            </div>
          </div>
          <button onClick={handleDownloadClick} className="flex items-center gap-3 px-6 sm:px-8 py-3 sm:py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl transition-all text-xs sm:text-sm font-black text-white shadow-xl shadow-blue-600/25 active:scale-95 group">
            {isVerified ? 'Download PDF Report' : 'Unlock PDF Report'} <Download className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
          </button>
        </div>

        <div className="relative">
          {/* Visible Sections (1-6) */}
          <div className="prose prose-invert max-w-none mb-12">
            {freeSections.map(s => sectionData[s] ? renderMarkdownToHtml(sectionData[s], false) : null)}
          </div>

          {/* Locked Section Banner */}
          <div className="flex flex-col md:flex-row items-center gap-6 py-10 mb-8 border-y border-slate-700/50 bg-slate-900/40 -mx-6 px-6 sm:-mx-8 sm:px-8 md:-mx-12 md:px-12">
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-3xl">
              <ShieldAlert className="w-8 h-8 text-blue-500" />
            </div>
            <div className="flex-grow text-center md:text-left space-y-1">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-white">Forensic Insights Shielded</p>
              <p className="text-xs text-slate-500 font-medium max-w-lg leading-relaxed">
                Sections 7 through 9 contain deep architectural syntheses and security verdict narration. These are only available in the PDF document.
              </p>
            </div>
            <button onClick={handleDownloadClick} className="w-full md:w-auto px-8 py-4 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 hover:text-blue-300 transition-all rounded-2xl">
              Download PDF for Full Access
            </button>
          </div>

          {/* Locked Sections (7-9) - Always Blurred in UI as per request */}
          <div className="space-y-12">
            {restrictedSections.map(s => {
              if (!sectionData[s]) return null;
              const [heading, ...content] = sectionData[s];
              return (
                <div key={s} className="relative">
                  <div className="prose prose-invert max-w-none mb-4">
                    {renderMarkdownToHtml([heading], false)}
                  </div>
                  <div className="relative blur-[18px] select-none pointer-events-none opacity-10 scale-[0.98] max-h-48 overflow-hidden">
                    <div className="prose prose-invert max-w-none">
                      {renderMarkdownToHtml(content, false)}
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 top-12 flex items-center justify-center z-10">
                      <div className="bg-slate-900/60 p-6 rounded-3xl border border-slate-800 backdrop-blur-md flex flex-col items-center gap-3">
                        <Lock className="w-6 h-6 text-blue-500" />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Section Locked in Web UI</span>
                        <button onClick={handleDownloadClick} className="text-[8px] text-blue-400 hover:underline font-bold tracking-widest uppercase">Export to PDF to view</button>
                      </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hidden Container for PDF Rendering - rendered with standard styles */}
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
          backgroundColor: '#ffffff'
        }}
      >
        <div className="pdf-page">
          {/* PDF Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', borderBottom: '3px solid #2563eb', paddingBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
               <div style={{ backgroundColor: '#2563eb', padding: '10px', borderRadius: '15px' }}>
                  <img src="https://i.ibb.co/fzbm79b7/Untitled-design-20260111-175353-0000.png" alt="" style={{ width: '30px', height: '30px' }} />
               </div>
               <div>
                 <h1 style={{ fontSize: '26px', margin: 0, color: '#2563eb', fontWeight: 900, letterSpacing: '-1px' }}>CyberBunny Forensics</h1>
                 <p style={{ margin: 0, fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Technical Architecture Report: {domain}</p>
               </div>
            </div>
            <div style={{ textAlign: 'right' }}>
               <p style={{ margin: 0, fontSize: '10px', color: '#475569', fontWeight: 700 }}>Generated: {new Date().toLocaleDateString()}</p>
               <p style={{ margin: 0, fontSize: '10px', color: '#2563eb', fontWeight: 800 }}>ID: CB_FRN_SEC_{Math.floor(Math.random() * 90000) + 10000}</p>
            </div>
          </div>
          
          {/* Render EVERY section in PDF with no restrictions */}
          {Object.keys(sectionData).sort((a,b) => Number(a) - Number(b)).map(sectionNum => (
            <div key={sectionNum} style={{ marginBottom: '30px' }}>
              {renderMarkdownToHtml(sectionData[Number(sectionNum)], true)}
            </div>
          ))}
          
          {/* PDF Footer */}
          <div className="pdf-footer" style={{ borderTop: '1px solid #e2e8f0', marginTop: '50px', paddingTop: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: '#475569', margin: '0 0 5px 0' }}>This technical discovery was synthesized using the CyberBunny Forensics Engine v3.0.</p>
            <p style={{ fontSize: '9px', color: '#94a3b8', margin: 0 }}>© {new Date().getFullYear()} Rabbit Marketing House. Professional Technical Auditing Services.</p>
          </div>
        </div>
      </div>

      {/* Citations section (Visible in Web UI) */}
      {result.sources.length > 0 && (
        <section className="bg-slate-900/60 border border-slate-800/50 p-6 sm:p-8 rounded-[1.5rem] sm:rounded-[2rem] backdrop-blur-sm no-pdf animate-fade-in">
          <div className="flex items-center gap-3 mb-8 text-slate-500">
            <Globe className="w-5 h-5" />
            <h3 className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.2em]">Validated Technical Sources</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.sources.map((source, idx) => (
              <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer" className="flex items-start gap-4 p-4 bg-slate-800/30 hover:bg-slate-800/80 border border-slate-700/40 rounded-2xl transition-all group">
                <div className="p-3 bg-slate-900/50 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner"><Download className="w-3.5 h-3.5" /></div>
                <div className="overflow-hidden">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-200 truncate group-hover:text-blue-400">{source.title}</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-500 truncate font-mono tracking-tight opacity-70">{source.uri}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
