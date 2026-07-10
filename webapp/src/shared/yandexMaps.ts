/**
 * Ленивая загрузка Yandex Maps JS API (2.1) для CRM. Один и тот же ключ, что у
 * публичного сайта; грузим скрипт один раз (синглтон-промис) и переиспользуем.
 * `ymaps` не типизирован — работаем через `any` в точке использования.
 */
let loader: Promise<any> | null = null;

export function loadYandexMaps(apiKey: string): Promise<any> {
  const w = window as unknown as { ymaps?: any };
  if (w.ymaps && typeof w.ymaps.ready === "function") return Promise.resolve(w.ymaps);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => resolve((window as unknown as { ymaps: any }).ymaps);
    script.onerror = () => {
      loader = null; // дать шанс повторной попытке
      reject(new Error("Не удалось загрузить Яндекс.Карты"));
    };
    document.head.appendChild(script);
  });
  return loader;
}
