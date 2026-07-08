// Доступ к публичному API на этапе сборки (SSG). Лендинг запекает реальные
// данные из CRM: фронтматтер страниц зовёт эти функции во время `astro build`.
// База — `BUILD_API_URL` (на VPS backend опубликован на 127.0.0.1:3000 ДО
// сборки сайта; см. infra/deploy.sh). Сбой запроса роняет сборку сознательно —
// наружу уходит только успешно собранный сайт (решение №8 плана Вехи 4).
import {
  BADGE_PALETTE,
  newsBodyToParagraphs,
  priceFromLabel,
  resolveSiteSettings,
  roomsToShortLabel,
  SITE_SETTINGS_DEFAULTS,
  type Badge,
  type PublicSiteStats,
  type ProjectTools,
  type ResolvedSiteSettings,
  type RoomFormat,
} from "@noesis/contracts";
import { formatNewsDate } from "./format";

const API_BASE = (
  process.env.BUILD_API_URL ||
  process.env.PUBLIC_API_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

/** Подмножество DTO ассета, нужное лендингу. */
export interface Asset {
  url: string;
  renditions?: { srcset: string; thumbnailUrl: string };
}

/** Подмножество DTO ЖК. */
export interface Project {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  priceFrom: number | null;
  rooms: RoomFormat[];
  description: string | null;
  cover?: Asset;
  comingSoon: boolean;
  badges: Badge[];
  /** Ссылки инструментов «Выбор квартиры» (null = инструмент выключен). */
  tools: ProjectTools;
}

/** Подмножество DTO новости. */
export interface News {
  id: string;
  slug: string;
  title: string;
  label?: { name: string; slug: string };
  date: string;
  excerpt: string | null;
  body: string;
  cover?: Asset;
}

/** Документ (файл или ссылка) — для страницы документов ЖК. */
export type Document =
  | { kind: "file"; id: string; name: string; asset: Asset & { mimeType?: string; size?: number } }
  | { kind: "link"; id: string; name: string; url: string; caption: string | null };

export interface DocumentCategory {
  id: string;
  name: string;
  slug: string;
}
export interface DocumentGroup {
  category: DocumentCategory;
  documents: Document[];
}
export interface DocumentCategoryProjects {
  category: DocumentCategory;
  projects: { id: string; slug: string; name: string; address: string | null; cover?: Asset }[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Тот же запрос, но 404 → null (страница по несуществующему slug). */
async function getJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Настройки «обвязки» (Веха 4.3) на этапе сборки. В отличие от контента, сбой
 * НЕ роняет билд — обвязка не должна мешать публикации: при недоступности API
 * берём дефолты (текущие тексты 1:1). `resolveSiteSettings` мёржит ответ с
 * дефолтами (устойчиво к частичному/старому формату).
 */
export async function fetchSiteSettings(): Promise<ResolvedSiteSettings> {
  try {
    const res = await fetch(`${API_BASE}/api/public/site-settings`);
    if (!res.ok) throw new Error(`API /api/public/site-settings → ${res.status}`);
    return resolveSiteSettings((await res.json()) as Partial<ResolvedSiteSettings>);
  } catch (err) {
    console.warn("[site-settings] недоступны, использую дефолты:", err);
    return SITE_SETTINGS_DEFAULTS;
  }
}

export const fetchProjects = () => getJson<Project[]>("/api/public/projects");
export const fetchNews = () => getJson<News[]>("/api/public/news");
export const fetchDocumentCategories = () =>
  getJson<DocumentCategoryProjects[]>("/api/public/documents");
export const fetchSiteStats = () => getJson<PublicSiteStats>("/api/public/site-stats");

export const fetchProject = (slug: string) =>
  getJsonOrNull<Project>(`/api/public/projects/${slug}`);
export const fetchNewsItem = (slug: string) =>
  getJsonOrNull<News>(`/api/public/news/${slug}`);

/** Документы ЖК по slug, сгруппированные по категориям (пусто, если их нет). */
export async function fetchProjectDocuments(slug: string): Promise<DocumentGroup[]> {
  return (await getJsonOrNull<DocumentGroup[]>(`/api/public/documents/project/${slug}`)) ?? [];
}

/** Альбом хода строительства (месяц → фото); альбомы без фото API не отдаёт. */
export interface ProgressAlbum {
  id: string;
  year: number;
  month: number;
  note: string | null;
  photos: Asset[];
}

/** Ход строительства ЖК по slug, от новых месяцев к старым (пусто, если нет). */
export async function fetchProjectProgress(slug: string): Promise<ProgressAlbum[]> {
  return (await getJsonOrNull<ProgressAlbum[]>(`/api/public/progress/project/${slug}`)) ?? [];
}

// --- View-модели: единый источник вычисляемых подписей для главной и страниц ---

/** Карточка ЖК на лендинге (готовые подписи 1:1 с дизайном). */
export interface ProjectView {
  slug: string;
  name: string;
  address: string;
  img: string;
  imgSrcset?: string;
  isSoon: boolean;
  priceLabel: string;
  /** Короткая комнатность для карточки (может быть пустой). */
  rooms: string;
  /** Комнатность для спецификации с запасным «Уточняйте». */
  roomsLabel: string;
  /** Ссылка на страницу ЖК; `null` для тизера «Скоро» (страницы нет). */
  href: string | null;
  /** Ссылки инструментов «Выбор квартиры» — для карточек главной и страницы ЖК. */
  tools: ProjectTools;
  badges: { text: string; color: Badge["color"]; bg: string; fg: string }[];
}

export function toProjectView(p: Project): ProjectView {
  const rooms = roomsToShortLabel(p.rooms);
  return {
    slug: p.slug,
    name: p.name,
    address: p.address ?? "",
    img: p.cover?.url ?? "",
    imgSrcset: p.cover?.renditions?.srcset,
    isSoon: p.comingSoon,
    priceLabel: p.comingSoon ? "Скоро на сайте" : priceFromLabel(p.priceFrom),
    rooms,
    roomsLabel: rooms || "Уточняйте",
    href: p.comingSoon ? null : `/zhk/${p.slug}`,
    tools: p.tools,
    badges: p.badges.map((b) => ({
      ...b,
      bg: BADGE_PALETTE[b.color].bg,
      fg: BADGE_PALETTE[b.color].fg,
    })),
  };
}

/** Карточка/наложение новости на лендинге. */
export interface NewsView {
  slug: string;
  tag: string;
  title: string;
  excerpt: string;
  img: string;
  imgSrcset?: string;
  date: string;
  body: string[];
  href: string;
}

export function toNewsView(n: News): NewsView {
  return {
    slug: n.slug,
    tag: n.label?.name ?? "",
    title: n.title,
    excerpt: n.excerpt ?? "",
    img: n.cover?.url ?? "",
    imgSrcset: n.cover?.renditions?.srcset,
    date: formatNewsDate(n.date),
    body: newsBodyToParagraphs(n.body),
    href: `/news/${n.slug}`,
  };
}

// --- Документы: ссылка и мелкая строка карточки (для страниц ЖК) ---

const DOC_TYPE_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
};

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${(kb < 10 ? kb.toFixed(1) : String(Math.round(kb))).replace(".", ",")} КБ`;
  const mb = kb / 1024;
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace(".", ",")} МБ`;
}

export function documentHref(doc: Document): string {
  return doc.kind === "link" ? doc.url : doc.asset.url;
}

export function documentMeta(doc: Document): string {
  if (doc.kind === "link") return doc.caption ?? "Внешняя ссылка";
  const type = (doc.asset.mimeType && DOC_TYPE_LABEL[doc.asset.mimeType]) || "Файл";
  return typeof doc.asset.size === "number"
    ? `${type} · ${fileSize(doc.asset.size)}`
    : type;
}
