import type { ReactNode } from 'react';
import { AmbientAuroraBackdrop } from '@/components/ui/LiquidGlass';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="relative min-h-screen text-[var(--color-text-primary)] flex flex-col">
      <AmbientAuroraBackdrop />

      <header className="glass-layer-2 sticky top-0 z-[var(--z-timeline-header)] border-x-0 border-t-0">
        <div className="mx-auto flex w-full max-w-[var(--container-max-width)] items-center justify-between px-[var(--space-page-x)] py-3">
          <span className="text-[length:var(--text-lg)] font-bold tracking-tight text-[var(--color-text-primary)] whitespace-nowrap shrink-0">
            AuraStudy
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[var(--container-max-width)] flex-1 px-[var(--space-page-x)] py-[var(--space-page-y)]">
        {children}
      </main>
    </div>
  );
}
