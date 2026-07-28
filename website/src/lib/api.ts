// Доступ к публичному API на этапе сборки (SSG). Лендинг запекает реальные
// данные из CRM: фронтматтер страниц зовёт эти функции во время `astro build`.
// База — `BUILD_API_URL` (на VPS backend опубликован на 127.0.0.1:3000 ДО
// сборки сайта; см. infra/deploy.sh). Сбой запроса роняет сборку сознательно —
// наружу уходит только успешно собранный сайт (решение №8 плана Вехи 4).
import {
  CONSTRUCTION_FORMAT_LABEL,
  CONSTRUCTION_LIGHTING_LABEL,
  CONSTRUCTION_SIDE_COUNT_LABEL,
  newsBodyToParagraphs,
  pricePerMonthLabel,
  resolveSiteSettings,
  SITE_SETTINGS_DEFAULTS,
  type Asset as ContractAsset,
  type Badge,
  type PublicConstruction as ContractConstruction,
  type ConstructionFormat,
  type Document as ContractDocument,
  type DocumentCategory as ContractDocumentCategory,
  type DocumentCategoryConstructions as ContractDocumentCategoryConstructions,
  type DocumentGroup as ContractDocumentGroup,
  type News as ContractNews,
  type ProgressAlbum as ContractProgressAlbum,
  type PublicSiteStats,
  type ResolvedSiteSettings,
} from "@noesis/contracts";
import { formatNewsDate } from "./format";

const API_BASE = (
  process.env.BUILD_API_URL ||
  process.env.PUBLIC_API_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

/** Единый визуал для публичных карточек: реальные фото конструкций не выводим в лендинге. */
export const CITY_FORMAT_IMAGE = "/assets/city-format-noesis-wide-v3.png";

// Ниже — псевдонимы контрактных типов, а не собственные объявления. Раньше
// лендинг описывал эти DTO руками и приводил ответы через `as T`, поэтому
// расхождение с бэкендом не ломало сборку, а отдавало пустой HTML. Одно такое
// расхождение уже было: `mimeType`/`size` у ассета документа считались
// необязательными, хотя контракт требует их всегда.

/** DTO ассета из публичного API. */
export type Asset = ContractAsset;

/**
 * Картинка для вывода. Лендинг подставляет вместо реальных фото единый
 * статичный визуал (CITY_FORMAT_IMAGE), у которого нет ни id, ни mimeType, ни
 * размера — то есть это не `Asset`. Отдельный узкий тип честнее, чем
 * притворяться ассетом: раньше это скрывалось приведением через `as`.
 */
export interface DisplayImage {
  url: string;
  renditions?: Asset["renditions"];
}

/** DTO конструкции из публичного API. */
export type Construction = ContractConstruction;

/** DTO новости из публичного API. */
export type News = ContractNews;

/** Документ (файл или ссылка) — для страницы материалов конструкции. */
export type Document = ContractDocument;

export type DocumentCategory = ContractDocumentCategory;
export type DocumentGroup = ContractDocumentGroup;
export type DocumentCategoryConstructions = ContractDocumentCategoryConstructions;

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
 * Маркер отката настроек сайта на дефолты. Ищется гейтом публикации в
 * build-website.sh: откат означает, что сайт уходит с зашитым телефоном,
 * почтой и БЕЗ счётчика Метрики — на глаз это не отличить от нормальной
 * сборки, поэтому публикацию прерываем.
 */
export const SITE_SETTINGS_FALLBACK_MARKER = "[site-settings] ОТКАТ НА ДЕФОЛТЫ";

/**
 * Настройки «обвязки» (Веха 4.3) на этапе сборки. В отличие от контента, сбой
 * НЕ роняет билд сам по себе — обвязка не должна мешать сборке: при
 * недоступности API берём дефолты (текущие тексты 1:1). `resolveSiteSettings`
 * мёржит ответ с дефолтами (устойчиво к частичному/старому формату).
 *
 * Результат кэшируется на весь процесс сборки. Функция зовётся из фронтматтера
 * каждой страницы и ещё раз на каждую конструкцию и новость: без кэша частичный
 * отказ API давал СМЕШАННЫЙ сайт, где часть страниц несёт контакты из CRM, а
 * часть — дефолтные. Один запрос на сборку означает один и тот же результат
 * везде.
 */
let siteSettingsPromise: Promise<ResolvedSiteSettings> | null = null;

export function fetchSiteSettings(): Promise<ResolvedSiteSettings> {
  siteSettingsPromise ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/public/site-settings`);
      if (!res.ok) throw new Error(`API /api/public/site-settings → ${res.status}`);
      return resolveSiteSettings((await res.json()) as Partial<ResolvedSiteSettings>);
    } catch (err) {
      // Не warn: гейт публикации ищет этот маркер, и он должен быть заметным.
      console.error(
        `${SITE_SETTINGS_FALLBACK_MARKER}: телефон, почта и счётчик Метрики будут не из CRM. Причина:`,
        err,
      );
      return SITE_SETTINGS_DEFAULTS;
    }
  })();
  return siteSettingsPromise;
}

export const fetchConstructions = () =>
  getJson<Construction[]>("/api/public/constructions");
export const fetchNews = () => getJson<News[]>("/api/public/news");
export const fetchDocumentCategories = () =>
  getJson<DocumentCategoryConstructions[]>("/api/public/documents");
export const fetchSiteStats = () => getJson<PublicSiteStats>("/api/public/site-stats");

export const fetchConstruction = (slug: string) =>
  getJsonOrNull<Construction>(`/api/public/constructions/${slug}`);
export const fetchNewsItem = (slug: string) =>
  getJsonOrNull<News>(`/api/public/news/${slug}`);

/** Документы конструкции по slug, сгруппированные по категориям (пусто, если их нет). */
export async function fetchConstructionDocuments(slug: string): Promise<DocumentGroup[]> {
  return (await getJsonOrNull<DocumentGroup[]>(`/api/public/documents/construction/${slug}`)) ?? [];
}

/** Альбом хода строительства (месяц → фото); альбомы без фото API не отдаёт. */
export type ProgressAlbum = ContractProgressAlbum;

/** Фотоотчёты конструкции по slug, от новых месяцев к старым (пусто, если нет). */
export async function fetchConstructionProgress(slug: string): Promise<ProgressAlbum[]> {
  return (await getJsonOrNull<ProgressAlbum[]>(`/api/public/progress/construction/${slug}`)) ?? [];
}

// --- View-модели: единый источник вычисляемых подписей для главной и страниц ---

/** Карточка конструкции на лендинге (готовые подписи для дизайна). */
export interface ConstructionView {
  id: string;
  slug: string;
  name: string;
  code: string;
  address: string;
  img: string;
  imgSrcset?: string;
  priceLabel: string;
  formatLabel: string;
  sizeLabel: string;
  sideLabel: string;
  lightingLabel: string;
  reachLabel: string;
  href: string;
  lat: number | null;
  lng: number | null;
  badges: { text: string; color: Badge["color"] }[];
}

export function toConstructionView(c: Construction): ConstructionView {
  const reachLabel =
    c.grp != null
      ? `GRP ${c.grp}`
      : c.trafficPerDay != null
        ? `${new Intl.NumberFormat("ru-RU").format(c.trafficPerDay)} чел./день`
        : "Охват по запросу";
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    code: c.code ?? "",
    address: c.address ?? "Грозный",
    img: CITY_FORMAT_IMAGE,
    priceLabel: c.priceLabel,
    formatLabel: CONSTRUCTION_FORMAT_LABEL[c.format],
    sizeLabel: c.size || "Размер по запросу",
    sideLabel: CONSTRUCTION_SIDE_COUNT_LABEL[c.sideCount],
    lightingLabel: CONSTRUCTION_LIGHTING_LABEL[c.lighting],
    reachLabel,
    href: `/constructions/${c.slug}`,
    lat: c.lat,
    lng: c.lng,
    badges: c.badges.map(({ text, color }) => ({ text, color })),
  };
}

/**
 * Позиция каталога для страницы `/catalog` (карта + фильтры + список). Богатые
 * поля для клиентской фильтрации (формат/цена/район) запекаются на сборке;
 * занятость на выбранный период дотягивается в браузере из публичного API
 * `/api/public/construction-availability` и мёржится по `id`.
 */
export interface CatalogItem {
  id: string;
  slug: string;
  name: string;
  code: string;
  address: string;
  district: string | null;
  lat: number | null;
  lng: number | null;
  format: ConstructionFormat;
  formatLabel: string;
  lighting: Construction["lighting"];
  sideCount: number;
  sideLabel: string;
  /** Числовая цена/мес для фильтра диапазона; `null` — «по запросу». */
  pricePerMonth: number | null;
  priceLabel: string;
  img: string;
  imgSrcset?: string;
  sizeLabel: string;
  lightingLabel: string;
  reachLabel: string;
  href: string;
  isSoon: boolean;
  badges: { text: string; color: Badge["color"] }[];
  sides: {
    id: string;
    code: string;
    effectivePricePerMonth: number | null;
    priceLabel: string;
    description: string | null;
    trafficPerDay: number | null;
    grp: number | null;
    photo?: DisplayImage;
  }[];
}

export function toCatalogItem(c: Construction): CatalogItem {
  const view = toConstructionView(c);
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    code: c.code ?? "",
    address: view.address,
    district: c.district,
    lat: c.lat,
    lng: c.lng,
    format: c.format,
    formatLabel: view.formatLabel,
    lighting: c.lighting,
    sideCount: c.sideCount,
    sideLabel: view.sideLabel,
    pricePerMonth: c.pricePerMonth,
    priceLabel: c.priceLabel,
    img: view.img,
    imgSrcset: view.imgSrcset,
    sizeLabel: view.sizeLabel,
    lightingLabel: view.lightingLabel,
    reachLabel: view.reachLabel,
    href: view.href,
    isSoon: c.badges.some((badge) => /скоро/i.test(badge.text)),
    badges: view.badges,
    sides: c.sides.map((s) => ({
      id: s.id,
      code: s.code,
      effectivePricePerMonth: s.effectivePricePerMonth,
      priceLabel: pricePerMonthLabel(s.effectivePricePerMonth),
      description: s.description,
      trafficPerDay: s.trafficPerDay,
      grp: s.grp,
      photo: { url: CITY_FORMAT_IMAGE },
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
    img: CITY_FORMAT_IMAGE,
    date: formatNewsDate(n.date),
    body: newsBodyToParagraphs(n.body),
    href: `/news/${n.slug}`,
  };
}

// --- Документы: ссылка и мелкая строка карточки (для страниц конструкций) ---

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
