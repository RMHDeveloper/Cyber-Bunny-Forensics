
import React, { useState } from 'react';
import { Globe, ArrowRight } from 'lucide-react';

interface AnalysisFormProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
}

export const AnalysisForm: React.FC<AnalysisFormProps> = ({ onAnalyze, isLoading }) => {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    // Basic URL cleanup
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    onAnalyze(formattedUrl);
  };

  return (
    <form onSubmit={handleSubmit} className="relative group">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-grow">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Globe className="h-5 w-5 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
          </div>
          <input
            type="text"
            className="block w-full pl-11 pr-4 py-4 bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            placeholder="enter website (e.g., example.com)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-8 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-600/20"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
              Analyzing...
            </span>
          ) : (
            <>
              Inspect <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
      <p className="mt-4 text-center md:text-left text-xs text-slate-500">
        Enter a domain name or full URL to start the technical discovery.
      </p>
    </form>
  );
};
