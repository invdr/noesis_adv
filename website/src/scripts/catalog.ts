import type { CatalogItem } from "../lib/api";
import { onShortlistChange, readShortlist, shortlistKey, upsertShortlist } from "./shortlist";
import { loadYandexMaps, MapUnavailableError, waitYMapsReady } from "./yandex-map";

type Status = "free" | "partial" | "occupied";
type SideStatus = "free" | "partiallyOccupied" | "occupied";

interface AvailabilitySide {
  id: string;
  code: "A" | "B" | "C";
  status: SideStatus;
  busyIntervals: { startDate: string; endDate: string }[];
}

interface AvailabilityEntry { status: Status; sides: AvailabilitySide[]; }
interface CatalogData {
  items: CatalogItem[];
  map: { apiKey: string; center: [number, number]; zoom: number };
}

interface Filters {
  from: string;
  to: string;
  format: string;
  district: string;
  lighting: string;
  sideCount: string;
  priceFrom: number | null;
  priceTo: number | null;
  onlyFree: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  free: "Есть свободная сторона",
  partial: "Частично занято",
  occupied: "Все стороны заняты",
};

function parseJson<T>(id: string): T | null {
  const node = document.getElementById(id);
  try { return node?.textContent ? JSON.parse(node.textContent) as T : null; } catch { return null; }
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function shortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function aggregate(sides: AvailabilitySide[]): Status {
  if (!sides.length || sides.some((side) => side.status === "free")) return "free";
  if (sides.every((side) => side.status === "occupied")) return "occupied";
  return "partial";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "конструкция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "конструкции";
  return "конструкций";
}

function init(): void {
  const parsedData = parseJson<CatalogData>("catalog-data");
  const site = parseJson<{ apiUrl: string }>("site-config") ?? { apiUrl: "" };
  const form = document.querySelector<HTMLFormElement>("[data-catalog-filters]");
  const layout = document.querySelector<HTMLElement>(".catalog-page__layout");
  const statusNode = document.querySelector<HTMLElement>("[data-catalog-status]");
  const emptyNode = document.querySelector<HTMLElement>("[data-catalog-empty]");
  const loadingNode = document.querySelector<HTMLElement>("[data-catalog-loading]");
  const onlyFreeCandidate = form?.elements.namedItem("onlyFree") as HTMLInputElement | null;
  if (!parsedData || !form || !layout || !statusNode || !onlyFreeCandidate) return;
  const data = parsedData;
  const onlyFreeInput = onlyFreeCandidate;

  const controls = {
    from: form.elements.namedItem("from") as HTMLInputElement,
    to: form.elements.namedItem("to") as HTMLInputElement,
    format: form.elements.namedItem("format") as HTMLSelectElement,
    district: form.elements.namedItem("district") as HTMLSelectElement,
    lighting: form.elements.namedItem("lighting") as HTMLSelectElement,
    sideCount: form.elements.namedItem("sideCount") as HTMLSelectElement,
    priceFrom: form.elements.namedItem("priceFrom") as HTMLInputElement,
    priceTo: form.elements.namedItem("priceTo") as HTMLInputElement,
  };

  const today = localDate(new Date());
  controls.from.min = today;
  controls.to.min = today;
  const query = new URLSearchParams(location.search);
  (["from", "to", "format", "district", "lighting", "sideCount", "priceFrom", "priceTo"] as const).forEach((name) => {
    const value = query.get(name);
    if (value != null) controls[name].value = value;
  });
  onlyFreeInput.checked = query.get("onlyFree") === "1";
  if (controls.from.value) controls.to.min = controls.from.value;

  let availability: Map<string, AvailabilityEntry> | null = null;
  let availabilityError = false;
  let availabilityRequest = 0;
  let availabilityController: AbortController | null = null;
  let visibleItems = [...data.items];
  let map: unknown = null;
  const placemarks = new Map<string, unknown>();
  let selectedId = "";

  const filters = (): Filters => {
    const values = new FormData(form);
    return {
      from: String(values.get("from") || ""),
      to: String(values.get("to") || ""),
      format: String(values.get("format") || ""),
      district: String(values.get("district") || ""),
      lighting: String(values.get("lighting") || ""),
      sideCount: String(values.get("sideCount") || ""),
      priceFrom: numberOrNull(values.get("priceFrom")),
      priceTo: numberOrNull(values.get("priceTo")),
      onlyFree: onlyFreeInput.checked && availability !== null,
    };
  };

  const matches = (item: CatalogItem, active: Filters): boolean => {
    if (active.format && item.format !== active.format) return false;
    if (active.district && item.district !== active.district) return false;
    if (active.lighting && item.lighting !== active.lighting) return false;
    if (active.sideCount && item.sideCount !== Number(active.sideCount)) return false;
    if (active.priceFrom != null || active.priceTo != null) {
      const prices = item.sides.map((side) => side.effectivePricePerMonth).filter((price): price is number => typeof price === "number");
      if (!prices.length && item.pricePerMonth != null) prices.push(item.pricePerMonth);
      if (!prices.some((price) => (active.priceFrom == null || price >= active.priceFrom) && (active.priceTo == null || price <= active.priceTo))) return false;
    }
    if (active.onlyFree && availability?.get(item.id)?.status !== "free") return false;
    return true;
  };

  const markerColor = (id: string): string => {
    if (id === selectedId) return "#8B0000";
    const status = availability?.get(id)?.status;
    if (status === "free") return "#17643c";
    if (status === "partial") return "#8a5412";
    if (status === "occupied") return "#77736c";
    return "#333330";
  };

  const setSelected = (id: string) => {
    selectedId = id;
    document.querySelectorAll<HTMLElement>("[data-construction-card]").forEach((card) => {
      card.classList.toggle("is-map-active", card.dataset.constructionCard === id);
    });
    placemarks.forEach((placemark, markerId) => {
      (placemark as { options: { set: (name: string, value: string) => void } }).options.set("iconColor", markerColor(markerId));
    });
  };

  const setMobileView = (view: "list" | "map") => {
    layout.dataset.view = view;
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.view === view ? "true" : "false");
    });
    if (view === "map") window.setTimeout(() => (map as { container?: { fitToViewport: () => void } } | null)?.container?.fitToViewport(), 0);
  };
  setMobileView(location.hash === "#map" && matchMedia("(max-width: 900px)").matches ? "map" : "list");
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => setMobileView(button.dataset.view === "map" ? "map" : "list")));

  const annotateCards = () => {
    document.querySelectorAll<HTMLElement>("[data-construction-card]").forEach((card) => {
      const node = card.querySelector<HTMLElement>("[data-card-availability]");
      if (!node) return;
      const entry = availability?.get(card.dataset.constructionCard || "");
      if (availabilityError) {
        node.textContent = "Доступность недоступна";
        node.removeAttribute("data-state");
      } else if (!controls.from.value || !controls.to.value) {
        node.textContent = "Уточните период";
        node.removeAttribute("data-state");
      } else if (!entry) {
        node.textContent = "Проверяем…";
        node.removeAttribute("data-state");
      } else {
        node.textContent = STATUS_LABEL[entry.status];
        node.dataset.state = entry.status;
      }
    });
  };

  const renderButtons = () => {
    const keys = new Set(readShortlist().map(shortlistKey));
    document.querySelectorAll<HTMLButtonElement>("[data-card-add]").forEach((button) => {
      const item = data.items.find((entry) => entry.id === button.dataset.cardAdd);
      const freeSide = availability?.get(item?.id || "")?.sides.find((side) => side.status === "free")?.code;
      const sideCode = freeSide ?? item?.sides[0]?.code;
      const added = !!item && !!sideCode && keys.has(`${item.id}:${sideCode}`);
      button.classList.toggle("is-added", added);
      const label = button.querySelector<HTMLElement>("[data-card-add-label]");
      if (label && !item?.isSoon) label.textContent = added ? "Добавлено" : "В подборку";
    });
  };
  renderButtons();
  onShortlistChange(renderButtons);

  const addItem = (id: string) => {
    const item = data.items.find((entry) => entry.id === id);
    if (!item || item.isSoon) return;
    const freeCode = availability?.get(id)?.sides.find((side) => side.status === "free")?.code;
    const side = item.sides.find((entry) => entry.code === freeCode) ?? item.sides[0];
    if (!side) return;
    upsertShortlist({
      constructionId: item.id,
      slug: item.slug,
      name: item.name,
      code: item.code,
      address: item.address,
      image: item.img,
      sideCode: side.code as "A" | "B" | "C",
      sides: item.sides.map((entry) => ({ code: entry.code as "A" | "B" | "C", label: `Сторона ${entry.code}`, priceLabel: entry.priceLabel })),
      from: controls.from.value,
      to: controls.to.value,
      priceLabel: side.priceLabel,
    });
  };

  const updateQuery = (active: Filters) => {
    const params = new URLSearchParams();
    (["from", "to", "format", "district", "lighting", "sideCount"] as const).forEach((name) => {
      if (active[name]) params.set(name, active[name]);
    });
    if (active.priceFrom != null) params.set("priceFrom", String(active.priceFrom));
    if (active.priceTo != null) params.set("priceTo", String(active.priceTo));
    if (onlyFreeInput.checked) params.set("onlyFree", "1");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  };

  const optionText = (control: HTMLSelectElement): string => control.selectedOptions[0]?.textContent?.trim() || "";
  const renderChips = (active: Filters) => {
    const node = document.querySelector<HTMLElement>("[data-filter-chips]");
    if (!node) return;
    const chips: { key: string; label: string }[] = [];
    if (active.from || active.to) chips.push({ key: "period", label: `Период: ${active.from ? shortDate(active.from) : "…"}–${active.to ? shortDate(active.to) : "…"}` });
    if (active.format) chips.push({ key: "format", label: optionText(controls.format) });
    if (active.district) chips.push({ key: "district", label: active.district });
    if (active.lighting) chips.push({ key: "lighting", label: optionText(controls.lighting) });
    if (active.sideCount) chips.push({ key: "sideCount", label: optionText(controls.sideCount) });
    if (active.priceFrom != null || active.priceTo != null) chips.push({ key: "price", label: `Цена: ${active.priceFrom?.toLocaleString("ru-RU") ?? "0"}–${active.priceTo?.toLocaleString("ru-RU") ?? "∞"} ₽` });
    if (onlyFreeInput.checked) chips.push({ key: "onlyFree", label: "Только свободные" });
    node.replaceChildren(...chips.map((chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-chip";
      button.dataset.clearFilter = chip.key;
      button.setAttribute("aria-label", `Удалить фильтр: ${chip.label}`);
      button.append(document.createTextNode(chip.label));
      const close = document.createElement("span");
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");
      button.append(close);
      return button;
    }));
  };

  const balloon = (item: CatalogItem): string => {
    const entry = availability?.get(item.id);
    const sideText = entry?.sides.map((side) => `${side.code}: ${side.status === "free" ? "свободно" : side.status === "partiallyOccupied" ? "частично" : "занято"}`).join(" · ") || "Даты не выбраны";
    return `${escapeHtml(item.address)}<br>${escapeHtml(item.formatLabel)} · ${escapeHtml(item.priceLabel)}<br><strong>${escapeHtml(sideText)}</strong>`;
  };

  const renderMap = () => {
    if (!map) return;
    const ymaps = (window as typeof window & { ymaps: { Placemark: new (coords: [number, number], properties: object, options: object) => unknown } }).ymaps;
    const mapObject = map as { geoObjects: { removeAll: () => void; add: (object: unknown) => void }; setBounds: (bounds: [number, number][], options: object) => void };
    mapObject.geoObjects.removeAll();
    placemarks.clear();
    const coords: [number, number][] = [];
    visibleItems.forEach((item) => {
      if (typeof item.lat !== "number" || typeof item.lng !== "number") return;
      coords.push([item.lat, item.lng]);
      const placemark = new ymaps.Placemark(
        [item.lat, item.lng],
        {
          hintContent: escapeHtml(`${item.code} · ${item.name}`),
          balloonContentHeader: escapeHtml(item.name),
          balloonContentBody: balloon(item),
          balloonContentFooter: item.isSoon ? "Карточка появится позже" : `<a href="${escapeHtml(item.href)}">Подробнее о конструкции</a>`,
        },
        { preset: "islands#circleDotIcon", iconColor: markerColor(item.id) },
      );
      (placemark as { events: { add: (name: string, callback: () => void) => void } }).events.add("click", () => {
        setSelected(item.id);
        if (matchMedia("(max-width: 900px)").matches) setMobileView("list");
        const card = document.querySelector<HTMLElement>(`[data-construction-card="${CSS.escape(item.id)}"]`);
        card?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      });
      placemarks.set(item.id, placemark);
      mapObject.geoObjects.add(placemark);
    });
    if (coords.length > 1 && !selectedId) mapObject.setBounds(coords, { checkZoomRange: true, zoomMargin: 40 });
    const count = document.querySelector<HTMLElement>("[data-map-count]");
    if (count) count.textContent = `${coords.length} ${coords.length === 1 ? "точка" : coords.length < 5 ? "точки" : "точек"}`;
  };

  const apply = () => {
    const active = filters();
    visibleItems = data.items.filter((item) => matches(item, active));
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    document.querySelectorAll<HTMLElement>("[data-construction-card]").forEach((card) => {
      card.hidden = !visibleIds.has(card.dataset.constructionCard || "");
    });
    if (selectedId && !visibleIds.has(selectedId)) setSelected("");
    if (emptyNode) emptyNode.hidden = visibleItems.length !== 0;
    const suffix = availabilityError ? " · доступность временно недоступна" : availability ? ` · период ${shortDate(active.from)}–${shortDate(active.to)}` : "";
    statusNode.textContent = `Найдено ${visibleItems.length} ${plural(visibleItems.length)}${suffix}`;
    renderChips(active);
    updateQuery(active);
    renderMap();
  };

  const clearFilter = (key: string) => {
    if (key === "period") { controls.from.value = ""; controls.to.value = ""; }
    else if (key === "price") { controls.priceFrom.value = ""; controls.priceTo.value = ""; }
    else if (key === "onlyFree") onlyFreeInput.checked = false;
    else if (key in controls) controls[key as keyof typeof controls].value = "";
    if (key === "period") void refreshAvailability();
    else apply();
  };

  const reset = () => {
    form.reset();
    controls.to.min = today;
    availability = null;
    availabilityError = false;
    onlyFreeInput.disabled = true;
    availabilityController?.abort();
    annotateCards();
    apply();
  };

  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    const chip = target.closest<HTMLButtonElement>("[data-clear-filter]");
    if (chip?.dataset.clearFilter) clearFilter(chip.dataset.clearFilter);
    if (target.closest("[data-filter-reset]")) reset();
    const add = target.closest<HTMLButtonElement>("[data-card-add]");
    if (add?.dataset.cardAdd) addItem(add.dataset.cardAdd);
    const mapButton = target.closest<HTMLButtonElement>("[data-map-focus]");
    if (mapButton?.dataset.mapFocus) {
      const item = data.items.find((entry) => entry.id === mapButton.dataset.mapFocus);
      const placemark = placemarks.get(mapButton.dataset.mapFocus);
      if (item && placemark && map && item.lat != null && item.lng != null) {
        setSelected(item.id);
        if (matchMedia("(max-width: 900px)").matches) setMobileView("map");
        const mapObject = map as { setCenter: (coords: [number, number], zoom: number) => void; getZoom: () => number };
        mapObject.setCenter([item.lat, item.lng], Math.max(mapObject.getZoom(), 15));
        (placemark as { balloon: { open: () => void } }).balloon.open();
        document.getElementById("catalog-map")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      }
    }
  });

  document.querySelector<HTMLElement>("[data-catalog-cards]")?.addEventListener("pointerover", (event) => {
    const card = (event.target as Element).closest<HTMLElement>("[data-construction-card]");
    if (card?.dataset.constructionCard) setSelected(card.dataset.constructionCard);
  });
  document.querySelector<HTMLElement>("[data-catalog-cards]")?.addEventListener("focusin", (event) => {
    const card = (event.target as Element).closest<HTMLElement>("[data-construction-card]");
    if (card?.dataset.constructionCard) setSelected(card.dataset.constructionCard);
  });

  let priceTimer = 0;
  form.addEventListener("input", (event) => {
    const name = (event.target as HTMLInputElement).name;
    if (name === "priceFrom" || name === "priceTo") {
      window.clearTimeout(priceTimer);
      priceTimer = window.setTimeout(apply, 180);
    }
  });
  form.addEventListener("change", (event) => {
    const name = (event.target as HTMLInputElement).name;
    if (name === "from") {
      controls.to.min = controls.from.value || today;
      if (controls.to.value && controls.from.value && controls.to.value < controls.from.value) controls.to.value = "";
    }
    if (name === "from" || name === "to") void refreshAvailability();
    else apply();
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  async function refreshAvailability(): Promise<void> {
    const from = controls.from.value;
    const to = controls.to.value;
    const request = ++availabilityRequest;
    availabilityController?.abort();
    availabilityController = null;
    availabilityError = false;
    availability = null;
    onlyFreeInput.disabled = true;
    if (!from || !to) {
      onlyFreeInput.checked = false;
      annotateCards();
      if (loadingNode) loadingNode.hidden = true;
      apply();
      return;
    }
    if (from > to) {
      controls.to.setCustomValidity("Окончание периода должно быть позже начала");
      controls.to.reportValidity();
      annotateCards();
      if (loadingNode) loadingNode.hidden = true;
      apply();
      return;
    }
    controls.to.setCustomValidity("");
    const controller = new AbortController();
    availabilityController = controller;
    if (loadingNode) loadingNode.hidden = false;
    annotateCards();
    apply();
    try {
      const response = await fetch(`${site.apiUrl}/api/public/construction-availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(addDays(to, 1))}`, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items?: { id: string; sides: AvailabilitySide[] }[] };
      if (request !== availabilityRequest) return;
      availability = new Map((body.items ?? []).map((entry) => [entry.id, { sides: entry.sides, status: aggregate(entry.sides) }]));
      onlyFreeInput.disabled = false;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (request !== availabilityRequest) return;
      availabilityError = true;
      availability = null;
      onlyFreeInput.checked = false;
      onlyFreeInput.disabled = true;
    } finally {
      if (request === availabilityRequest) {
        availabilityController = null;
        if (loadingNode) loadingNode.hidden = true;
        annotateCards();
        renderButtons();
        apply();
      }
    }
  }

  async function setupMap(): Promise<void> {
    const node = document.getElementById("catalog-map");
    const note = document.querySelector<HTMLElement>("[data-map-note]");
    if (!node) return;
    if (!data.items.some((item) => item.lat != null && item.lng != null)) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) { message.querySelector("strong")!.textContent = "Координаты пока не опубликованы"; message.querySelector("p")!.textContent = "Используйте список конструкций."; }
      if (note) note.textContent = "У опубликованных конструкций пока нет координат.";
      return;
    }
    try {
      const loaded = await loadYandexMaps(data.map.apiKey);
      await waitYMapsReady(loaded);
      const ymaps = loaded as { Map: new (node: HTMLElement, state: object, options: object) => unknown };
      node.innerHTML = "";
      map = new ymaps.Map(node, { center: data.map.center, zoom: data.map.zoom, controls: ["zoomControl", "fullscreenControl"] }, { suppressMapOpenBlock: true });
      renderMap();
    } catch (error) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) {
        const title = message.querySelector("strong");
        const text = message.querySelector("p");
        if (title) title.textContent = "Карта сейчас недоступна";
        if (text) text.textContent = error instanceof MapUnavailableError ? error.message : "Все позиции доступны в списке.";
      }
      if (note) note.textContent = "Карта недоступна — фильтры и список продолжают работать.";
    }
  }

  annotateCards();
  apply();
  void setupMap();
  if (controls.from.value && controls.to.value) void refreshAvailability();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
