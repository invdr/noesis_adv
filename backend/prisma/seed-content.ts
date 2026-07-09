// Сид публичного контента лендинга: владельцы сети, рекламные конструкции,
// новости и категории документов. Идемпотентно: проверяем существование по slug,
// повторный запуск ничего не дублирует. Пишем НАПРЯМУЮ через Prisma, чтобы сид
// оставался быстрым и не зависел от multipart-форм CRM.
//
// Фото скачиваются со старого облака в наше хранилище через `storeUpload`
// (оригинал + WebP-производные). Дедуп по URL — одни и те же снимки
// переиспользуются в карточках конструкций и в новостях. Сбой загрузки логируется и не
// роняет сид (карточка просто останется без обложки).
import {
  slugify,
  type ConstructionFormat,
  type ConstructionLighting,
  type ConstructionSideCount,
} from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import { storeUpload } from "../src/files/file-service";

/**
 * База старого облака, откуда переносим фото в наше хранилище. Переопределяется
 * через `SEED_CDN_BASE` (например, локальное зеркало, если бакет недоступен).
 */
const CDN =
  process.env.SEED_CDN_BASE ??
  "https://crm-uploads.storage.yandexcloud.net/291/images/";

/** Владелец сети: имя задаёт slug и порядок. */
interface DeveloperSeed {
  name: string;
  order: number;
}

const DEVELOPERS: DeveloperSeed[] = [
  { name: "Noesis Outdoor", order: 1 },
  { name: "Городская сеть", order: 2 },
  { name: "Партнёрские конструкции", order: 3 },
];

/** Конструкции каталога. `owner` — имя владельца сети из `DEVELOPERS`. */
interface ConstructionSeed {
  name: string;
  code: string;
  owner: string;
  address: string;
  district: string;
  lat: number;
  lng: number;
  format: ConstructionFormat;
  size: string;
  sideCount: ConstructionSideCount;
  lighting: ConstructionLighting;
  grp: number | null;
  trafficPerDay: number | null;
  pricePerMonth: number | null;
  description: string;
  image: string;
}

const CONSTRUCTIONS: ConstructionSeed[] = [
  {
    name: "Сити-формат — проспект Путина",
    code: "СФ-001",
    owner: "Noesis Outdoor",
    address: "г. Грозный, проспект В. В. Путина",
    district: "Центр",
    lat: 43.3174,
    lng: 45.6948,
    format: "cityFormat",
    size: "1,2 × 1,8 м",
    sideCount: 2,
    lighting: "internal",
    grp: 2.8,
    trafficPerDay: 38_000,
    pricePerMonth: 45_000,
    description: "Центральная пешеходная и автомобильная локация для кампаний с высокой частотой контакта.",
    image: "image_67f78a99726f2.webp",
  },
  {
    name: "Сити-формат — площадь Минутка",
    code: "СФ-014",
    owner: "Noesis Outdoor",
    address: "г. Грозный, площадь Минутка",
    district: "Минутка",
    lat: 43.3119,
    lng: 45.7126,
    format: "cityFormat",
    size: "1,2 × 1,8 м",
    sideCount: 2,
    lighting: "internal",
    grp: 3.4,
    trafficPerDay: 52_000,
    pricePerMonth: 52_000,
    description: "Заметная точка на городском транспортном узле с устойчивым ежедневным потоком.",
    image: "image_67f78a9a76a4f.webp",
  },
  {
    name: "Щит — Ахмат-Арена",
    code: "ББ-021",
    owner: "Городская сеть",
    address: "г. Грозный, район Ахмат-Арены",
    district: "Байсангуровский",
    lat: 43.346,
    lng: 45.684,
    format: "billboard",
    size: "3 × 6 м",
    sideCount: 2,
    lighting: "external",
    grp: 4.1,
    trafficPerDay: 44_000,
    pricePerMonth: 90_000,
    description: "Крупный формат рядом со спортивным и событийным трафиком.",
    image: "image_67f78a9a261d6.webp",
  },
  {
    name: "Сити-формат — рынок Беркат",
    code: "СФ-027",
    owner: "Noesis Outdoor",
    address: "г. Грозный, район рынка Беркат",
    district: "Центр",
    lat: 43.3178,
    lng: 45.6824,
    format: "cityFormat",
    size: "1,2 × 1,8 м",
    sideCount: 1,
    lighting: "internal",
    grp: 2.2,
    trafficPerDay: 31_000,
    pricePerMonth: null,
    description: "Локация для розничных и сервисных кампаний рядом с активным покупательским потоком.",
    image: "image_683700316825f.webp",
  },
  {
    name: "Суперсайт — проспект Исаева",
    code: "СС-003",
    owner: "Городская сеть",
    address: "г. Грозный, проспект А. А. Исаева",
    district: "Центр",
    lat: 43.3235,
    lng: 45.7062,
    format: "superSite",
    size: "5 × 15 м",
    sideCount: 1,
    lighting: "external",
    grp: 5.6,
    trafficPerDay: 61_000,
    pricePerMonth: null,
    description: "Имиджевый крупный формат для запусков, федеральных кампаний и долгих флайтов.",
    image: "image_68cab19528d88.webp",
  },
  {
    name: "Сити-формат — улица Исмаилова",
    code: "СФ-032",
    owner: "Партнёрские конструкции",
    address: "г. Грозный, ул. Э. Э. Исмаилова",
    district: "Центр",
    lat: 43.3162,
    lng: 45.7015,
    format: "cityFormat",
    size: "1,2 × 1,8 м",
    sideCount: 2,
    lighting: "internal",
    grp: 2.5,
    trafficPerDay: 34_000,
    pricePerMonth: null,
    description: "Городская локация рядом с деловой и прогулочной активностью.",
    image: "image_687a40bb12498.webp",
  },
  {
    name: "Пилон — Черноречье",
    code: "ПЛ-006",
    owner: "Партнёрские конструкции",
    address: "г. Грозный, Черноречье",
    district: "Черноречье",
    lat: 43.287,
    lng: 45.679,
    format: "pillar",
    size: "1,4 × 3 м",
    sideCount: 2,
    lighting: "external",
    grp: null,
    trafficPerDay: 18_000,
    pricePerMonth: null,
    description: "Пилон для локальных кампаний и навигационных сообщений в районе.",
    image: "image_687e23156f398.webp",
  },
  {
    name: "Медиаэкран — Грозный-Сити",
    code: "МЭ-002",
    owner: "Noesis Outdoor",
    address: "г. Грозный, комплекс Грозный-Сити",
    district: "Центр",
    lat: 43.3158,
    lng: 45.6989,
    format: "mediaScreen",
    size: "3 × 5 м",
    sideCount: 1,
    lighting: "internal",
    grp: 4.8,
    trafficPerDay: 49_000,
    pricePerMonth: null,
    description: "Цифровой формат в центральной части города для динамичных креативов и коротких кампаний.",
    image: "image_687a40ba9d3c1.webp",
  },
];

const LEGACY_CONSTRUCTION_SLUGS = [
  "aurum",
  "green-city",
  "royal-tower",
  "sky-town",
  "angliyskiy-kvartal",
  "ramada",
  "plaza",
  "triumph",
] as const;

/** Метка новости: имя задаёт slug и порядок. */
interface NewsLabelSeed {
  name: string;
  order: number;
}

const NEWS_LABELS: NewsLabelSeed[] = [
  { name: "Акция", order: 1 },
  { name: "Кейсы", order: 2 },
  { name: "Новости", order: 3 },
  { name: "Медиа", order: 4 },
];

/** Новость: `label` — имя метки; `body` — абзацы (склеим через пустую строку). */
interface NewsSeed {
  date: string;
  label: string;
  title: string;
  excerpt: string;
  body: string[];
  image: string;
}

const NEWS: NewsSeed[] = [
  {
    date: "2026-03-12",
    label: "Акция",
    title: "Весенние пакеты размещения на сити-форматах",
    excerpt:
      "Собрали городские локации для быстрых кампаний на месяц и сезон.",
    image: "image_697064d866bdf.webp",
    body: [
      "Noesis подготовил подборки сити-форматов для локальных и городских кампаний. В пакеты входят конструкции в центральных и транспортных точках Грозного.",
      "Менеджер поможет выбрать формат, сторону и период размещения, а также подскажет, какие локации лучше подходят для охватной или точечной кампании.",
      "Чтобы получить подборку по задаче бренда, оставьте заявку или позвоните в отдел размещений.",
    ],
  },
  {
    date: "2026-03-04",
    label: "Кейсы",
    title: "Как выбрать локации для городского запуска",
    excerpt: "Короткий чек-лист для рекламодателя перед бронированием наружной рекламы.",
    image: "file_697064d5abc29.webp",
    body: [
      "Перед запуском наружной рекламы важно определить маршрут аудитории: работа, дом, торговые точки, городские события и транспортные узлы.",
      "Для охватной кампании лучше сочетать центральные конструкции и въездные направления. Для локальной акции достаточно нескольких точек рядом с районом продаж.",
      "В заявке можно указать задачу кампании — менеджер Noesis соберёт подборку конструкций под нужный сценарий.",
    ],
  },
  {
    date: "2026-02-26",
    label: "Новости",
    title: "Каталог конструкций обновлён координатами",
    excerpt:
      "Карточки конструкций теперь можно смотреть на карте Грозного.",
    image: "image_67f78a9a261d6.webp",
    body: [
      "Мы добавили координаты к демонстрационному каталогу конструкций, чтобы рекламодатель быстрее понимал географию размещения.",
      "Пины на карте ведут в карточки с адресом, форматом, ценой и базовыми параметрами охвата.",
      "Следующий шаг развития каталога — публичная занятость по выбранному периоду.",
    ],
  },
  {
    date: "2026-02-18",
    label: "Медиа",
    title: "Требования к макетам для сити-форматов",
    excerpt:
      "Что подготовить дизайнеру перед запуском наружной кампании.",
    image: "image_67f78a99726f2.webp",
    body: [
      "Для сити-формата важны крупный заголовок, короткое сообщение и контрастная графика. Макет должен считываться за несколько секунд.",
      "Перед печатью менеджер проверит размер, вылеты, читаемость текста и соответствие техническим требованиям площадки.",
      "Если макет ещё не готов, оставьте заявку — подскажем формат и передадим дизайнеру параметры конструкции.",
    ],
  },
  {
    date: "2026-02-05",
    label: "Акция",
    title: "Пакет для локального бизнеса",
    excerpt:
      "Несколько конструкций рядом с районом продаж для коротких промо.",
    image: "image_687e23156f398.webp",
    body: [
      "Для кафе, клиник, магазинов и сервисных компаний часто эффективнее не широкий охват, а близость к точке продаж.",
      "Noesis может собрать небольшой пакет конструкций вокруг нужного района, чтобы повысить частоту контакта и не распылять бюджет.",
      "Оставьте заявку с адресом бизнеса — менеджер предложит ближайшие локации.",
    ],
  },
  {
    date: "2026-01-21",
    label: "Новости",
    title: "Фотоотчёты о размещении готовятся к запуску",
    excerpt:
      "После размещения клиент сможет получать подтверждающие материалы по периоду.",
    image: "image_687a40bb12498.webp",
    body: [
      "В CRM Noesis готовится блок фотоотчётов: менеджер сможет прикладывать подтверждающие фотографии размещения по месяцам.",
      "Это поможет клиенту видеть факт выхода кампании и хранить материалы в одной сделке вместе с документами.",
      "Публичный каталог уже готовит основу для этой логики: каждая заявка привязывается к конкретной конструкции.",
    ],
  },
];

const LEGACY_NEWS_SLUGS = [
  "skidka-v-chest-svyaschennogo-mesyaca-ramadan",
  "osobye-usloviya-dlya-uchastnikov-i-veteranov-svo",
  "start-prodazh-novyh-korpusov",
  "besprocentnaya-rassrochka-do-36-mesyacev",
  "trade-in-menyaem-vashu-kvartiru-na-novuyu",
  "blagoustroystvo-dvorov-v-nashih-zhk",
] as const;

/** Категории документов — общий справочник (на запуске без файлов). */
const DOC_CATEGORIES: { name: string; order: number }[] = [
  { name: "Прайс-листы", order: 1 },
  { name: "Презентации", order: 2 },
  { name: "Технические требования", order: 3 },
  { name: "Реквизиты и договоры", order: 4 },
];

/**
 * Скачать фото со старого облака и сохранить в наше хранилище, вернув id ассета.
 * Дедуп по URL через `cache` (одни снимки в конструкциях и новостях). На сбой загрузки —
 * лог и `null` (сид продолжается, карточка останется без обложки).
 */
async function ensureAsset(
  rt: Runtime,
  file: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const url = CDN + file;
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const asset = await storeUpload(rt, { bytes, originalName: file });
    cache.set(url, asset.id);
    return asset.id;
  } catch (err) {
    console.error(`[seed] не удалось загрузить фото ${url}:`, err);
    return null;
  }
}

/** Застройщики: создаём недостающих по slug, возвращаем карту имя → id. */
async function seedDevelopers(rt: Runtime): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const dev of DEVELOPERS) {
    const slug = slugify(dev.name);
    const existing = await rt.prisma.developer.findUnique({ where: { slug } });
    const id = existing
      ? existing.id
      : (await rt.prisma.developer.create({
          data: { name: dev.name, slug, order: dev.order },
        })).id;
    byName.set(dev.name, id);
  }
  return byName;
}

/** Конструкции: создаём недостающие по slug; обложка = одно фото. */
async function seedConstructions(
  rt: Runtime,
  owners: Map<string, string>,
  cache: Map<string, string>,
): Promise<void> {
  for (const p of CONSTRUCTIONS) {
    const slug = slugify(p.name);
    if (await rt.prisma.construction.findUnique({ where: { slug } })) continue;
    const coverId = await ensureAsset(rt, p.image, cache);
    await rt.prisma.construction.create({
      data: {
        slug,
        name: p.name,
        code: p.code,
        address: p.address,
        district: p.district,
        lat: p.lat,
        lng: p.lng,
        ownerId: owners.get(p.owner) ?? null,
        format: p.format,
        size: p.size,
        sideCount: p.sideCount,
        lighting: p.lighting,
        grp: p.grp,
        trafficPerDay: p.trafficPerDay,
        pricePerMonth: p.pricePerMonth,
        description: p.description,
        status: "published",
        coverId,
        images: coverId
          ? { create: [{ assetId: coverId, position: 0 }] }
          : undefined,
      },
    });
  }
}

/** Метки новостей: создаём недостающие по slug, возвращаем карту имя → id. */
async function seedNewsLabels(rt: Runtime): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const label of NEWS_LABELS) {
    const slug = slugify(label.name);
    const existing = await rt.prisma.newsLabel.findUnique({ where: { slug } });
    const id = existing
      ? existing.id
      : (await rt.prisma.newsLabel.create({
          data: { name: label.name, slug, order: label.order },
        })).id;
    byName.set(label.name, id);
  }
  return byName;
}

/** Новости: создаём недостающие по slug заголовка; абзацы → пустая строка. */
async function seedNews(
  rt: Runtime,
  labels: Map<string, string>,
  cache: Map<string, string>,
): Promise<void> {
  for (const n of NEWS) {
    const slug = slugify(n.title);
    if (await rt.prisma.news.findUnique({ where: { slug } })) continue;
    const coverId = await ensureAsset(rt, n.image, cache);
    await rt.prisma.news.create({
      data: {
        slug,
        title: n.title,
        labelId: labels.get(n.label) ?? null,
        date: new Date(`${n.date}T00:00:00Z`),
        excerpt: n.excerpt,
        body: n.body.join("\n\n"),
        status: "published",
        coverId,
      },
    });
  }
}

/** Категории документов: создаём недостающие по slug (файлы добавят в CRM). */
async function seedDocumentCategories(rt: Runtime): Promise<void> {
  for (const cat of DOC_CATEGORIES) {
    const slug = slugify(cat.name);
    if (await rt.prisma.documentCategory.findUnique({ where: { slug } })) continue;
    await rt.prisma.documentCategory.create({
      data: { name: cat.name, slug, order: cat.order },
    });
  }
}

async function upsertDevelopers(rt: Runtime): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const existing = await rt.prisma.developer.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: DEVELOPERS.length,
  });
  for (const [i, dev] of DEVELOPERS.entries()) {
    const slug = slugify(dev.name);
    const row = existing[i];
    const id = row
      ? (
          await rt.prisma.developer.update({
            where: { id: row.id },
            data: { name: dev.name, slug, order: dev.order, archivedAt: null },
          })
        ).id
      : (
          await rt.prisma.developer.upsert({
            where: { slug },
            update: { name: dev.name, order: dev.order, archivedAt: null },
            create: { name: dev.name, slug, order: dev.order },
          })
        ).id;
    byName.set(dev.name, id);
  }
  return byName;
}

async function upsertNewsLabels(rt: Runtime): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const existing = await rt.prisma.newsLabel.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: NEWS_LABELS.length,
  });
  for (const [i, label] of NEWS_LABELS.entries()) {
    const slug = slugify(label.name);
    const row = existing[i];
    const id = row
      ? (
          await rt.prisma.newsLabel.update({
            where: { id: row.id },
            data: { name: label.name, slug, order: label.order, archivedAt: null },
          })
        ).id
      : (
          await rt.prisma.newsLabel.upsert({
            where: { slug },
            update: { name: label.name, order: label.order, archivedAt: null },
            create: { name: label.name, slug, order: label.order },
          })
        ).id;
    byName.set(label.name, id);
  }
  return byName;
}

async function refreshDocumentCategories(rt: Runtime): Promise<void> {
  const existing = await rt.prisma.documentCategory.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: DOC_CATEGORIES.length,
  });
  for (const [i, cat] of DOC_CATEGORIES.entries()) {
    const slug = slugify(cat.name);
    const row = existing[i];
    if (row) {
      await rt.prisma.documentCategory.update({
        where: { id: row.id },
        data: { name: cat.name, slug, order: cat.order, archivedAt: null },
      });
    } else {
      await rt.prisma.documentCategory.upsert({
        where: { slug },
        update: { name: cat.name, order: cat.order, archivedAt: null },
        create: { name: cat.name, slug, order: cat.order },
      });
    }
  }
}

async function refreshLegacyDemoContent(rt: Runtime): Promise<boolean> {
  const existingConstructions = await rt.prisma.construction.findMany({
    where: { slug: { in: [...LEGACY_CONSTRUCTION_SLUGS] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, coverId: true },
  });
  const totalConstructions = await rt.prisma.construction.count();
  if (
    totalConstructions !== CONSTRUCTIONS.length ||
    existingConstructions.length !== CONSTRUCTIONS.length
  ) {
    return false;
  }

  console.log("Обнаружен старый демо-контент лендинга — обновляем под наружную рекламу.");
  const assetCache = new Map<string, string>();
  const owners = await upsertDevelopers(rt);

  const byLegacySlug = new Map(existingConstructions.map((c) => [c.slug, c]));
  for (const [i, legacySlug] of LEGACY_CONSTRUCTION_SLUGS.entries()) {
    const current = byLegacySlug.get(legacySlug);
    if (!current) continue;
    const p = CONSTRUCTIONS[i];
    const coverId = current.coverId ?? (await ensureAsset(rt, p.image, assetCache));
    await rt.prisma.construction.update({
      where: { id: current.id },
      data: {
        slug: slugify(p.name),
        name: p.name,
        code: p.code,
        address: p.address,
        district: p.district,
        lat: p.lat,
        lng: p.lng,
        ownerId: owners.get(p.owner) ?? null,
        format: p.format,
        size: p.size,
        sideCount: p.sideCount,
        lighting: p.lighting,
        grp: p.grp,
        trafficPerDay: p.trafficPerDay,
        pricePerMonth: p.pricePerMonth,
        description: p.description,
        badges: [],
        status: "published",
        archivedAt: null,
        coverId,
        images:
          coverId && !current.coverId
            ? { create: [{ assetId: coverId, position: 0 }] }
            : undefined,
      },
    });
  }

  const labels = await upsertNewsLabels(rt);
  const existingNews = await rt.prisma.news.findMany({
    where: { slug: { in: [...LEGACY_NEWS_SLUGS] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, coverId: true },
  });
  const byLegacyNewsSlug = new Map(existingNews.map((n) => [n.slug, n]));
  for (const [i, legacySlug] of LEGACY_NEWS_SLUGS.entries()) {
    const current = byLegacyNewsSlug.get(legacySlug);
    const n = NEWS[i];
    if (!current || !n) continue;
    const coverId = current.coverId ?? (await ensureAsset(rt, n.image, assetCache));
    await rt.prisma.news.update({
      where: { id: current.id },
      data: {
        slug: slugify(n.title),
        title: n.title,
        labelId: labels.get(n.label) ?? null,
        date: new Date(`${n.date}T00:00:00Z`),
        excerpt: n.excerpt,
        body: n.body.join("\n\n"),
        status: "published",
        archivedAt: null,
        coverId,
      },
    });
  }

  await refreshDocumentCategories(rt);
  console.log("Старый демо-контент обновлён: конструкции, новости и справочники.");
  return true;
}

/**
 * Сид публичного контента лендинга — РАЗОВЫЙ бутстрап. Запускается только на
 * пустой базе (нет ни одной конструкции): на «живом» проде повторный деплой не должен
 * воскрешать жёстко удалённый/изменённый демо-контент (Веха 4.2). Порядок:
 * владельцы сети → конструкции → метки → новости → категории документов.
 */
export async function seedContent(rt: Runtime): Promise<void> {
  const existingConstructions = await rt.prisma.construction.count();
  if (existingConstructions > 0) {
    if (await refreshLegacyDemoContent(rt)) return;
    console.log(
      `Контент лендинга уже есть (конструкций: ${existingConstructions}) — пропускаем бутстрап-сид.`,
    );
    return;
  }

  const assetCache = new Map<string, string>();
  const developers = await seedDevelopers(rt);
  await seedConstructions(rt, developers, assetCache);
  const labels = await seedNewsLabels(rt);
  await seedNews(rt, labels, assetCache);
  await seedDocumentCategories(rt);

  const [devCount, constrCount, newsCount, catCount] = await Promise.all([
    rt.prisma.developer.count(),
    rt.prisma.construction.count(),
    rt.prisma.news.count(),
    rt.prisma.documentCategory.count(),
  ]);
  console.log(
    `Контент лендинга: владельцев сети ${devCount}, конструкций ${constrCount}, ` +
      `новостей ${newsCount}, категорий документов ${catCount}.`,
  );
}
