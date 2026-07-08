// Общие константы сайта для SEO (канонические URL, Open Graph, sitemap).
// Сайт пока открыт по голому IP — это и есть рабочий origin для абсолютных
// ссылок. Домен в текстах (Политика ПДн) — `noesis-grozny.ru`, но canonical/OG
// должны указывать на реальный адрес выдачи. Переопределяется `SITE_URL`.
export const SITE_URL = (
  process.env.SITE_URL || "http://168.222.140.78"
).replace(/\/+$/, "");

// Название, телефон, email и адрес теперь живут в настройках сайта (Веха 4.3,
// packages/contracts/src/site-settings.ts) — здесь дублировать их не нужно.

/** Абсолютный URL из пути/относительной ссылки (для canonical, OG, sitemap). */
export function absUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Хост — голый IP или localhost (значит, домена ещё нет). */
function isBareHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost";
}

/**
 * Открываем сайт для индексации только когда `SITE_URL` указывает на настоящий
 * домен. Пока выдача идёт по голому IP — robots держим закрытым: индексировать
 * IP бессмысленно, а при запуске домена это дало бы дубли в индексе и возню с
 * редиректами. Переключение происходит само, как только в `.env` появится домен.
 */
export const INDEXABLE: boolean = (() => {
  try {
    return !isBareHost(new URL(SITE_URL).hostname);
  } catch {
    return false;
  }
})();
