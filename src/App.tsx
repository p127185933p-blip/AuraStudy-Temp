import { MotionConfig } from 'framer-motion';
import { AppShell, CalendarProvider } from '@/app';
import { GlobalTouchAura } from '@/components/ui/GlobalTouchAura';
import { TimelinePage } from '@/pages';
import { AppErrorBoundary } from '@/shared/ui';

const isTestEnv = import.meta.env.MODE === 'test';

export default function App() {
  return (
    <MotionConfig reducedMotion={isTestEnv ? 'always' : 'user'}>
      <GlobalTouchAura />
      <AppErrorBoundary>
        <CalendarProvider>
          <AppShell>
            <TimelinePage />
          </AppShell>
        </CalendarProvider>
      </AppErrorBoundary>
    </MotionConfig>
  );
}
