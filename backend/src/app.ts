import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Runtime } from "./runtime";
import type { AppEnv } from "./http/context";
import { onError } from "./http/errors";
import { authRoutes } from "./auth/auth-routes";
import { userRoutes } from "./users/user-routes";
import { leadRoutes } from "./leads/lead-routes";
import { contactRoutes } from "./contacts/contact-routes";
import { contactTypeRoutes } from "./contact-types/contact-type-routes";
import { sourceRoutes } from "./sources/source-routes";
import { analyticsRoutes } from "./analytics/analytics-routes";
import { inventoryAnalyticsRoutes } from "./inventory-analytics/inventory-analytics-routes";
import { partnerAnalyticsRoutes } from "./partner-analytics/partner-analytics-routes";
import { stageRoutes } from "./stages/stage-routes";
import { funnelRoutes } from "./funnels/funnel-routes";
import { fileRoutes } from "./files/file-routes";
import { developerRoutes } from "./developers/developer-routes";
import { constructionRoutes } from "./constructions/construction-routes";
import { publicConstructionAvailabilityRoutes } from "./constructions/construction-availability-routes";
import { publicConstructionRoutes } from "./constructions/construction-public-routes";
import { bookingRoutes } from "./bookings/booking-routes";
import { bookingBrandRoutes } from "./bookings/booking-brand-routes";
import { bookingServiceReasonRoutes } from "./bookings/booking-service-reason-routes";
import { newsLabelRoutes } from "./news/news-label-routes";
import { newsRoutes } from "./news/news-routes";
import { publicNewsRoutes } from "./news/news-public-routes";
import { documentCategoryRoutes } from "./documents/document-category-routes";
import { documentRoutes } from "./documents/document-routes";
import { publicDocumentRoutes } from "./documents/document-public-routes";
import { progressRoutes } from "./progress/progress-routes";
import { publicProgressRoutes } from "./progress/progress-public-routes";
import { siteBuildRoutes } from "./site-build/site-build-routes";
import { siteBuildInternalRoutes } from "./site-build/site-build-internal-routes";
import { siteSettingsRoutes } from "./site-settings/site-settings-routes";
import { publicSiteSettingsRoutes } from "./site-settings/site-settings-public-routes";
import { publicSiteStatsRoutes } from "./site-stats/site-stats-public-routes";
import { rebuildOnMutation } from "./http/rebuild";

/** Собирает Hono-приложение со всеми роутами и middleware. */
export function createApp(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: rt.env.CORS_ORIGINS,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      // Сессия живёт в httpOnly-cookie — фронту нужно слать credentials.
      credentials: true,
    }),
  );

  // Анти-CSRF: для мутирующих запросов требуем доверенный Origin. Дополняет
  // SameSite=Strict у сессионной cookie. Браузер всегда шлёт Origin на
  // не-GET fetch; запросы без него (или с чужим) к данным не допускаем.
  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }
    // Внутренние ручки сборщика (server-to-server) защищены токеном, не Origin.
    if (c.req.path.startsWith("/api/internal/")) {
      return next();
    }
    const origin = c.req.header("Origin");
    if (!origin || !rt.env.CORS_ORIGINS.includes(origin)) {
      return c.json(
        { error: { code: "forbidden_origin", message: "Недопустимый источник запроса" } },
        403,
      );
    }
    return next();
  });

  // После успешной мутации публичного контента — флажок пересборки лендинга.
  app.use("*", rebuildOnMutation(rt));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/api/auth", authRoutes(rt));
  app.route("/api/users", userRoutes(rt));
  app.route("/api/stages", stageRoutes(rt));
  app.route("/api/funnels", funnelRoutes(rt));
  app.route("/api/leads", leadRoutes(rt));
  app.route("/api/contacts", contactRoutes(rt));
  app.route("/api/contact-types", contactTypeRoutes(rt));
  app.route("/api/sources", sourceRoutes(rt));
  app.route("/api/analytics", analyticsRoutes(rt));
  app.route("/api/inventory-analytics", inventoryAnalyticsRoutes(rt));
  app.route("/api/partner-analytics", partnerAnalyticsRoutes(rt));
  app.route("/api/files", fileRoutes(rt));
  app.route("/api/developers", developerRoutes(rt));
  app.route("/api/bookings", bookingRoutes(rt));
  app.route("/api/booking-brands", bookingBrandRoutes(rt));
  app.route("/api/booking-service-reasons", bookingServiceReasonRoutes(rt));
  // Документы и фотоотчёты по конструкции — отдельные роутеры на том же
  // префиксе; `:constructionId` в их путях, паттерны не пересекаются с `/:id`.
  app.route("/api/constructions", documentRoutes(rt));
  app.route("/api/constructions", progressRoutes(rt));
  app.route("/api/constructions", constructionRoutes(rt));
  app.route("/api/document-categories", documentCategoryRoutes(rt));
  app.route("/api/news-labels", newsLabelRoutes(rt));
  app.route("/api/news", newsRoutes(rt));
  app.route("/api/public/construction-availability", publicConstructionAvailabilityRoutes(rt));
  app.route("/api/public/constructions", publicConstructionRoutes(rt));
  app.route("/api/public/news", publicNewsRoutes(rt));
  app.route("/api/public/documents", publicDocumentRoutes(rt));
  app.route("/api/public/progress", publicProgressRoutes(rt));
  app.route("/api/public/site-settings", publicSiteSettingsRoutes(rt));
  app.route("/api/public/site-stats", publicSiteStatsRoutes(rt));
  app.route("/api/site-settings", siteSettingsRoutes(rt));
  app.route("/api/site-build", siteBuildRoutes(rt));
  app.route("/api/internal/site-build", siteBuildInternalRoutes(rt));

  app.onError(onError);
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Не найдено" } }, 404),
  );

  return app;
}
