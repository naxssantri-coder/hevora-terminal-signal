import React from 'react';
import { ErrorState } from './ui';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Remounts the boundary when it changes (pass the active route) so navigating away recovers. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-module error boundary. A module that throws must not take the whole terminal down with it
 * - the ticker, nav and every other module keep working while the failed one shows an error
 * state with a retry.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[HEVORA] module crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="Module failed to render"
          detail={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
