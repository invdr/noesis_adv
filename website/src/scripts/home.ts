import type { CatalogItem } from "../lib/api";
import { onShortlistChange, readShortlist, shortlistKey, upsertShortlist } from "./shortlist";
import { loadYandexMaps, MapUnavailableError, waitYMapsReady } from "./yandex-map";

interface HomeData {
  items: CatalogItem[];
  map: { apiKey: string; center: [number, number]; zoom: number };
}

interface AvailabilitySide {
  code: "A" | "B" | "C";
  status: "free" | "partiallyOccupied" | "occupied";
}

interface AvailabilityEntry { status: "free" | "partial" | "occupied"; sides: AvailabilitySide[]; }

function parseJson<T>(id: string): T | null {
  const node = document.getElementById(id);
  try { return node?.textContent ? JSON.parse(node.textContent) as T : null; } catch { return null; }
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function formatShortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}` : value;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function aggregate(sides: AvailabilitySide[]): AvailabilityEntry["status"] {
  if (!sides.length || sides.some((side) => side.status === "free")) return "free";
  if (sides.every((side) => side.status === "occupied")) return "occupied";
  return "partial";
}

const STATUS_TEXT = {
  free: "Есть свободная сторона",
  partial: "Частично занято",
  occupied: "Все стороны заняты",
};

function initDates(form: HTMLFormElement): { from: HTMLInputElement; to: HTMLInputElement } | null {
  const from = form.querySelector<HTMLInputElement>("[data-default-from]");
  const to = form.querySelector<HTMLInputElement>("[data-default-to]");
  if (!from || !to) return null;
  const today = localDate(new Date());
  from.min = today;
  to.min = today;
  if (!from.value) from.value = addDays(today, 7);
  if (!to.value) to.value = addDays(from.value, 30);
  from.addEventListener("change", () => {
    to.min = from.value || today;
    if (to.value && from.value && to.value < from.value) to.value = addDays(from.value, 30);
  });
  return { from, to };
}

function init(): void {
  const data = parseJson<HomeData>("home-data");
  if (!data) return;
  const site = parseJson<{ apiUrl: string }>("site-config") ?? { apiUrl: "" };
  const quickForm = document.querySelector<HTMLFormElement>("[data-quick-search]");
  const dates = quickForm ? initDates(quickForm) : null;
  let availability = new Map<string, AvailabilityEntry>();
  let map: unknown = null;
  const placemarks = new Map<string, unknown>();
  let selectedId = "";

  const renderButtons = () => {
    const keys = new Set(readShortlist().map(shortlistKey));
    document.querySelectorAll<HTMLButtonElement>("[data-card-add]").forEach((button) => {
      const item = data.items.find((entry) => entry.id === button.dataset.cardAdd);
      const side = item?.sides[0]?.code as "A" | "B" | "C" | undefined;
      const added = !!item && !!side && keys.has(`${item.id}:${side}`);
      button.classList.toggle("is-added", added);
      const label = button.querySelector<HTMLElement>("[data-card-add-label]");
      if (label && !item?.isSoon) label.textContent = added ? "Добавлено" : "В подборку";
    });
  };

  const addFromCard = (id: string) => {
    const item = data.items.find((entry) => entry.id === id);
    const side = item?.sides[0];
    if (!item || !side || item.isSoon) return;
    upsertShortlist({
      constructionId: item.id,
      slug: item.slug,
      name: item.name,
      code: item.code,
      address: item.address,
      image: item.img,
      sideCode: side.code as "A" | "B" | "C",
      sides: item.sides.map((entry) => ({ code: entry.code as "A" | "B" | "C", label: `Сторона ${entry.code}`, priceLabel: entry.priceLabel })),
      from: dates?.from.value ?? "",
      to: dates?.to.value ?? "",
      priceLabel: side.priceLabel,
    });
  };

  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-card-add]");
    if (button?.dataset.cardAdd) addFromCard(button.dataset.cardAdd);
  });
  renderButtons();
  onShortlistChange(renderButtons);

  const annotateCards = () => {
    document.querySelectorAll<HTMLElement>("[data-construction-card]").forEach((card) => {
      const entry = availability.get(card.dataset.constructionCard || "");
      const status = card.querySelector<HTMLElement>("[data-card-availability]");
      if (!status) return;
      if (!entry) {
        status.textContent = "Уточните период";
        status.removeAttribute("data-state");
      } else {
        status.textContent = STATUS_TEXT[entry.status];
        status.dataset.state = entry.status;
      }
    });
  };

  const setSelected = (id: string) => {
    selectedId = id;
    document.querySelectorAll<HTMLElement>("[data-construction-card]").forEach((card) => {
      card.classList.toggle("is-map-active", card.dataset.constructionCard === id);
    });
    placemarks.forEach((placemark, markerId) => {
      (placemark as { options: { set: (name: string, value: string) => void } }).options.set("iconColor", markerId === id ? "#8B0000" : "#333330");
    });
  };

  const focusCard = (id: string) => {
    setSelected(id);
    const card = document.querySelector<HTMLElement>(`[data-construction-card="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };

  const renderMap = () => {
    if (!map) return;
    const ymaps = (window as typeof window & { ymaps: {
      Placemark: new (coords: [number, number], properties: object, options: object) => unknown;
    } }).ymaps;
    const mapObject = map as { geoObjects: { removeAll: () => void; add: (item: unknown) => void } };
    mapObject.geoObjects.removeAll();
    placemarks.clear();
    data.items.forEach((item) => {
      if (typeof item.lat !== "number" || typeof item.lng !== "number") return;
      const entry = availability.get(item.id);
      const sideText = entry?.sides.map((side) => `${side.code}: ${side.status === "free" ? "свободно" : side.status === "occupied" ? "занято" : "частично"}`).join(" · ") || "Выберите период";
      const placemark = new ymaps.Placemark(
        [item.lat, item.lng],
        {
          hintContent: escapeHtml(item.name),
          balloonContentHeader: escapeHtml(`${item.code} · ${item.name}`),
          balloonContentBody: `${escapeHtml(item.address)}<br>${escapeHtml(item.formatLabel)} · ${escapeHtml(item.priceLabel)}<br><strong>${escapeHtml(sideText)}</strong>`,
          balloonContentFooter: item.isSoon ? "Скоро в каталоге" : `<a href="${escapeHtml(item.href)}">Открыть карточку</a>`,
        },
        { preset: "islands#circleDotIcon", iconColor: item.id === selectedId ? "#8B0000" : "#333330" },
      );
      (placemark as { events: { add: (name: string, callback: () => void) => void } }).events.add("click", () => focusCard(item.id));
      placemarks.set(item.id, placemark);
      mapObject.geoObjects.add(placemark);
    });
  };

  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-map-focus]");
    if (!button?.dataset.mapFocus || !map) return;
    const item = data.items.find((entry) => entry.id === button.dataset.mapFocus);
    const placemark = placemarks.get(button.dataset.mapFocus);
    if (!item || !placemark || item.lat == null || item.lng == null) return;
    setSelected(item.id);
    const mapObject = map as { setCenter: (coords: [number, number], zoom: number) => void; getZoom: () => number };
    mapObject.setCenter([item.lat, item.lng], Math.max(mapObject.getZoom(), 15));
    (placemark as { balloon: { open: () => void } }).balloon.open();
    document.getElementById("home-map")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  });

  const mapStatus = document.querySelector<HTMLElement>("[data-home-map-status]");
  const setupMap = async () => {
    const node = document.getElementById("home-map");
    if (!node) return;
    const points = data.items.filter((item) => typeof item.lat === "number" && typeof item.lng === "number");
    if (!points.length) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) message.innerHTML = "<strong>Координаты пока не опубликованы</strong><p>Конструкции доступны в списке.</p>";
      return;
    }
    try {
      const loaded = await loadYandexMaps(data.map.apiKey);
      await waitYMapsReady(loaded);
      const ymaps = loaded as { Map: new (node: HTMLElement, state: object, options: object) => unknown };
      node.innerHTML = "";
      map = new ymaps.Map(node, { center: data.map.center, zoom: data.map.zoom, controls: ["zoomControl", "fullscreenControl"] }, { suppressMapOpenBlock: true });
      renderMap();
      if (mapStatus) mapStatus.textContent = "Выберите маркер, чтобы открыть соответствующую карточку.";
    } catch (error) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) {
        message.innerHTML = `<strong>Карта сейчас недоступна</strong><p>${escapeHtml(error instanceof MapUnavailableError ? error.message : "Список конструкций работает без карты.")}</p>`;
      }
      if (mapStatus) mapStatus.textContent = "Все позиции доступны в списке.";
    }
  };
  void setupMap();

  let availabilityRequest = 0;
  let controller: AbortController | null = null;
  const refreshAvailability = async () => {
    if (!dates?.from.value || !dates.to.value || dates.from.value > dates.to.value) return;
    const request = ++availabilityRequest;
    controller?.abort();
    controller = new AbortController();
    const status = document.querySelector<HTMLElement>("[data-home-map-status]");
    if (status) status.textContent = "Проверяем доступность на выбранные даты…";
    try {
      const toExclusive = addDays(dates.to.value, 1);
      const response = await fetch(`${site.apiUrl}/api/public/construction-availability?from=${encodeURIComponent(dates.from.value)}&to=${encodeURIComponent(toExclusive)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items?: { id: string; sides: AvailabilitySide[] }[] };
      if (request !== availabilityRequest) return;
      availability = new Map((body.items ?? []).map((item) => [item.id, { sides: item.sides, status: aggregate(item.sides) }]));
      annotateCards();
      renderMap();
      if (status) status.textContent = `Доступность на ${formatShortDate(dates.from.value)}–${formatShortDate(dates.to.value)} загружена.`;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      availability.clear();
      annotateCards();
      renderMap();
      if (status) status.textContent = "Не удалось получить занятость. Карточки и карта остаются доступны.";
    }
  };
  dates?.from.addEventListener("change", () => void refreshAvailability());
  dates?.to.addEventListener("change", () => void refreshAvailability());
  void refreshAvailability();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
