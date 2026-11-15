import { Capacitor, type PermissionState } from '@capacitor/core';
import {
  LocalNotifications,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications';
import {
  computeUpcomingScheduleNotifications,
  type ScheduledNotificationEvent,
} from '@/domain/planning';
import type { CalendarItem } from '@/domain/schedule';

export const NOTIFICATIONS_ENABLED_STORAGE_KEY = 'aurastudy.notifications.enabled.v1';
export const NOTIFICATIONS_SENT_STORAGE_KEY = 'aurastudy.notifications.sent.v1';
export const NOTIFICATION_ICON_PATH = './pwa-192x192.png';
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'aurastudy_reminders';

const MAX_TIMEOUT_MS = 2_147_483_647;
const RECALIBRATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SENT_RECORD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const END_EVENT_GRACE_WINDOW_MS = 60 * 1000;
const MAX_NATIVE_SCHEDULED_NOTIFICATIONS = 100;

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isNativeCapacitorPlatform(): boolean {
  try {
    return (
      typeof Capacitor !== 'undefined' &&
      typeof Capacitor.isNativePlatform === 'function' &&
      Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
}

function mapCapacitorPermission(
  state: PermissionState | undefined,
): NotificationPermission {
  if (state === 'granted') {
    return 'granted';
  }
  if (state === 'denied') {
    return 'denied';
  }
  return 'default';
}

export function getNotificationsEnabled(): boolean {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(NOTIFICATIONS_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export function isNotificationSupported(): boolean {
  if (isNativeCapacitorPlatform()) {
    return true;
  }
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    window.Notification !== undefined
  );
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (isNativeCapacitorPlatform()) {
    return 'default';
  }
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    window.Notification === undefined
  ) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function checkNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (isNativeCapacitorPlatform()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      return mapCapacitorPermission(status?.display);
    } catch {
      return 'denied';
    }
  }
  return getNotificationPermission();
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  if (isNativeCapacitorPlatform()) {
    try {
      const current = await LocalNotifications.checkPermissions();
      if (current?.display === 'granted') {
        return 'granted';
      }
      const requested = await LocalNotifications.requestPermissions();
      return mapCapacitorPermission(requested?.display);
    } catch {
      return await checkNotificationPermission();
    }
  }

  try {
    return await window.Notification.requestPermission();
  } catch {
    return getNotificationPermission();
  }
}

export function toAndroidNotificationId(dedupeKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dedupeKey.length; i += 1) {
    hash ^= dedupeKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive31Bit = hash & 0x7fffffff;
  return positive31Bit === 0 ? 1 : positive31Bit;
}

function allocateUniqueNotificationId(dedupeKey: string, usedIds: Set<number>): number {
  let id = toAndroidNotificationId(dedupeKey);
  while (usedIds.has(id)) {
    id = id >= 0x7fffffff ? 1 : id + 1;
  }
  usedIds.add(id);
  return id;
}

export function buildNativeLocalNotifications(
  items: readonly CalendarItem[],
  timeZone: string,
  options: {
    nowMs?: number;
    channelId?: string;
    isExactNotification?: boolean;
  } = {},
): LocalNotificationSchema[] {
  const nowMs = options.nowMs ?? Date.now();
  const events = computeUpcomingScheduleNotifications(items, {
    now: new Date(nowMs),
    timeZone,
    endGraceWindowMs: 0,
  });

  const futureEvents = events
    .filter((event) => event.triggerAtMs > nowMs)
    .slice(0, MAX_NATIVE_SCHEDULED_NOTIFICATIONS);

  const usedIds = new Set<number>();

  return futureEvents.map((event) => ({
    id: allocateUniqueNotificationId(event.dedupeKey, usedIds),
    title: event.title,
    body: event.body,
    schedule: {
      at: new Date(event.triggerAtMs),
      allowWhileIdle: true,
    },
    ...(options.isExactNotification !== undefined
      ? { isExactNotification: options.isExactNotification }
      : {}),
    ...(options.channelId ? { channelId: options.channelId } : {}),
    extra: {
      source: 'aurastudy',
      dedupeKey: event.dedupeKey,
      scheduleId: event.scheduleId,
      type: event.type,
    },
  }));
}

async function clearPendingAuraStudyNotifications(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const toCancel = (pending?.notifications ?? [])
      .filter(
        (item) =>
          item?.extra?.source === 'aurastudy' || item?.extra?.source === undefined,
      )
      .map((item) => ({ id: item.id }));

    if (toCancel.length > 0) {
      await LocalNotifications.cancel({ notifications: toCancel });
    }
  } catch {
    // ignore native plugin errors during cleanup
  }
}

async function ensureNativeNotificationChannel(): Promise<string | undefined> {
  if (typeof LocalNotifications.createChannel !== 'function') {
    return undefined;
  }
  try {
    await LocalNotifications.createChannel({
      id: ANDROID_NOTIFICATION_CHANNEL_ID,
      name: 'AuraStudy 行程提醒',
      description: '行程開始前 20 分鐘與結束接續提醒',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    return ANDROID_NOTIFICATION_CHANNEL_ID;
  } catch {
    return undefined;
  }
}

async function resolveNativeExactAlarmSetting(): Promise<boolean | undefined> {
  if (typeof LocalNotifications.checkExactNotificationSetting !== 'function') {
    return undefined;
  }
  try {
    const status = await LocalNotifications.checkExactNotificationSetting();
    return status?.exact_alarm === 'granted';
  } catch {
    return false;
  }
}

export async function syncNativeScheduleNotifications(
  items: readonly CalendarItem[],
  timeZone: string,
  enabled: boolean,
  options: { nowMs?: number } = {},
): Promise<LocalNotificationSchema[]> {
  if (!isNativeCapacitorPlatform()) {
    return [];
  }

  await clearPendingAuraStudyNotifications();

  if (!enabled) {
    return [];
  }

  const permission = await checkNotificationPermission();
  if (permission !== 'granted') {
    return [];
  }

  const [channelId, isExactNotification] = await Promise.all([
    ensureNativeNotificationChannel(),
    resolveNativeExactAlarmSetting(),
  ]);

  const notifications = buildNativeLocalNotifications(items, timeZone, {
    nowMs: options.nowMs ?? Date.now(),
    channelId,
    isExactNotification,
  });

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }

  return notifications;
}

export function readSentNotificationMap(nowMs = Date.now()): Record<string, number> {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(NOTIFICATIONS_SENT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const cutoff = nowMs - SENT_RECORD_RETENTION_MS;
    const pruned: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= cutoff) {
        pruned[key] = value;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

export function markNotificationSent(dedupeKey: string, sentAtMs = Date.now()): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    const current = readSentNotificationMap(sentAtMs);
    current[dedupeKey] = sentAtMs;
    storage.setItem(NOTIFICATIONS_SENT_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore storage errors
  }
}

export function hasNotificationBeenSent(dedupeKey: string, nowMs = Date.now()): boolean {
  const sentMap = readSentNotificationMap(nowMs);
  return typeof sentMap[dedupeKey] === 'number';
}

export async function dispatchScheduleNotification(
  event: ScheduledNotificationEvent,
): Promise<boolean> {
  if (isNativeCapacitorPlatform()) {
    return false;
  }

  if (!isNotificationSupported() || getNotificationPermission() !== 'granted') {
    return false;
  }

  const nowMs = Date.now();
  if (hasNotificationBeenSent(event.dedupeKey, nowMs)) {
    return false;
  }

  markNotificationSent(event.dedupeKey, nowMs);

  const notificationOptions: NotificationOptions = {
    body: event.body,
    icon: NOTIFICATION_ICON_PATH,
    tag: event.dedupeKey,
  };

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const existingReg = await navigator.serviceWorker.getRegistration();
      if (existingReg && typeof existingReg.showNotification === 'function') {
        await existingReg.showNotification(event.title, notificationOptions);
        return true;
      }
      if (navigator.serviceWorker.controller && navigator.serviceWorker.ready) {
        const readyReg = await navigator.serviceWorker.ready;
        if (readyReg && typeof readyReg.showNotification === 'function') {
          await readyReg.showNotification(event.title, notificationOptions);
          return true;
        }
      }
    }
  } catch {
    // Fallback to window.Notification
  }

  try {
    new window.Notification(event.title, notificationOptions);
    return true;
  } catch {
    return false;
  }
}

export class ScheduleNotificationScheduler {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private latestItems: readonly CalendarItem[] = [];
  private latestTimeZone = 'UTC';
  private latestEnabled = false;
  private visibilityListenerAttached = false;
  private nativeSyncSeq = 0;
  private nativeSyncQueue: Promise<void> = Promise.resolve();

  private readonly handleVisibilityChange = () => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      this.latestEnabled
    ) {
      this.rescheduleWeb();
    }
  };

  sync(items: readonly CalendarItem[], timeZone: string, enabled: boolean): Promise<void> {
    this.latestItems = items;
    this.latestTimeZone = timeZone;
    this.latestEnabled = enabled;

    if (isNativeCapacitorPlatform()) {
      this.clearTimers();
      this.detachVisibilityListener();

      const syncSeq = ++this.nativeSyncSeq;
      const snapshotItems = items;
      const snapshotTimeZone = timeZone;
      const snapshotEnabled = enabled;

      this.nativeSyncQueue = this.nativeSyncQueue
        .catch(() => undefined)
        .then(async () => {
          if (syncSeq !== this.nativeSyncSeq) {
            return;
          }
          try {
            await syncNativeScheduleNotifications(
              snapshotItems,
              snapshotTimeZone,
              snapshotEnabled,
            );
          } catch {
            // keep scheduler resilient against native bridge errors
          }
        });

      return this.nativeSyncQueue;
    }

    if (enabled) {
      this.attachVisibilityListener();
    } else {
      this.detachVisibilityListener();
    }

    this.rescheduleWeb();
    return Promise.resolve();
  }

  private rescheduleWeb(): void {
    this.clearTimers();

    if (!this.latestEnabled) {
      return;
    }
    if (!isNotificationSupported() || getNotificationPermission() !== 'granted') {
      return;
    }

    const nowMs = Date.now();
    const sentMap = readSentNotificationMap(nowMs);
    const events = computeUpcomingScheduleNotifications(this.latestItems, {
      now: new Date(nowMs),
      timeZone: this.latestTimeZone,
      endGraceWindowMs: END_EVENT_GRACE_WINDOW_MS,
    });

    let hasDeferredLongTimer = false;

    for (const event of events) {
      if (typeof sentMap[event.dedupeKey] === 'number') {
        continue;
      }

      const delayMs = event.triggerAtMs - nowMs;
      if (delayMs <= 0) {
        void dispatchScheduleNotification(event);
        continue;
      }

      if (delayMs > MAX_TIMEOUT_MS) {
        hasDeferredLongTimer = true;
        continue;
      }

      const handle = setTimeout(() => {
        this.timers.delete(handle);
        if (this.latestEnabled) {
          void dispatchScheduleNotification(event);
        }
      }, delayMs);
      this.timers.add(handle);
    }

    if (hasDeferredLongTimer) {
      const recalibrateHandle = setTimeout(() => {
        this.timers.delete(recalibrateHandle);
        if (this.latestEnabled) {
          this.rescheduleWeb();
        }
      }, RECALIBRATE_INTERVAL_MS);
      this.timers.add(recalibrateHandle);
    }
  }

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached || typeof document === 'undefined') {
      return;
    }
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityListenerAttached = true;
  }

  private detachVisibilityListener(): void {
    if (!this.visibilityListenerAttached || typeof document === 'undefined') {
      return;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.visibilityListenerAttached = false;
  }

  private clearTimers(): void {
    for (const handle of this.timers) {
      clearTimeout(handle);
    }
    this.timers.clear();
  }

  dispose(): void {
    this.nativeSyncSeq += 1;
    this.clearTimers();
    this.detachVisibilityListener();
  }
}
