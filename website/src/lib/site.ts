// Общие константы сайта для SEO (канонические URL, Open Graph, sitemap).
// Запасной origin — рабочий домен прода. Раньше здесь стоял IP, которого нет
// ни у одного сервера: при потере SITE_URL из окружения сборщика canonical, OG
// и sitemap уводили на мёртвый адрес, а INDEXABLE (голый хост) заодно закрывал
// сайт от индексации через robots.txt — и всё это молча проходило гейт
// публикации. Переопределяется `SITE_URL`.
export const SITE_URL = (
  process.env.SITE_URL || "https://noesis.catlg.ru"
).replace(/\/+$/, "");

/** Публичное написание бренда. Не зависит от исторических настроек лендинга. */
export const BRAND_NAME = "NOESIS |ad";

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
 * Можно ли индексировать сайт с таким origin. Вынесено из `INDEXABLE` отдельной
 * чистой функцией, чтобы правило можно было проверить тестом: регрессия здесь
 * закрывает от поиска весь сайт и никак не проявляется на глаз.
 */
export function isIndexableOrigin(siteUrl: string): boolean {
  try {
    return !isBareHost(new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Открываем сайт для индексации только когда `SITE_URL` указывает на настоящий
 * домен. Пока выдача идёт по голому IP — robots держим закрытым: индексировать
 * IP бессмысленно, а при запуске домена это дало бы дубли в индексе и возню с
 * редиректами. Переключение происходит само, как только в `.env` появится домен.
 */
export const INDEXABLE: boolean = isIndexableOrigin(SITE_URL);
