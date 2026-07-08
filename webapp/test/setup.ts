import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";

/**
 * Преднастройка фронт-тестов (bun test):
 *  - гасим импорты *.css в компонентах (в тестах стили не нужны);
 *  - поднимаем DOM (window/document/...) через happy-dom, чтобы рендерить React.
 */
plugin({
  name: "ignore-css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
});

GlobalRegistrator.register();
