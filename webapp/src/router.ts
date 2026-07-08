import { useSyncExternalStore } from "react";

/**
 * Лёгкий hash-роутер CRM. URL всегда `/crm/`, раздел и открытая заявка живут в
 * `location.hash` (`#/<view>`, `#/leads/<id>`). Ноль зависимостей, nginx не
 * трогаем: hash не уходит на сервер. Валидацию `view` (известность/права) делает
 * `App` — здесь только парсинг и навигация.
 */
export interface HashRoute {
  /** Раздел из первого сегмента хэша; пустая строка — дефолтный маршрут (`#/`). */
  view: string;
  /** id заявки для маршрута `#/leads/<id>`. */
  leadId?: string;
  /** id контакта для маршрута `#/contacts/<id>`. */
  contactId?: string;
}

/** Парсит строку хэша в маршрут. Чистая функция — покрыта юнит-тестом. */
export function parseHash(hash: string): HashRoute {
  const segments = hash.replace(/^#/, "").split("/").filter(Boolean);
  if (segments.length === 0) return { view: "" };
  const [view, param] = segments;
  if (view === "leads" && param) {
    return { view: "leads", leadId: decodeURIComponent(param) };
  }
  if (view === "contacts" && param) {
    return { view: "contacts", contactId: decodeURIComponent(param) };
  }
  return { view: view! };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Подписка на `location.hash`; ре-рендерит потребителя при навигации. */
export function useHashRoute(): HashRoute {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  return parseHash(hash);
}

/**
 * Навигация сменой хэша. Принимает путь (`/leads/42`) или готовый хэш
 * (`#/leads/42`). Если целевой хэш уже активен — ничего не делает (без лишней
 * записи в history).
 */
export function navigate(to: string): void {
  const normalized = to.startsWith("#")
    ? to
    : `#${to.startsWith("/") ? to : `/${to}`}`;
  if (window.location.hash === normalized) return;
  window.location.hash = normalized;
}
