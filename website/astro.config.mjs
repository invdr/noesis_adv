import { defineConfig } from "astro/config";

// Лендинг — статическая SSG-сборка. Дизайн перенесён 1:1 из исходного
// прототипа: разметка в src/pages/index.astro, стили/скрипты/ассеты — в public/.
// `site` — рабочий origin для canonical/OG/sitemap (на сборке задаётся SITE_URL,
// см. infra/deploy.sh); по умолчанию — текущий адрес выдачи по голому IP.
export default defineConfig({
  site: process.env.SITE_URL || "https://noesis.catlg.ru",
  output: "static",
  server: {
    port: 4321,
  },
});
