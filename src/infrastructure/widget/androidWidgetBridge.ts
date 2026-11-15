import type { WidgetSnapshot } from '@/domain/planning';

export const WIDGET_SNAPSHOT_STORAGE_KEY = 'aurastudy.widget.snapshot.v1';

export interface AuraStudyAndroidBridgeInterface {
  updateWidgetSnapshot?: (snapshotJson: string) => void;
}

export interface CapacitorPreferencesPlugin {
  set?: (options: { key: string; value: string }) => Promise<void> | void;
}

export interface CapacitorGlobalInterface {
  Plugins?: {
    Preferences?: CapacitorPreferencesPlugin;
    SharedPreferences?: CapacitorPreferencesPlugin;
  };
}

declare global {
  interface Window {
    AuraStudyAndroidBridge?: AuraStudyAndroidBridgeInterface;
    Capacitor?: CapacitorGlobalInterface;
  }
}

export interface WidgetSyncResult {
  persistedToLocalStorage: boolean;
  bridgedToAndroid: boolean;
  bridgedToCapacitor: boolean;
}

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

export function readStoredWidgetSnapshot(): WidgetSnapshot | null {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as WidgetSnapshot;
  } catch {
    return null;
  }
}

/**
 * Persists the latest formal WidgetSnapshot JSON into localStorage for debugging/preview
 * and forwards it to the Android WebView / Capacitor bridge when running natively.
 */
export function syncWidgetSnapshot(snapshot: WidgetSnapshot): WidgetSyncResult {
  const serialized = JSON.stringify(snapshot);
  let persistedToLocalStorage = false;
  let bridgedToAndroid = false;
  let bridgedToCapacitor = false;

  const storage = getSafeLocalStorage();
  if (storage) {
    try {
      storage.setItem(WIDGET_SNAPSHOT_STORAGE_KEY, serialized);
      persistedToLocalStorage = true;
    } catch {
      persistedToLocalStorage = false;
    }
  }

  if (typeof window !== 'undefined') {
    const androidBridge = window.AuraStudyAndroidBridge;
    if (androidBridge && typeof androidBridge.updateWidgetSnapshot === 'function') {
      try {
        androidBridge.updateWidgetSnapshot(serialized);
        bridgedToAndroid = true;
      } catch {
        bridgedToAndroid = false;
      }
    }

    const capPrefs =
      window.Capacitor?.Plugins?.Preferences ??
      window.Capacitor?.Plugins?.SharedPreferences;
    if (capPrefs && typeof capPrefs.set === 'function') {
      try {
        const maybePromise = capPrefs.set({
          key: WIDGET_SNAPSHOT_STORAGE_KEY,
          value: serialized,
        });
        if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
          void (maybePromise as Promise<void>).catch(() => undefined);
        }
        bridgedToCapacitor = true;
      } catch {
        bridgedToCapacitor = false;
      }
    }
  }

  return {
    persistedToLocalStorage,
    bridgedToAndroid,
    bridgedToCapacitor,
  };
}
