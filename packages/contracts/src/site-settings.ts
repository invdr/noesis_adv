import { z } from "zod";
import { normalizeRuPhone, phoneSchema } from "./lead";

/**
 * Редактируемая «обвзяка» лендинга из CRM (Веха 4.3): навигация, контакты,
 * реквизиты, подписи кнопок/секций, параметры блока новостей, видимость/порядок
 * конструкций на главной, ID Яндекс.Метрики.
 *
 * Модель — singleton, admin-only, блокировка по версии (`expectedUpdatedAt`),
 * любая правка ставит флажок пересборки (как контент в 4.2).
 *
 * Принцип: настройки — это **разреженные переопределения поверх дефолтов в
 * коде** (`SITE_SETTINGS_DEFAULTS`, текущие тексты сайта 1:1). Пустое поле = «брать
 * дефолт». Так пустая база не превращает сайт в набор пустых кнопок, а добавить
 * новый слот в будущем безопасно (старые базы возьмут дефолт).
 */

/** Лимиты длины подписей под макет 1:1 (символы). Общие для Zod и формы CRM. */
export const SITE_SETTINGS_LIMITS = {
  navItem: 22,
  eyebrow: 40,
  title: 60,
  heroLine: 40,
  heroSub: 220,
  cta: 28,
  siteName: 60,
  address: 140,
  workHours: 80,
  footerBrand: 260,
  copyright: 140,
  slogan: 80,
  contactLabel: 28,
  contactValue: 200,
  metrika: 12,
} as const;

const L = SITE_SETTINGS_LIMITS;

/** Строка с обрезкой пробелов и лимитом длины. */
const t = (max: number) => z.string().trim().max(max, `Не длиннее ${max} символов`);

/** Тип второго (опционального) контакта — кнопка, заменяющая «Написать на почту». */
export const secondaryContactKindSchema = z.enum([
  "email",
  "whatsapp",
  "telegram",
  "phone",
  "link",
]);
export type SecondaryContactKind = z.infer<typeof secondaryContactKindSchema>;

/** Сколько новостей показывать в блоке на главной (под сетку 3-в-ряд). */
export const newsHomeCountSchema = z.union([z.literal(3), z.literal(6)]);

/**
 * Все редактируемые поля (плоская структура — простой merge/strip и форма). Все
 * опциональны: присутствие = переопределение дефолта. Хранится в `SiteSettings.data`.
 */
export const siteSettingsBaseSchema = z.object({
  // Бренд / реквизиты
  siteName: t(L.siteName).optional(),
  // Навигация (только подписи; якоря #catalog и т.п. не редактируются)
  navCatalog: t(L.navItem).optional(),
  navFlats: t(L.navItem).optional(),
  navAbout: t(L.navItem).optional(),
  navDocs: t(L.navItem).optional(),
  navContacts: t(L.navItem).optional(),
  ctaSelectFlat: t(L.cta).optional(),
  // Hero (заголовок — две строки, чтобы сохранить акцент-стиль 1:1)
  heroEyebrow: t(L.eyebrow).optional(),
  heroTitleLine1: t(L.heroLine).optional(),
  heroTitleLine2: t(L.heroLine).optional(),
  heroSubtitle: t(L.heroSub).optional(),
  heroCtaPrimary: t(L.cta).optional(),
  heroCtaSecondary: t(L.cta).optional(),
  // Секции (надзаголовок + заголовок)
  catalogEyebrow: t(L.eyebrow).optional(),
  catalogTitle: t(L.title).optional(),
  flatsEyebrow: t(L.eyebrow).optional(),
  flatsTitle: t(L.title).optional(),
  flatsCta: t(L.cta).optional(),
  newsEyebrow: t(L.eyebrow).optional(),
  newsTitle: t(L.title).optional(),
  newsAllCta: t(L.cta).optional(),
  docsEyebrow: t(L.eyebrow).optional(),
  docsTitle: t(L.title).optional(),
  aboutEyebrow: t(L.eyebrow).optional(),
  contactsEyebrow: t(L.eyebrow).optional(),
  contactsTitle: t(L.title).optional(),
  contactsLeaveCta: t(L.cta).optional(),
  ctaOrderCall: t(L.cta).optional(),
  // Контакты / реквизиты
  phonePrimary: phoneSchema.optional(),
  email: z.string().trim().max(254).email("Некорректный e-mail").optional(),
  address: t(L.address).optional(),
  workHoursWeekday: t(L.workHours).optional(),
  workHoursSaturday: t(L.workHours).optional(),
  footerBrand: t(L.footerBrand).optional(),
  copyright: t(L.copyright).optional(),
  slogan: t(L.slogan).optional(),
  // Второй контакт (перенастройка кнопки «Написать на почту»)
  secondaryContactKind: secondaryContactKindSchema.optional(),
  secondaryContactValue: t(L.contactValue).optional(),
  secondaryContactLabel: t(L.contactLabel).optional(),
  // Блок новостей
  newsHomeCount: newsHomeCountSchema.optional(),
  // Конструкции на главной: порядок (id по очереди) и скрытые (id). Скрытая
  // конструкция уходит из каталога, карты и блока «Документы» на главной.
  homepageOrder: z.array(z.string()).max(200).optional(),
  homepageHidden: z.array(z.string()).max(200).optional(),
  // Яндекс.Метрика: только цифры; пусто = счётчик не грузится.
  metrikaCounterId: z
    .string()
    .trim()
    .regex(/^\d{0,12}$/, "Только цифры")
    .optional(),
});
export type SiteSettingsOverrides = z.infer<typeof siteSettingsBaseSchema>;

/** Доп-проверка второго контакта: для не-email типов значение обязательно и валидно. */
function refineSecondaryContact(
  v: { secondaryContactKind?: SecondaryContactKind; secondaryContactValue?: string },
  ctx: z.RefinementCtx,
): void {
  const kind = v.secondaryContactKind;
  const value = v.secondaryContactValue?.trim();
  if (!kind || kind === "email") return; // email берёт адрес из настройки `email`
  if (!value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondaryContactValue"],
      message: "Укажите номер или ссылку для второго контакта",
    });
    return;
  }
  if (kind === "link" && !/^https?:\/\//i.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondaryContactValue"],
      message: "Ссылка должна начинаться с http:// или https://",
    });
  }
  // То же правило РФ-номера, что у заявок/контактов (normalizeRuPhone), а не
  // отдельный ослабленный критерий «≥10 цифр».
  if ((kind === "whatsapp" || kind === "phone") && normalizeRuPhone(value) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secondaryContactValue"],
      message: "Введите номер телефона полностью",
    });
  }
}

/**
 * Убирает поля с пустой строкой (после trim) — «очистить = вернуть дефолт». Так
 * `.email()`/`phoneSchema` и пр. не падают на очищенных полях, а в БД хранится
 * только реально изменённое (разреженные переопределения).
 */
function stripEmptyStrings(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

/** Тело PUT /api/site-settings: переопределения + метка версии для блокировки. */
export const updateSiteSettingsSchema = z.preprocess(
  stripEmptyStrings,
  siteSettingsBaseSchema
    .extend({
      /** Метка версии (`updatedAt`), на которой открыли форму — для блокировки. */
      expectedUpdatedAt: z.string().optional(),
    })
    .superRefine(refineSecondaryContact),
);
export type UpdateSiteSettingsInput = z.infer<typeof updateSiteSettingsSchema>;

/** Полный набор значений (дефолты + переопределения) — то, что потребляет лендинг. */
export type ResolvedSiteSettings = Required<SiteSettingsOverrides>;

/** Дефолты = текущие тексты сайта 1:1. Единственный источник правды по умолчанию. */
export const SITE_SETTINGS_DEFAULTS: ResolvedSiteSettings = {
  siteName: "Noesis",
  navCatalog: "Каталог",
  navFlats: "Карта",
  navAbout: "О нас",
  navDocs: "Материалы",
  navContacts: "Контакты",
  ctaSelectFlat: "Выбрать конструкцию",
  heroEyebrow: "Наружная реклама в Грозном",
  heroTitleLine1: "Займите нужную",
  heroTitleLine2: "точку города",
  heroSubtitle:
    "Выберите рекламные конструкции на карте, сравните стороны и проверьте доступность на нужные даты. NOESIS |ad собирает запрос в одну подборку — условия подтверждает менеджер.",
  heroCtaPrimary: "Открыть карту",
  heroCtaSecondary: "Смотреть каталог",
  catalogEyebrow: "Каталог и география",
  catalogTitle: "Локации и условия размещения",
  flatsEyebrow: "География",
  flatsTitle: "Карта конструкций",
  flatsCta: "К каталогу",
  newsEyebrow: "Кейсы и новости",
  newsTitle: "Город, кампании и практика размещения",
  newsAllCta: "Все материалы",
  docsEyebrow: "Материалы",
  docsTitle: "Файлы для планирования и производства",
  aboutEyebrow: "Почему NOESIS",
  contactsEyebrow: "Связаться напрямую",
  contactsTitle: "Соберём медиаплан по вашему запросу",
  contactsLeaveCta: "Оставить заявку",
  ctaOrderCall: "Заказать звонок",
  phonePrimary: "+79280009300",
  email: "info@noesis-grozny.ru",
  address: "г. Грозный, ул. Лорсанова, 8а",
  workHoursWeekday: "Пн-Пт: 9:00-18:00 (перерыв 13:00-14:00)",
  workHoursSaturday: "Сб: 9:00-14:00",
  footerBrand:
    "Рекламная компания: каталог городских конструкций, подбор локаций и сопровождение размещения в Грозном.",
  copyright: "© Noesis. Не является публичной офертой",
  slogan: "Наружная реклама в Грозном",
  secondaryContactKind: "email",
  secondaryContactValue: "",
  secondaryContactLabel: "",
  newsHomeCount: 3,
  homepageOrder: [],
  homepageHidden: [],
  metrikaCounterId: "",
};

/**
 * Дефолты + переопределения → полный набор. Пустые строки/`undefined` игнорируются
 * (берётся дефолт). Массивы/число берутся как есть.
 */
export function resolveSiteSettings(
  overrides: Partial<SiteSettingsOverrides> | null | undefined,
): ResolvedSiteSettings {
  const out: ResolvedSiteSettings = { ...SITE_SETTINGS_DEFAULTS };
  if (!overrides) return out;
  for (const key of Object.keys(SITE_SETTINGS_DEFAULTS) as (keyof ResolvedSiteSettings)[]) {
    const v = overrides[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** `+7XXXXXXXXXX` → `+7 (XXX) XXX-XX-XX` для показа. Иначе — как есть. */
export function formatPhoneRu(normalized: string): string {
  const d = normalized.replace(/\D/g, "");
  const x = d.length === 11 ? d.slice(1) : d;
  if (x.length !== 10) return normalized;
  return `+7 (${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6, 8)}-${x.slice(8, 10)}`;
}

/** Телефон → `tel:`-ссылка (только цифры и плюс). */
export function phoneHref(normalized: string): string {
  return `tel:${normalized.replace(/[^\d+]/g, "")}`;
}

/** Выведенный второй контакт: ссылка + подпись по типу (с учётом override-подписи). */
export function deriveSecondaryContact(s: ResolvedSiteSettings): {
  kind: SecondaryContactKind;
  href: string;
  label: string;
} {
  const kind = s.secondaryContactKind;
  const value = s.secondaryContactValue.trim();
  const custom = s.secondaryContactLabel.trim();
  switch (kind) {
    case "whatsapp": {
      const digits = value.replace(/\D/g, "");
      return { kind, href: `https://wa.me/${digits}`, label: custom || "Написать в WhatsApp" };
    }
    case "telegram": {
      const handle = value
        .replace(/^@/, "")
        .replace(/^https?:\/\/t\.me\//i, "")
        .replace(/^t\.me\//i, "");
      return { kind, href: `https://t.me/${handle}`, label: custom || "Написать в Telegram" };
    }
    case "phone":
      return { kind, href: phoneHref(value), label: custom || "Позвонить" };
    case "link":
      return { kind, href: value, label: custom || "Подробнее" };
    case "email":
    default:
      return {
        kind: "email",
        href: `mailto:${value || s.email}`,
        label: custom || "Написать на почту",
      };
  }
}

/**
 * Каталог конструкций на главной с учётом настроек: скрытые убраны, перечисленные в
 * `homepageOrder` — первыми в заданном порядке, остальные — в исходном порядке
 * (публичный API отдаёт от новых к старым). «Мёртвые» id игнорируются.
 */
export function orderHomepageConstructions<T extends { id: string }>(
  constructions: T[],
  order: string[],
  hidden: string[],
): T[] {
  const hiddenSet = new Set(hidden);
  const visible = constructions.filter((p) => !hiddenSet.has(p.id));
  const listedIds = new Set(order);
  const byId = new Map(visible.map((p) => [p.id, p]));
  const listed = order.map((id) => byId.get(id)).filter((p): p is T => p !== undefined);
  const rest = visible.filter((p) => !listedIds.has(p.id));
  return [...listed, ...rest];
}

/** @deprecated Используйте orderHomepageConstructions. */
export const orderHomepageProjects = orderHomepageConstructions;
