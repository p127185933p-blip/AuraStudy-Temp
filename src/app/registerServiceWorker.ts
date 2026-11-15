export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const swUrl = `${baseUrl}sw.js`;

  const register = () => {
    void navigator.serviceWorker.register(swUrl, { scope: baseUrl }).catch(() => {
      // Ignore registration failure in restricted iframe or unsupported dev environments
    });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
