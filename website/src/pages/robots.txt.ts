// robots.txt — открываем индексацию только на настоящем домене (см. INDEXABLE).
// Пока выдача по голому IP — Disallow, чтобы не сорить IP-страницами в индексе.
import type { APIRoute } from "astro";
import { absUrl, INDEXABLE } from "../lib/site";

export const GET: APIRoute = () => {
  const body = INDEXABLE
    ? `User-agent: *\nAllow: /\n\nSitemap: ${absUrl("/sitemap.xml")}\n`
    : `User-agent: *\nDisallow: /\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
