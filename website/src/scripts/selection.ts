import {
  clearShortlist,
  onShortlistChange,
  readShortlist,
  removeShortlistItem,
  replaceShortlistItem,
  shortlistKey,
  type ShortlistItem,
} from "./shortlist";

type Status = "free" | "partial" | "occupied";
interface AvailabilitySide { code: "A" | "B" | "C"; status: "free" | "partiallyOccupied" | "occupied"; }

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

function aggregate(status: AvailabilitySide["status"] | undefined): Status | null {
  if (status === "free") return "free";
  if (status === "partiallyOccupied") return "partial";
  if (status === "occupied") return "occupied";
  return null;
}

function plural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function itemNode(item: ShortlistItem): HTMLElement {
  const key = shortlistKey(item);
  const article = element("article", "selection-item");
  article.dataset.selectionKey = key;

  const media = element("div", "selection-item__media");
  if (item.image) {
    const image = element("img");
    image.src = item.image;
    image.alt = `Конструкция ${item.name}, сторона ${item.sideCode}`;
    image.loading = "lazy";
    media.append(image);
  } else media.append(element("span", "", item.code || "Фото готовится"));

  const body = element("div", "selection-item__body");
  body.append(element("span", "selection-item__code", item.code || "Код уточняется"));
  body.append(element("h3", "", item.name));
  body.append(element("p", "selection-item__address", item.address));
  const edit = element("div", "selection-item__edit");

  const sideLabel = element("label");
  sideLabel.append(element("span", "", "Сторона"));
  const sideSelect = element("select");
  sideSelect.dataset.selectionSide = key;
  item.sides.forEach((side) => {
    const option = element("option");
    option.value = side.code;
    option.textContent = side.code;
    option.selected = side.code === item.sideCode;
    sideSelect.append(option);
  });
  sideLabel.append(sideSelect);

  const today = localDate(new Date());
  const fromLabel = element("label");
  fromLabel.append(element("span", "", "Начало"));
  const from = element("input");
  from.type = "date";
  from.value = item.from;
  from.min = today;
  from.dataset.selectionFrom = key;
  fromLabel.append(from);

  const toLabel = element("label");
  toLabel.append(element("span", "", "Окончание"));
  const to = element("input");
  to.type = "date";
  to.value = item.to;
  to.min = item.from || today;
  to.dataset.selectionTo = key;
  toLabel.append(to);
  edit.append(sideLabel, fromLabel, toLabel);
  body.append(edit);

  const aside = element("div", "selection-item__aside");
  aside.append(element("span", "", "Цена стороны"));
  aside.append(element("strong", "", item.priceLabel));
  const status = element("p", "selection-item__status", item.from && item.to ? "Проверяем доступность…" : "Укажите период");
  status.dataset.selectionStatus = key;
  aside.append(status);
  const actions = element("div", "selection-item__actions");
  const link = element("a", "", "Открыть карточку ↗");
  link.href = `/constructions/${encodeURIComponent(item.slug)}`;
  const remove = element("button", "", "Удалить");
  remove.type = "button";
  remove.dataset.selectionRemove = key;
  actions.append(link, remove);
  aside.append(actions);

  article.append(media, body, aside);
  return article;
}

function init(): void {
  const site = parseJson<{ apiUrl: string }>("site-config") ?? { apiUrl: "" };
  const listCandidate = document.querySelector<HTMLElement>("[data-selection-list]");
  const contentCandidate = document.querySelector<HTMLElement>("[data-selection-content]");
  const emptyCandidate = document.querySelector<HTMLElement>("[data-selection-empty]");
  const requestCandidate = document.querySelector<HTMLElement>("[data-selection-request]");
  const checkCandidate = document.querySelector<HTMLElement>("[data-selection-check]");
  if (!listCandidate || !contentCandidate || !emptyCandidate || !requestCandidate || !checkCandidate) return;
  const list = listCandidate;
  const content = contentCandidate;
  const empty = emptyCandidate;
  const request = requestCandidate;
  const check = checkCandidate;
  let generation = 0;
  let controllers: AbortController[] = [];

  const render = (items = readShortlist()) => {
    const hasItems = items.length > 0;
    content.hidden = !hasItems;
    request.hidden = !hasItems;
    empty.hidden = hasItems;
    list.replaceChildren(...items.map(itemNode));
    document.querySelectorAll<HTMLElement>("[data-selection-count]").forEach((node) => { node.textContent = String(items.length); });
    document.querySelectorAll<HTMLElement>("[data-selection-count-label]").forEach((node) => { node.textContent = plural(items.length); });
    if (hasItems) void checkAvailability(items);
  };

  const update = (key: string) => {
    const item = readShortlist().find((entry) => shortlistKey(entry) === key);
    const row = list.querySelector<HTMLElement>(`[data-selection-key="${CSS.escape(key)}"]`);
    if (!item || !row) return;
    const sideCode = row.querySelector<HTMLSelectElement>("[data-selection-side]")?.value as ShortlistItem["sideCode"] | undefined;
    const from = row.querySelector<HTMLInputElement>("[data-selection-from]")?.value ?? item.from;
    const to = row.querySelector<HTMLInputElement>("[data-selection-to]")?.value ?? item.to;
    const selected = item.sides.find((side) => side.code === sideCode) ?? item.sides[0];
    if (!selected) return;
    replaceShortlistItem(key, { ...item, sideCode: selected.code, from, to, priceLabel: selected.priceLabel });
  };

  list.addEventListener("change", (event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const row = control.closest<HTMLElement>("[data-selection-key]");
    if (!row?.dataset.selectionKey) return;
    if (control.matches("[data-selection-from]")) {
      const to = row.querySelector<HTMLInputElement>("[data-selection-to]");
      if (to) {
        to.min = control.value || localDate(new Date());
        if (to.value && to.value < control.value) to.value = addDays(control.value, 30);
      }
    }
    update(row.dataset.selectionKey);
  });
  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-selection-remove]");
    if (button?.dataset.selectionRemove) removeShortlistItem(button.dataset.selectionRemove);
  });
  document.querySelector<HTMLButtonElement>("[data-selection-clear]")?.addEventListener("click", () => clearShortlist());
  onShortlistChange(render);

  async function checkAvailability(items: ShortlistItem[]): Promise<void> {
    const currentGeneration = ++generation;
    controllers.forEach((controller) => controller.abort());
    controllers = [];
    const valid = items.filter((item) => item.from && item.to && item.from <= item.to);
    const groups = new Map<string, ShortlistItem[]>();
    valid.forEach((item) => {
      const key = `${item.from}:${item.to}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    if (!groups.size) {
      check.textContent = "Укажите период у каждой позиции, чтобы проверить доступность.";
      return;
    }
    check.textContent = "Проверяем выбранные стороны по действующим броням…";
    let available = 0;
    let partial = 0;
    let occupied = 0;
    let failed = 0;

    await Promise.all(Array.from(groups.values()).map(async (group) => {
      const first = group[0];
      const controller = new AbortController();
      controllers.push(controller);
      try {
        const response = await fetch(`${site.apiUrl}/api/public/construction-availability?from=${encodeURIComponent(first.from)}&to=${encodeURIComponent(addDays(first.to, 1))}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { items?: { id: string; sides: AvailabilitySide[] }[] };
        if (currentGeneration !== generation) return;
        group.forEach((item) => {
          const construction = body.items?.find((entry) => entry.id === item.constructionId);
          const side = construction?.sides.find((entry) => entry.code === item.sideCode);
          const state = aggregate(side?.status);
          const node = list.querySelector<HTMLElement>(`[data-selection-status="${CSS.escape(shortlistKey(item))}"]`);
          if (!node) return;
          if (state === "free") { available += 1; node.textContent = "Свободно на выбранный период"; }
          else if (state === "partial") { partial += 1; node.textContent = "Частично занято — менеджер уточнит даты"; }
          else if (state === "occupied") { occupied += 1; node.textContent = "Занято на весь выбранный период"; }
          else { failed += 1; node.textContent = "Статус не получен"; }
          if (state) node.dataset.state = state;
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (currentGeneration !== generation) return;
        failed += group.length;
        group.forEach((item) => {
          const node = list.querySelector<HTMLElement>(`[data-selection-status="${CSS.escape(shortlistKey(item))}"]`);
          if (node) node.textContent = "Не удалось проверить доступность";
        });
      }
    }));

    if (currentGeneration !== generation) return;
    const parts = [
      available ? `${available} свободно` : "",
      partial ? `${partial} частично занято` : "",
      occupied ? `${occupied} занято` : "",
      failed ? `${failed} без статуса` : "",
    ].filter(Boolean);
    check.textContent = parts.length ? `Проверка завершена: ${parts.join(" · ")}.` : "Проверка завершена.";
  }

  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
