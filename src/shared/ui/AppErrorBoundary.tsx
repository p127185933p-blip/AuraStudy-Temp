import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

function sanitizeDisplayErrorMessage(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{12,}/g, '[REDACTED]')
    .replace(/sk-(?:proj-)?[0-9A-Za-z_-]{12,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [REDACTED]');
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const rawMessage =
      error instanceof Error
        ? error.message
        : '發生未預期的介面顯示錯誤。';
    return {
      hasError: true,
      errorMessage: sanitizeDisplayErrorMessage(rawMessage),
    };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Intentionally avoid logging sensitive user/key context
  }

  private handleReload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleResetBoundary = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        data-testid="app-error-boundary"
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg-canvas)] p-4 text-[var(--color-text-primary)]"
      >
        <div className="w-full max-w-md rounded-[var(--radius-xl)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] p-6 shadow-[var(--shadow-elevated)]">
          <div className="flex items-center gap-2.5 text-[var(--color-proposal-delete-text)]">
            <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden="true" />
            <h1 className="text-[length:var(--text-lg)] font-bold">
              AuraStudy 介面發生異常
            </h1>
          </div>

          <p className="mt-3 text-[length:var(--text-sm)] leading-relaxed text-[var(--color-text-secondary)]">
            系統攔截到未預期的渲染錯誤，您的行程資料並未遭到破壞。請嘗試重新整理頁面以恢復使用。
          </p>

          {this.state.errorMessage && (
            <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--color-text-secondary)] break-words">
              {this.state.errorMessage}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent-primary)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-primary-hover)]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>重新整理頁面</span>
            </button>

            <button
              type="button"
              onClick={this.handleResetBoundary}
              className="min-h-[44px] rounded-[var(--radius-md)] border-[length:var(--border-width-card)] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 text-[length:var(--text-sm)] font-bold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
            >
              嘗試返回畫面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
