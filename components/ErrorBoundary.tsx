import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops a render-time throw (e.g. malformed AI markdown) from white-screening the
 * whole app. Shows a dismissible inline panel instead.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('CyberBunny UI error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-xl mx-auto my-12 p-6 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-300 text-sm">
          <p className="font-black uppercase tracking-[0.2em] text-[10px] mb-2">
            {this.props.fallbackLabel || 'Rendering error'}
          </p>
          <p className="font-medium break-words">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
