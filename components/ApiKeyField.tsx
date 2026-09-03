import React, { useState } from 'react';
import { KeyRound, Check, X, ExternalLink } from 'lucide-react';
import { API_KEY_STORAGE, getApiKey } from '../services/analyzer';

/** True when the key comes from the build (env var), not from localStorage. */
const buildKeyPresent = (): boolean => {
  try {
    if (localStorage.getItem(API_KEY_STORAGE)) return false;
  } catch {
    /* ignore */
  }
  return getApiKey() !== '';
};

const storedKeyPresent = (): boolean => {
  try {
    return !!localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return false;
  }
};

interface ApiKeyFieldProps {
  onChange?: () => void;
}

export const ApiKeyField: React.FC<ApiKeyFieldProps> = ({ onChange }) => {
  const [fromBuild] = useState(buildKeyPresent);
  const [hasStored, setHasStored] = useState(storedKeyPresent);
  const [open, setOpen] = useState(() => !buildKeyPresent() && !storedKeyPresent());
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);

  // A key baked in at build time - nothing for the user to do.
  if (fromBuild && !open) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500">
        <Check className="w-3.5 h-3.5 text-emerald-500" />
        OpenRouter API key loaded from environment.
      </p>
    );
  }

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(API_KEY_STORAGE, trimmed);
      setHasStored(true);
      setSaved(true);
      setValue('');
      setOpen(false);
      onChange?.();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* storage blocked - nothing we can do */
    }
  };

  const clear = () => {
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      /* ignore */
    }
    setHasStored(false);
    setOpen(true);
    onChange?.();
  };

  if (!open) {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-500">
        <Check className="w-3.5 h-3.5 text-emerald-500" />
        {saved ? 'API key saved to this browser.' : 'Using API key saved in this browser.'}
        <button
          onClick={() => setOpen(true)}
          className="underline decoration-slate-600 hover:text-slate-300"
        >
          change
        </button>
        {hasStored && (
          <button
            onClick={clear}
            className="underline decoration-slate-600 hover:text-red-400"
          >
            remove
          </button>
        )}
      </p>
    );
  }

  return (
    <div className="mt-5 p-4 sm:p-5 bg-slate-900/70 border border-slate-700 rounded-2xl space-y-3">
      <div className="flex items-center gap-2 text-slate-300">
        <KeyRound className="w-4 h-4 text-blue-400" />
        <span className="text-[11px] font-black uppercase tracking-widest">OpenRouter API Key</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        No key was configured for this site. Paste an OpenRouter key to run an analysis - it is
        stored only in this browser (localStorage) and sent directly to openrouter.ai.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="sk-or-v1-..."
          autoComplete="off"
          spellCheck={false}
          className="flex-grow bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 text-sm font-mono placeholder-slate-600 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <button
          onClick={save}
          disabled={!value.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
        >
          Save
        </button>
        {(hasStored || fromBuild) && (
          <button
            onClick={() => setOpen(false)}
            className="p-3 text-slate-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <a
        href="https://openrouter.ai/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300"
      >
        Get a free key <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
};
