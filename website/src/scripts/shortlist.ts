export interface ShortlistSide {
  code: "A" | "B" | "C";
  label: string;
  priceLabel: string;
}

export interface ShortlistItem {
  constructionId: string;
  slug: string;
  name: string;
  code: string;
  address: string;
  image: string;
  sideCode: "A" | "B" | "C";
  sides: ShortlistSide[];
  from: string;
  to: string;
  priceLabel: string;
}

const STORAGE_KEY = "noesis_shortlist_v1";
const CHANGE_EVENT = "noesis:shortlist-change";

function isSide(value: unknown): value is ShortlistSide["code"] {
  return value === "A" || value === "B" || value === "C";
}

function cleanItem(value: unknown): ShortlistItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ShortlistItem>;
  if (
    typeof item.constructionId !== "string" ||
    typeof item.slug !== "string" ||
    typeof item.name !== "string" ||
    !isSide(item.sideCode)
  ) return null;

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

  if (!sides.some((side) => side.code === item.sideCode)) {
    sides.push({ code: item.sideCode, label: `Сторона ${item.sideCode}`, priceLabel: "Цена по запросу" });
  }

  return {
    constructionId: item.constructionId,
    slug: item.slug,
    name: item.name,
    code: typeof item.code === "string" ? item.code : "",
    address: typeof item.address === "string" ? item.address : "Грозный",
    image: typeof item.image === "string" ? item.image : "",
    sideCode: item.sideCode,
    sides,
    from: typeof item.from === "string" ? item.from : "",
    to: typeof item.to === "string" ? item.to : "",
    priceLabel: typeof item.priceLabel === "string" ? item.priceLabel : "Цена по запросу",
  };
}

export function shortlistKey(item: Pick<ShortlistItem, "constructionId" | "sideCode">): string {
  return `${item.constructionId}:${item.sideCode}`;
}

export function readShortlist(): ShortlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const clean = cleanItem(item);
      return clean ? [clean] : [];
    }).slice(0, 50);
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

export function upsertShortlist(item: ShortlistItem): ShortlistItem[] {
  const clean = cleanItem(item);
  if (!clean) return readShortlist();
  const items = readShortlist();
  const key = shortlistKey(clean);
  const index = items.findIndex((entry) => shortlistKey(entry) === key);
  if (index >= 0) items[index] = clean;
  else items.push(clean);
  writeShortlist(items);
  return items;
}

export function replaceShortlistItem(previousKey: string, item: ShortlistItem): ShortlistItem[] {
  const clean = cleanItem(item);
  if (!clean) return readShortlist();
  const nextKey = shortlistKey(clean);
  const items = readShortlist().filter((entry) => {
    const key = shortlistKey(entry);
    return key !== previousKey && key !== nextKey;
  });
  items.push(clean);
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
    return `${index + 1}. ${identity}; сторона ${item.sideCode}; ${period}; ${item.priceLabel}`;
  });
  return `Подборка (${items.length}):\n${rows.join("\n")}`;
}
