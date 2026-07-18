import { defaultPeriod, todayLocal } from "./dates";

export interface ShortlistSide {
  code: "A" | "B" | "C";
  label: string;
  priceLabel: string;
}

/* Позиция подборки: одна конструкция + выбранные стороны (одна или несколько)
   и общий период. Ключ позиции — id конструкции. */
export interface ShortlistItem {
  constructionId: string;
  slug: string;
  name: string;
  code: string;
  address: string;
  image: string;
  sideCodes: ("A" | "B" | "C")[];
  sides: ShortlistSide[];
  from: string;
  to: string;
  priceLabel: string;
}

const STORAGE_KEY = "noesis_shortlist_v1";
const CHANGE_EVENT = "noesis:shortlist-change";
const SIDE_ORDER: ShortlistSide["code"][] = ["A", "B", "C"];

function isSide(value: unknown): value is ShortlistSide["code"] {
  return value === "A" || value === "B" || value === "C";
}

/* Уникальные коды сторон в каноническом порядке A → B → C. */
export function sortSideCodes(codes: readonly ShortlistSide["code"][]): ShortlistSide["code"][] {
  return SIDE_ORDER.filter((code) => codes.includes(code));
}

function cleanItem(value: unknown): ShortlistItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ShortlistItem> & { sideCode?: unknown };
  if (
    typeof item.constructionId !== "string" ||
    typeof item.slug !== "string" ||
    typeof item.name !== "string"
  ) return null;

  // Новая модель — массив sideCodes; легаси-записи имели одиночный sideCode.
  const rawCodes = Array.isArray(item.sideCodes) ? item.sideCodes : [item.sideCode];
  const sideCodes = sortSideCodes(rawCodes.filter(isSide));
  if (!sideCodes.length) return null;

  const sides = Array.isArray(item.sides)
    ? item.sides.flatMap((side) => {
        if (!side || typeof side !== "object") return [];
        const candidate = side as Partial<ShortlistSide>;
        if (!isSide(candidate.code)) return [];
        return [{
          code: candidate.code,
          label: typeof candidate.label === "string" ? candidate.label : `Сторона ${candidate.code}`,
          priceLabel: typeof candidate.priceLabel === "string" ? candidate.priceLabel : "Цена по запросу",
        }];
      })
    : [];

  for (const code of sideCodes) {
    if (!sides.some((side) => side.code === code)) {
      sides.push({ code, label: `Сторона ${code}`, priceLabel: "Цена по запросу" });
    }
  }

  return {
    constructionId: item.constructionId,
    slug: item.slug,
    name: item.name,
    code: typeof item.code === "string" ? item.code : "",
    address: typeof item.address === "string" ? item.address : "Грозный",
    image: typeof item.image === "string" ? item.image : "",
    sideCodes,
    sides,
    from: typeof item.from === "string" ? item.from : "",
    to: typeof item.to === "string" ? item.to : "",
    priceLabel: typeof item.priceLabel === "string" ? item.priceLabel : "Цена по запросу",
  };
}

/* Чистая нормализация хранимого списка: валидация записей, миграция легаси
   `sideCode` → `sideCodes`, слияние дублей одной конструкции (раньше позиция
   была «конструкция+сторона») и автозаполнение периода (сегодня / +1 месяц). */
export function normalizeShortlist(parsed: unknown, today: string): ShortlistItem[] {
  if (!Array.isArray(parsed)) return [];
  const byConstruction = new Map<string, ShortlistItem>();
  for (const raw of parsed) {
    const clean = cleanItem(raw);
    if (!clean) continue;
    const existing = byConstruction.get(clean.constructionId);
    if (existing) {
      existing.sideCodes = sortSideCodes([...existing.sideCodes, ...clean.sideCodes]);
      for (const side of clean.sides) {
        if (!existing.sides.some((entry) => entry.code === side.code)) existing.sides.push(side);
      }
    } else {
      byConstruction.set(clean.constructionId, clean);
    }
  }
  return [...byConstruction.values()].slice(0, 50).map((item) => {
    const period = defaultPeriod(item.from, item.to, today);
    return { ...item, from: period.from, to: period.to };
  });
}

export function shortlistKey(item: Pick<ShortlistItem, "constructionId">): string {
  return item.constructionId;
}

export function readShortlist(): ShortlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeShortlist(JSON.parse(raw), todayLocal());
  } catch {
    return [];
  }
}

function writeShortlist(items: ShortlistItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // В приватном режиме хранилище может быть недоступно — интерфейс не падает.
  }
  window.dispatchEvent(new CustomEvent<ShortlistItem[]>(CHANGE_EVENT, { detail: items }));
}

/* Вставка/замена позиции по конструкции (стороны заменяются целиком —
   слияние с уже выбранными сторонами делает вызывающий код). */
export function upsertShortlist(item: ShortlistItem): ShortlistItem[] {
  const clean = cleanItem(item);
  if (!clean) return readShortlist();
  // Нормализуем период здесь же (сегодня / минимум +1 месяц), чтобы период
  // короче месяца не попал ни в хранилище, ни в событие изменения: иначе
  // слушатели (страница подборки, текст заявки) показали бы сырой период до
  // следующего чтения. defaultPeriod идемпотентен для валидных периодов.
  const period = defaultPeriod(clean.from, clean.to, todayLocal());
  const normalized = { ...clean, from: period.from, to: period.to };
  const items = readShortlist();
  const index = items.findIndex((entry) => entry.constructionId === normalized.constructionId);
  if (index >= 0) items[index] = normalized;
  else items.push(normalized);
  writeShortlist(items);
  return items;
}

export function removeShortlistItem(key: string): ShortlistItem[] {
  const items = readShortlist().filter((entry) => shortlistKey(entry) !== key);
  writeShortlist(items);
  return items;
}

export function clearShortlist(): void {
  writeShortlist([]);
}

export function onShortlistChange(callback: (items: ShortlistItem[]) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ShortlistItem[]>).detail;
    callback(Array.isArray(detail) ? detail : readShortlist());
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

function shortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "период не указан";
}

export function shortlistLeadText(items: ShortlistItem[]): string {
  if (!items.length) return "";
  const rows = items.map((item, index) => {
    const period = item.from && item.to
      ? `${shortDate(item.from)}–${shortDate(item.to)}`
      : "период не указан";
    const identity = [item.code, item.name].filter(Boolean).join(" · ");
    const sideWord = item.sideCodes.length > 1 ? "стороны" : "сторона";
    const priceOf = (code: ShortlistSide["code"]): string =>
      item.sides.find((side) => side.code === code)?.priceLabel ?? item.priceLabel;
    const prices = item.sideCodes.length > 1
      ? item.sideCodes.map((code) => `${code}: ${priceOf(code)}`).join(" · ")
      : priceOf(item.sideCodes[0]!);
    return `${index + 1}. ${identity}; ${sideWord} ${item.sideCodes.join(", ")}; ${period}; ${prices}`;
  });
  return `Подборка (${items.length}):\n${rows.join("\n")}`;
}
