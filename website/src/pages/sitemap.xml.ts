// sitemap.xml — формируется на сборке из реальных маршрутов (главная, новости,
// политика + страницы published конструкций и новостей). Абсолютные URL — через SITE_URL.
import type { APIRoute } from "astro";
import { fetchConstructions, fetchNews } from "../lib/api";
import { absUrl } from "../lib/site";

/** Дата для <lastmod> в формате YYYY-MM-DD; null, если дата невалидна. */
function lastmod(value: string): string | null {
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

export const GET: APIRoute = async () => {
  const [constructions, news] = await Promise.all([fetchConstructions(), fetchNews()]);
  // У конструкций публичной даты изменения нет — lastmod ставим только новостям (где
  // контент и обновляется); по спецификации sitemap lastmod опционален поурочно.
  const urls: { loc: string; lastmod?: string | null }[] = [
    { loc: "/" },
    { loc: "/news" },
    { loc: "/privacy" },
    ...constructions.map((p) => ({ loc: `/constructions/${p.slug}` })),
    ...news.map((n) => ({ loc: `/news/${n.slug}`, lastmod: lastmod(n.date) })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) =>
        u.lastmod
          ? `  <url><loc>${absUrl(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`
          : `  <url><loc>${absUrl(u.loc)}</loc></url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
