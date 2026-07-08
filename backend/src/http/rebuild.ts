import type { MiddlewareHandler } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "./context";
import { markContentChanged } from "../site-build/site-build-service";

/**
 * Префиксы роутов, мутации которых меняют публичный контент лендинга и требуют
 * пересборки. `/api/projects` покрывает и документы по ЖК (тот же префикс).
 * Публичные `/api/public/*` сюда не входят (только GET).
 */
const CONTENT_PREFIXES = [
  "/api/projects",
  "/api/developers",
  "/api/news",
  "/api/news-labels",
  "/api/document-categories",
  "/api/site-settings",
];

function isContentPath(path: string): boolean {
  return CONTENT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * После УСПЕШНОЙ мутации публичного контента помечает черновые правки лендинга.
 * Пересборка больше не стартует автоматически: админ публикует накопленные
 * изменения отдельной кнопкой. Одно глобальное middleware вместо правки каждого
 * сервиса — нельзя пропустить точку вызова. GET/HEAD/OPTIONS и неуспешные ответы
 * игнорируются; `markContentChanged` глотает ошибки, но мы его ждём, чтобы CRM
 * сразу видела состояние «есть неопубликованные изменения».
 */
export function rebuildOnMutation(rt: Runtime): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (!isContentPath(c.req.path)) return;
    if (c.res.status >= 200 && c.res.status < 300) {
      await markContentChanged(rt);
    }
  };
}
