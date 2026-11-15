import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createDeadline, createSchedule } from '@/application/commands';
import {
  exportUserBackup,
  importUserBackup,
} from '@/application/services';
import { InMemoryCalendarRepository } from '@/infrastructure/repositories';
import { AppErrorBoundary } from '@/shared/ui';

function CrashingComponent(): never {
  throw new Error('模擬意外渲染崩潰');
}

describe('Phase 5 Backup Service, AppErrorBoundary & PWA Assets', () => {
  it('exports versioned JSON and strictly rejects malformed or schema-violating backups', async () => {
    const repo = new InMemoryCalendarRepository();
    await createDeadline(repo, {
      userId: 'user-source',
      title: '網路安全報告',
      dueDate: '2026-11-20',
      now: '2026-11-13T08:00:00Z',
    });
    await createSchedule(repo, {
      userId: 'user-source',
      title: '作業系統複習',
      startAt: '2026-11-14T09:00:00+08:00',
      endAt: '2026-11-14T11:00:00+08:00',
      now: '2026-11-13T08:05:00Z',
    });

    const backup = await exportUserBackup(
      repo,
      'user-source',
      '2026-11-13T09:00:00Z',
    );
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe('2026-11-13T09:00:00Z');
    expect(backup.items).toHaveLength(2);

    const targetRepo = new InMemoryCalendarRepository();

    // Reject invalid Schedule (endAt <= startAt) in backup without partial writes
    const invalidBackup = {
      version: 1,
      exportedAt: '2026-11-13T09:00:00Z',
      items: [
        backup.items[0],
        {
          id: 'bad-sc',
          userId: 'user-source',
          type: 'schedule',
          title: '錯誤區間',
          startAt: '2026-11-14T12:00:00+08:00',
          endAt: '2026-11-14T10:00:00+08:00',
          revision: 1,
          createdAt: '2026-11-13T08:00:00Z',
          updatedAt: '2026-11-13T08:00:00Z',
        },
      ],
    };

    const rejected = await importUserBackup(
      targetRepo,
      'user-target',
      JSON.stringify(invalidBackup),
    );
    expect(rejected.ok).toBe(false);
    expect(await targetRepo.listByUser('user-target')).toHaveLength(0);

    // Valid import assigns target userId and clean initial revision: 1
    const restored = await importUserBackup(
      targetRepo,
      'user-target',
      JSON.stringify(backup),
    );
    expect(restored.ok).toBe(true);
    const targetItems = await targetRepo.listByUser('user-target');
    expect(targetItems).toHaveLength(2);
    expect(targetItems.every((i) => i.userId === 'user-target')).toBe(true);
    expect(targetItems.every((i) => i.revision === 1)).toBe(true);
  });

  it('catches unexpected render errors in AppErrorBoundary and renders recovery actions', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReload = vi.fn();

    try {
      render(
        <AppErrorBoundary onReload={onReload}>
          <CrashingComponent />
        </AppErrorBoundary>,
      );

      expect(screen.getByTestId('app-error-boundary')).toBeInTheDocument();
      expect(screen.getByText('AuraStudy 介面發生異常')).toBeInTheDocument();
      expect(screen.getByText('模擬意外渲染崩潰')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '重新整理頁面' }));
      expect(onReload).toHaveBeenCalledTimes(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('redacts sensitive API keys and Bearer tokens inside AppErrorBoundary display', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leakedGemini = 'AIzaSySecretKeyLeakTest123456';
    const leakedBearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';

    function SecretCrash(): never {
      throw new Error(`Crash ${leakedGemini} ${leakedBearer}`);
    }

    try {
      render(
        <AppErrorBoundary>
          <SecretCrash />
        </AppErrorBoundary>,
      );

      const boundary = screen.getByTestId('app-error-boundary');
      expect(boundary).not.toHaveTextContent(leakedGemini);
      expect(boundary).not.toHaveTextContent('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(boundary).toHaveTextContent('[REDACTED]');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('ships compliant PWA manifest, SVG/PNG icons, and App-Shell-only Service Worker', () => {
    const rootDir = path.resolve(process.cwd());
    const manifestPath = path.join(rootDir, 'public', 'manifest.webmanifest');
    const swPath = path.join(rootDir, 'public', 'sw.js');
    const iconSvgPath = path.join(rootDir, 'public', 'icon.svg');

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(swPath)).toBe(true);
    expect(fs.existsSync(iconSvgPath)).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'public', 'pwa-192x192.png'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, 'public', 'pwa-512x512.png'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      id: string;
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string }>;
    };
    expect(manifest.id).toBe('./');
    expect(manifest.name).toBe('AuraStudy');
    expect(manifest.short_name).toBe('AuraStudy');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons.every((icon) => icon.src.startsWith('./'))).toBe(true);

    const swCode = fs.readFileSync(swPath, 'utf-8');
    expect(swCode).toContain('aurastudy-shell-v2');
    expect(swCode).toContain('requestUrl.origin !== self.location.origin');
    expect(swCode).toContain("'/auth/'");
    expect(swCode).toContain("'/api/'");
  });
});
