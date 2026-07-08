// Сид публичного контента лендинга (Веха 4): застройщики, ЖК, новости и
// категории документов — 1:1 с тем, что было зашито в статике
// (`website/public/js/main.js`). Идемпотентно: проверяем существование по slug,
// повторный запуск ничего не дублирует. Пишем НАПРЯМУЮ через Prisma, в обход
// `upsertProjectSchema` (она требует цену+комнатность у публикуемого ЖК; часть
// ЖК идут без цены — это ок, как «Цена по запросу» в исходном дизайне).
//
// Фото скачиваются со старого облака в наше хранилище через `storeUpload`
// (оригинал + WebP-производные). Дедуп по URL — одни и те же снимки
// переиспользуются в карточках ЖК и в новостях. Сбой загрузки логируется и не
// роняет сид (карточка просто останется без обложки).
import { Prisma } from "@prisma/client";
import { slugify, type RoomFormat } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import { storeUpload } from "../src/files/file-service";

/**
 * База старого облака, откуда переносим фото в наше хранилище. Переопределяется
 * через `SEED_CDN_BASE` (например, локальное зеркало, если бакет недоступен).
 */
const CDN =
  process.env.SEED_CDN_BASE ??
  "https://crm-uploads.storage.yandexcloud.net/291/images/";

/** Застройщик: имя задаёт slug и порядок; привязка Ж→застройщик условная. */
interface DeveloperSeed {
  name: string;
  order: number;
}

const DEVELOPERS: DeveloperSeed[] = [
  { name: "Империя", order: 1 },
  { name: "Смарт-Строй", order: 2 },
  { name: "Иволга", order: 3 },
];

/** ЖК каталога. `developer` — имя застройщика из `DEVELOPERS`. */
interface ProjectSeed {
  name: string;
  developer: string;
  address: string;
  rooms: RoomFormat[];
  priceFrom: number | null;
  comingSoon?: boolean;
  image: string;
}

const PROJECTS: ProjectSeed[] = [
  { name: "AURUM", developer: "Империя", address: "г. Грозный", rooms: ["one", "two", "three"], priceFrom: 1_000_000, image: "image_67f78a99726f2.webp" },
  { name: "GREEN City", developer: "Империя", address: "г. Грозный", rooms: ["one", "two"], priceFrom: 3_700_000, image: "image_67f78a9a76a4f.webp" },
  { name: "ROYAL TOWER", developer: "Империя", address: "г. Грозный", rooms: ["one", "two"], priceFrom: 2_600_000, image: "image_67f78a9a261d6.webp" },
  { name: "SKY TOWN", developer: "Смарт-Строй", address: "г. Грозный", rooms: ["one", "two", "three"], priceFrom: null, image: "image_683700316825f.webp" },
  { name: "АНГЛИЙСКИЙ КВАРТАЛ", developer: "Смарт-Строй", address: "г. Грозный, пр-кт Исаева, 42", rooms: ["studio", "one", "two", "three"], priceFrom: null, image: "image_68cab19528d88.webp" },
  { name: "RAMADA", developer: "Смарт-Строй", address: "г. Грозный, ул. Э.Э. Исмаилова", rooms: ["one", "two"], priceFrom: null, image: "image_687a40bb12498.webp" },
  { name: "PLAZA", developer: "Иволга", address: "г. Грозный", rooms: ["one", "two", "three"], priceFrom: null, image: "image_687e23156f398.webp" },
  { name: "TRIUMPH", developer: "Иволга", address: "г. Грозный", rooms: [], priceFrom: null, comingSoon: true, image: "image_687a40ba9d3c1.webp" },
];

/** Метка новости: имя задаёт slug и порядок. */
interface NewsLabelSeed {
  name: string;
  order: number;
}

const NEWS_LABELS: NewsLabelSeed[] = [
  { name: "Акция", order: 1 },
  { name: "Поддержка", order: 2 },
  { name: "Новости", order: 3 },
  { name: "Рассрочка", order: 4 },
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
    title: "Скидка в честь священного месяца Рамадан",
    excerpt:
      "Специальные условия на квартиры в наших жилых комплексах в течение всего месяца.",
    image: "image_697064d866bdf.webp",
    body: [
      "В честь священного месяца Рамадан Noesis предлагает специальные условия на покупку квартир во всех жилых комплексах группы. Акция действует в течение всего месяца и распространяется на готовые и строящиеся объекты.",
      "Скидка суммируется с программой беспроцентной рассрочки от застройщика, что делает покупку квартиры особенно выгодной. Менеджеры единого офиса продаж подберут оптимальный вариант под ваш бюджет и помогут оформить сделку без посредников.",
      "Чтобы узнать размер скидки по конкретной квартире, оставьте заявку или позвоните в офис продаж — перезвоним в течение 15 минут.",
    ],
  },
  {
    date: "2026-03-04",
    label: "Поддержка",
    title: "Особые условия для участников и ветеранов СВО",
    excerpt: "Индивидуальный подход и помощь на каждом этапе сделки.",
    image: "file_697064d5abc29.webp",
    body: [
      "Для участников и ветеранов специальной военной операции Noesis предусмотрел отдельную программу с индивидуальными условиями покупки и сопровождением на каждом этапе сделки.",
      "Мы помогаем с подбором квартиры, оформлением документов и подключением мер государственной поддержки. Персональный менеджер ведёт сделку от первой заявки до получения ключей.",
      "Подробности программы уточняйте в едином офисе продаж — расскажем обо всех доступных льготах и поможем собрать необходимый пакет документов.",
    ],
  },
  {
    date: "2026-02-26",
    label: "Новости",
    title: "Старт продаж новых корпусов",
    excerpt:
      "Открыто бронирование квартир в жилых комплексах нового поколения от Noesis.",
    image: "image_67f78a9a261d6.webp",
    body: [
      "Открыто бронирование квартир в новых корпусах жилых комплексов Noesis. В продажу поступили студии и квартиры с одной, двумя и тремя комнатами — с продуманными планировками и возможностью объединения.",
      "Новые корпуса возводятся с применением современных инженерных решений: надёжные коммуникации, подземный паркинг и благоустроенные дворы без машин. Районы активно развиваются, инфраструктура — в шаговой доступности.",
      "На старте продаж действуют лучшие цены. Забронируйте квартиру сейчас, чтобы зафиксировать стоимость до повышения.",
    ],
  },
  {
    date: "2026-02-18",
    label: "Рассрочка",
    title: "Беспроцентная рассрочка до 36 месяцев",
    excerpt:
      "Покупка квартиры напрямую от застройщика без банков, процентов и переплат.",
    image: "image_67f78a99726f2.webp",
    body: [
      "Noesis предоставляет беспроцентную рассрочку напрямую от застройщика на срок до 36 месяцев. Без участия банков, без процентов и скрытых переплат — вы платите ровно стоимость квартиры.",
      "Первоначальный взнос и график платежей подбираются индивидуально. Рассчитать ежемесячный платёж можно прямо на сайте с помощью калькулятора рассрочки, а зафиксировать условия — в офисе продаж.",
      "Рассрочка доступна для большинства квартир в наших жилых комплексах и суммируется с действующими акциями.",
    ],
  },
  {
    date: "2026-02-05",
    label: "Акция",
    title: "Trade-in: меняем вашу квартиру на новую",
    excerpt:
      "Засчитываем стоимость вашего жилья в счёт покупки квартиры в ЖК от Noesis.",
    image: "image_687e23156f398.webp",
    body: [
      "Программа Trade-in позволяет переехать в новую квартиру, не дожидаясь продажи старой. Мы оцениваем ваше текущее жильё и засчитываем его стоимость в счёт покупки квартиры в одном из жилых комплексов Noesis.",
      "Оценка проводится бесплатно, а на время сделки за вами закрепляется выбранная квартира и её цена. Все этапы — оценка, оформление и переезд — сопровождает персональный менеджер.",
      "Оставьте заявку, чтобы узнать предварительную стоимость вашей квартиры по программе Trade-in.",
    ],
  },
  {
    date: "2026-01-21",
    label: "Новости",
    title: "Благоустройство дворов в наших ЖК",
    excerpt:
      "Закрытые дворы без машин, детские площадки и озеленение в комплексах TOWER.",
    image: "image_687a40bb12498.webp",
    body: [
      "В жилых комплексах Noesis завершается благоустройство придомовых территорий. Дворы проектируются по принципу «двор без машин»: автомобили остаются на подземном паркинге и гостевых стоянках по периметру.",
      "Во дворах появились современные детские и спортивные площадки, зоны отдыха, пешеходные дорожки и озеленение. Освещение и видеонаблюдение делают территорию безопасной в любое время суток.",
      "Комфортная среда у дома — часть концепции TOWER: мы строим будущее, сохраняя ценность спокойной и удобной повседневной жизни.",
    ],
  },
];

/** Категории документов — общий справочник (на запуске без файлов). */
const DOC_CATEGORIES: { name: string; order: number }[] = [
  { name: "Проектная документация", order: 1 },
  { name: "Разрешения на строительство", order: 2 },
  { name: "Правоустанавливающие документы", order: 3 },
  { name: "Заключения экспертизы", order: 4 },
];

/**
 * Скачать фото со старого облака и сохранить в наше хранилище, вернув id ассета.
 * Дедуп по URL через `cache` (одни снимки в ЖК и новостях). На сбой загрузки —
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

/** ЖК: создаём недостающие по slug; обложка = одно фото (ProjectImage + coverId). */
async function seedProjects(
  rt: Runtime,
  developers: Map<string, string>,
  cache: Map<string, string>,
): Promise<void> {
  for (const p of PROJECTS) {
    const slug = slugify(p.name);
    if (await rt.prisma.project.findUnique({ where: { slug } })) continue;
    const coverId = await ensureAsset(rt, p.image, cache);
    await rt.prisma.project.create({
      data: {
        slug,
        name: p.name,
        address: p.address,
        developerId: developers.get(p.developer) ?? null,
        priceFrom: p.priceFrom,
        rooms: p.rooms as unknown as Prisma.InputJsonValue,
        status: "published",
        comingSoon: p.comingSoon ?? false,
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

/**
 * Сид публичного контента лендинга — РАЗОВЫЙ бутстрап. Запускается только на
 * пустой базе (нет ни одного ЖК): на «живом» проде повторный деплой не должен
 * воскрешать жёстко удалённый/изменённый демо-контент (Веха 4.2). Порядок:
 * застройщики → ЖК → метки → новости → категории документов.
 */
export async function seedContent(rt: Runtime): Promise<void> {
  const existingProjects = await rt.prisma.project.count();
  if (existingProjects > 0) {
    console.log(
      `Контент лендинга уже есть (ЖК: ${existingProjects}) — пропускаем бутстрап-сид.`,
    );
    return;
  }

  const assetCache = new Map<string, string>();
  const developers = await seedDevelopers(rt);
  await seedProjects(rt, developers, assetCache);
  const labels = await seedNewsLabels(rt);
  await seedNews(rt, labels, assetCache);
  await seedDocumentCategories(rt);

  const [devCount, projCount, newsCount, catCount] = await Promise.all([
    rt.prisma.developer.count(),
    rt.prisma.project.count(),
    rt.prisma.news.count(),
    rt.prisma.documentCategory.count(),
  ]);
  console.log(
    `Контент лендинга: застройщиков ${devCount}, ЖК ${projCount}, ` +
      `новостей ${newsCount}, категорий документов ${catCount}.`,
  );
}
