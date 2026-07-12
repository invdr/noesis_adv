let loader: Promise<unknown> | null = null;

export class MapUnavailableError extends Error {}

export function loadYandexMaps(apiKey: string): Promise<unknown> {
  const current = (window as typeof window & { ymaps?: unknown }).ymaps;
  if (current) return Promise.resolve(current);
  if (!apiKey) return Promise.reject(new MapUnavailableError("Ключ Яндекс.Карт не задан"));
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-yandex-maps="true"]');
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new MapUnavailableError("Карта загружается слишком долго")), 15_000);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      const ymaps = (window as typeof window & { ymaps?: unknown }).ymaps;
      if (ymaps) resolve(ymaps);
      else reject(new MapUnavailableError("API карты не инициализирован"));
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new MapUnavailableError("Не удалось загрузить Яндекс.Карту"));
    }, { once: true });
    if (!existing) {
      script.dataset.yandexMaps = "true";
      script.async = true;
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
      document.head.appendChild(script);
    }
  });
  return loader;
}

export function waitYMapsReady(ymaps: unknown): Promise<void> {
  return new Promise((resolve) => {
    (ymaps as { ready: (callback: () => void) => void }).ready(resolve);
  });
}
