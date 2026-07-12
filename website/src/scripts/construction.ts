import type { Construction } from "../lib/api";
import { onShortlistChange, readShortlist, shortlistKey, upsertShortlist } from "./shortlist";
import { loadYandexMaps, MapUnavailableError, waitYMapsReady } from "./yandex-map";

type SideCode = "A" | "B" | "C";
type ApiStatus = "free" | "partiallyOccupied" | "occupied";
type UiStatus = "free" | "partial" | "occupied";

interface AvailabilitySide {
  id: string;
  code: SideCode;
  description: string | null;
  status: ApiStatus;
  busyIntervals: { startDate: string; endDate: string }[];
}

interface DetailData {
  construction: Construction;
  map: { apiKey: string; zoom: number };
}

const API_STATUS_TEXT: Record<ApiStatus, string> = {
  free: "Свободно",
  partiallyOccupied: "Частично занято",
  occupied: "Занято",
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

function uiStatus(status: ApiStatus): UiStatus {
  return status === "partiallyOccupied" ? "partial" : status;
}

function reachLabel(traffic: number | null, grp: number | null): string {
  if (grp != null) return `GRP ${grp}`;
  if (traffic != null) return `${new Intl.NumberFormat("ru-RU").format(traffic)} чел./день`;
  return "По запросу";
}

function init(): void {
  const parsed = parseJson<DetailData>("construction-data");
  const site = parseJson<{ apiUrl: string }>("site-config") ?? { apiUrl: "" };
  const fromCandidate = document.querySelector<HTMLInputElement>("[data-detail-from]");
  const toCandidate = document.querySelector<HTMLInputElement>("[data-detail-to]");
  const statusCandidate = document.querySelector<HTMLElement>("[data-detail-status]");
  const addCandidate = document.querySelector<HTMLButtonElement>("[data-detail-add]");
  const calendarCandidate = document.querySelector<HTMLElement>("[data-availability-calendar]");
  if (!parsed || !fromCandidate || !toCandidate || !statusCandidate || !addCandidate || !calendarCandidate) return;
  const data = parsed;
  const fromInput = fromCandidate;
  const toInput = toCandidate;
  const statusNode = statusCandidate;
  const addButton = addCandidate;
  const calendar = calendarCandidate;
  const construction = data.construction;
  let currentSide = construction.sides[0]?.code as SideCode | undefined;
  let availability = new Map<SideCode, AvailabilitySide>();
  let loading = false;
  let availabilityError = false;
  let requestIndex = 0;
  let controller: AbortController | null = null;

  const today = localDate(new Date());
  fromInput.min = today;
  toInput.min = today;
  fromInput.value = addDays(today, 7);
  toInput.value = addDays(fromInput.value, 30);

  const side = () => construction.sides.find((entry) => entry.code === currentSide);

  const setMainImage = (url: string, srcset = "", alt = "") => {
    const image = document.querySelector<HTMLImageElement>("[data-gallery-main]");
    if (!image || !url) return;
    image.src = url;
    if (srcset) image.srcset = srcset;
    else image.removeAttribute("srcset");
    image.alt = alt || `Конструкция ${construction.name}, сторона ${currentSide || "A"}`;
    document.querySelectorAll<HTMLButtonElement>("[data-gallery-index]").forEach((button) => {
      const galleryImage = construction.images[Number(button.dataset.galleryIndex)];
      button.setAttribute("aria-pressed", galleryImage?.url === url ? "true" : "false");
    });
  };

  const selectedStatus = (): AvailabilitySide | undefined => currentSide ? availability.get(currentSide) : undefined;

  const updateFormSummary = () => {
    const hidden = document.querySelector<HTMLInputElement>('[data-lead-form] input[name="selectionSummary"]');
    if (!hidden) return;
    const period = fromInput.value && toInput.value ? `${shortDate(fromInput.value)}–${shortDate(toInput.value)}` : "не указан";
    hidden.value = `Запрошенная позиция:\n${construction.code || construction.name} · ${construction.name}\nСторона: ${currentSide || "не выбрана"}\nПериод: ${period}`;
  };

  const updateAddButton = () => {
    const label = addButton.querySelector<HTMLElement>("[data-detail-add-label]");
    if (!label) return;
    if (!currentSide) {
      addButton.disabled = true;
      label.textContent = "Стороны пока не опубликованы";
      return;
    }
    const status = selectedStatus()?.status;
    const added = new Set(readShortlist().map(shortlistKey)).has(`${construction.id}:${currentSide}`);
    addButton.classList.toggle("is-added", added);
    addButton.disabled = loading || status === "occupied";
    if (loading) label.textContent = "Проверяем даты…";
    else if (status === "occupied") label.textContent = "Сторона занята на весь период";
    else if (added) label.textContent = "Сторона в подборке";
    else label.textContent = "Добавить сторону в подборку";
  };

  const updateSideContent = () => {
    const current = side();
    document.querySelectorAll<HTMLButtonElement>("[data-side-button]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.sideButton === currentSide ? "true" : "false");
    });
    const description = document.querySelector<HTMLElement>("[data-side-description]");
    const price = document.querySelector<HTMLElement>("[data-side-price]");
    const reach = document.querySelector<HTMLElement>("[data-side-reach]");
    const calendarSide = document.querySelector<HTMLElement>("[data-calendar-side]");
    if (description) description.textContent = current?.description || "Описание направления уточняется";
    if (price) price.textContent = current?.priceLabel || construction.priceLabel;
    if (reach) reach.textContent = reachLabel(current?.trafficPerDay ?? construction.trafficPerDay, current?.grp ?? construction.grp);
    if (calendarSide) calendarSide.textContent = current?.code || "—";
    const photo = current?.photo ?? construction.cover ?? construction.images[0];
    if (photo) setMainImage(photo.url, photo.renditions?.srcset || "", `Конструкция ${construction.name}, сторона ${current?.code || "A"}`);
    updateFormSummary();
    updateAddButton();
    renderCalendar();
  };

  const updateAvailabilityUI = () => {
    construction.sides.forEach((entry) => {
      const node = document.querySelector<HTMLElement>(`[data-side-status="${entry.code}"]`);
      if (!node) return;
      const item = availability.get(entry.code as SideCode);
      if (loading) node.textContent = "Проверяем…";
      else if (availabilityError) node.textContent = "Нет данных";
      else node.textContent = item ? API_STATUS_TEXT[item.status] : "Нет данных";
    });
    const current = selectedStatus();
    if (loading) {
      statusNode.textContent = "Проверяем доступность по действующим броням…";
      statusNode.removeAttribute("data-state");
    } else if (availabilityError) {
      statusNode.textContent = "Не удалось получить занятость. Попробуйте изменить даты или обновить страницу.";
      statusNode.removeAttribute("data-state");
    } else if (current) {
      statusNode.textContent = `${API_STATUS_TEXT[current.status]} · сторона ${current.code} · ${shortDate(fromInput.value)}–${shortDate(toInput.value)}`;
      statusNode.dataset.state = uiStatus(current.status);
    } else {
      statusNode.textContent = "Данные по стороне пока не опубликованы";
      statusNode.removeAttribute("data-state");
    }
    updateAddButton();
  };

  const isBusy = (value: string, intervals: AvailabilitySide["busyIntervals"]): boolean =>
    intervals.some((interval) => value >= interval.startDate && value <= interval.endDate);

  function renderCalendar(): void {
    calendar.replaceChildren();
    const note = document.querySelector<HTMLElement>("[data-calendar-note]");
    if (loading) {
      const message = document.createElement("p");
      message.className = "availability-message";
      message.textContent = "Загружаем календарь…";
      calendar.append(message);
      if (note) note.textContent = "Данные загружаются по выбранному периоду.";
      return;
    }
    if (availabilityError) {
      const message = document.createElement("p");
      message.className = "availability-message";
      message.textContent = "Календарь временно недоступен.";
      calendar.append(message);
      if (note) note.textContent = "Попробуйте повторить проверку позже.";
      return;
    }
    if (!fromInput.value || !toInput.value || fromInput.value > toInput.value) return;
    const current = selectedStatus();
    const intervals = current?.busyIntervals ?? [];
    const first = new Date(`${fromInput.value}T12:00:00`);
    const requestedEnd = new Date(`${toInput.value}T12:00:00`);
    const cap = new Date(first);
    cap.setDate(cap.getDate() + 123);
    const end = requestedEnd > cap ? cap : requestedEnd;
    const months: { year: number; month: number }[] = [];
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1, 12);
    while (cursor <= end) {
      months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    months.forEach(({ year, month }) => {
      const section = document.createElement("section");
      section.className = "availability-month";
      const heading = document.createElement("h3");
      heading.textContent = new Date(year, month, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
      const weekdays = document.createElement("div");
      weekdays.className = "availability-weekdays";
      ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].forEach((day) => {
        const label = document.createElement("span");
        label.textContent = day;
        weekdays.append(label);
      });
      const days = document.createElement("div");
      days.className = "availability-days";
      const offset = (new Date(year, month, 1).getDay() + 6) % 7;
      const total = new Date(year, month + 1, 0).getDate();
      for (let index = 0; index < offset; index += 1) {
        const blank = document.createElement("span");
        blank.className = "availability-day";
        blank.dataset.outside = "true";
        days.append(blank);
      }
      for (let day = 1; day <= total; day += 1) {
        const date = new Date(year, month, day, 12);
        const value = localDate(date);
        const cell = document.createElement("span");
        const busy = isBusy(value, intervals);
        cell.className = "availability-day";
        cell.dataset.state = busy ? "busy" : "free";
        if (value === today) cell.dataset.today = "true";
        cell.textContent = String(day);
        cell.setAttribute("aria-label", `${date.toLocaleDateString("ru-RU")}: ${busy ? "занято" : "свободно"}`);
        if (date < first || date > end) cell.dataset.outside = "true";
        days.append(cell);
      }
      section.append(heading, weekdays, days);
      calendar.append(section);
    });
    if (note) note.textContent = requestedEnd > cap
      ? "Показаны первые 124 дня выбранного периода. Полный статус учтён выше."
      : current ? `${API_STATUS_TEXT[current.status]}. Занятые даты отмечены текстом и зачёркиванием.` : "Интервалы занятости не найдены.";
  }

  const fetchAvailability = async () => {
    if (!fromInput.value || !toInput.value) return;
    if (fromInput.value > toInput.value) {
      toInput.setCustomValidity("Окончание периода должно быть позже начала");
      toInput.reportValidity();
      return;
    }
    toInput.setCustomValidity("");
    const request = ++requestIndex;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    availabilityError = false;
    availability.clear();
    updateAvailabilityUI();
    renderCalendar();
    try {
      const response = await fetch(`${site.apiUrl}/api/public/construction-availability?from=${encodeURIComponent(fromInput.value)}&to=${encodeURIComponent(addDays(toInput.value, 1))}`, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items?: { id: string; sides: AvailabilitySide[] }[] };
      if (request !== requestIndex) return;
      const item = body.items?.find((entry) => entry.id === construction.id);
      availability = new Map((item?.sides ?? []).map((entry) => [entry.code, entry]));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (request !== requestIndex) return;
      availabilityError = true;
      availability.clear();
    } finally {
      if (request === requestIndex) {
        loading = false;
        controller = null;
        updateAvailabilityUI();
        renderCalendar();
      }
    }
  };

  document.querySelectorAll<HTMLButtonElement>("[data-side-button]").forEach((button) => {
    button.addEventListener("click", () => {
      currentSide = button.dataset.sideButton as SideCode;
      updateSideContent();
      updateAvailabilityUI();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-gallery-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const image = construction.images[Number(button.dataset.galleryIndex)];
      if (image) setMainImage(image.url, image.renditions?.srcset || "", `${construction.name}, фотография ${Number(button.dataset.galleryIndex) + 1}`);
    });
  });

  fromInput.addEventListener("change", () => {
    toInput.min = fromInput.value || today;
    if (toInput.value && toInput.value < fromInput.value) toInput.value = addDays(fromInput.value, 30);
    updateFormSummary();
    void fetchAvailability();
  });
  toInput.addEventListener("change", () => { updateFormSummary(); void fetchAvailability(); });

  addButton.addEventListener("click", () => {
    const current = side();
    if (!current || !currentSide) return;
    upsertShortlist({
      constructionId: construction.id,
      slug: construction.slug,
      name: construction.name,
      code: construction.code || "",
      address: construction.address || "Грозный",
      image: current.photo?.url || construction.cover?.url || construction.images[0]?.url || "",
      sideCode: currentSide,
      sides: construction.sides.map((entry) => ({ code: entry.code, label: entry.description ? `Сторона ${entry.code} · ${entry.description}` : `Сторона ${entry.code}`, priceLabel: entry.priceLabel })),
      from: fromInput.value,
      to: toInput.value,
      priceLabel: current.priceLabel,
    });
  });
  onShortlistChange(updateAddButton);

  const setupMap = async () => {
    const node = document.getElementById("construction-map");
    if (!node) return;
    if (construction.lat == null || construction.lng == null) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) {
        const title = message.querySelector("strong");
        const text = message.querySelector("p");
        if (title) title.textContent = "Координаты уточняются";
        if (text) text.textContent = "Адрес конструкции указан рядом с картой.";
      }
      return;
    }
    try {
      const loaded = await loadYandexMaps(data.map.apiKey);
      await waitYMapsReady(loaded);
      const ymaps = loaded as {
        Map: new (node: HTMLElement, state: object, options: object) => { geoObjects: { add: (item: unknown) => void } };
        Placemark: new (coords: [number, number], properties: object, options: object) => unknown;
      };
      node.innerHTML = "";
      const map = new ymaps.Map(node, { center: [construction.lat, construction.lng], zoom: data.map.zoom, controls: ["zoomControl", "fullscreenControl"] }, { suppressMapOpenBlock: true });
      map.geoObjects.add(new ymaps.Placemark([construction.lat, construction.lng], { hintContent: `${construction.code || ""} ${construction.name}`, balloonContent: construction.address || construction.name }, { preset: "islands#circleDotIcon", iconColor: "#8B0000" }));
    } catch (error) {
      const message = node.querySelector<HTMLElement>("[data-map-message]");
      if (message) {
        const title = message.querySelector("strong");
        const text = message.querySelector("p");
        if (title) title.textContent = "Карта сейчас недоступна";
        if (text) text.textContent = error instanceof MapUnavailableError ? error.message : "Откройте маршрут по ссылке рядом.";
      }
    }
  };

  updateSideContent();
  updateAvailabilityUI();
  void fetchAvailability();
  void setupMap();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
