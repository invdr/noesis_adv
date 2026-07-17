import { sideStatusShort, toUiStatus, type OccupancyStatus, type UiStatus } from "./availability";
import { addDays, minPeriodEnd, todayLocal } from "./dates";
import {
  clearShortlist,
  onShortlistChange,
  readShortlist,
  removeShortlistItem,
  shortlistKey,
  sortSideCodes,
  upsertShortlist,
  type ShortlistItem,
} from "./shortlist";

interface AvailabilitySide { code: "A" | "B" | "C"; status: OccupancyStatus; }

const SIDE_STATUS_TEXT: Record<UiStatus, string> = {
  free: "Свободно на выбранный период",
  partial: "Частично занято — менеджер уточнит даты",
  occupied: "Занято на весь выбранный период",
};

function parseJson<T>(id: string): T | null {
  const node = document.getElementById(id);
  try { return node?.textContent ? JSON.parse(node.textContent) as T : null; } catch { return null; }
}

/* Агрегат по выбранным сторонам позиции: все свободны → free, все заняты →
   occupied, иначе partial (в отличие от правила конструкции «есть свободная
   сторона → свободна» — тут пользователь просит именно эти стороны). */
function selectedAggregate(statuses: UiStatus[]): UiStatus | null {
  if (!statuses.length) return null;
  if (statuses.every((status) => status === "free")) return "free";
  if (statuses.every((status) => status === "occupied")) return "occupied";
  return "partial";
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
    image.alt = `Конструкция ${item.name}, стороны ${item.sideCodes.join(", ")}`;
    image.loading = "lazy";
    media.append(image);
  } else media.append(element("span", "", item.code || "Фото готовится"));

  const body = element("div", "selection-item__body");
  body.append(element("span", "selection-item__code", item.code || "Код уточняется"));
  body.append(element("h3", "", item.name));
  body.append(element("p", "selection-item__address", item.address));
  const edit = element("div", "selection-item__edit");

  const sidesBox = element("div", "selection-item__sides");
  sidesBox.setAttribute("role", "group");
  sidesBox.setAttribute("aria-label", "Выбранные стороны");
  sidesBox.append(element("span", "selection-item__sides-label", "Стороны"));
  item.sides.forEach((side) => {
    const label = element("label", "selection-item__side");
    label.title = side.label;
    const input = element("input");
    input.type = "checkbox";
    input.value = side.code;
    input.checked = item.sideCodes.includes(side.code);
    input.dataset.selectionSideToggle = key;
    label.append(input, element("span", "", side.code));
    sidesBox.append(label);
  });

  const today = todayLocal();
  const dates = element("div", "selection-item__dates");
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
  to.min = minPeriodEnd(item.from || today);
  to.dataset.selectionTo = key;
  toLabel.append(to);
  dates.append(fromLabel, toLabel);
  edit.append(sidesBox, dates);
  body.append(edit);

  const aside = element("div", "selection-item__aside");
  aside.append(element("span", "", item.sideCodes.length > 1 ? "Цена сторон" : "Цена стороны"));
  const prices = element("div", "selection-item__prices");
  item.sideCodes.forEach((code) => {
    const side = item.sides.find((entry) => entry.code === code);
    const label = side?.priceLabel ?? item.priceLabel;
    prices.append(element("strong", "", item.sideCodes.length > 1 ? `${code}: ${label}` : label));
  });
  aside.append(prices);
  const status = element("div", "selection-item__status", "Проверяем доступность…");
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
    const checked = Array.from(row.querySelectorAll<HTMLInputElement>("[data-selection-side-toggle]"))
      .filter((input) => input.checked)
      .map((input) => input.value)
      .filter((value): value is ShortlistItem["sideCodes"][number] => value === "A" || value === "B" || value === "C");
    const sideCodes = sortSideCodes(checked);
    if (!sideCodes.length) {
      // Последнюю сторону снять нельзя — для удаления позиции есть «Удалить».
      render();
      return;
    }
    const from = row.querySelector<HTMLInputElement>("[data-selection-from]")?.value ?? item.from;
    const to = row.querySelector<HTMLInputElement>("[data-selection-to]")?.value ?? item.to;
    upsertShortlist({ ...item, sideCodes, from, to });
  };

  list.addEventListener("change", (event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const row = control.closest<HTMLElement>("[data-selection-key]");
    if (!row?.dataset.selectionKey) return;
    if (control.matches("[data-selection-from]")) {
      const to = row.querySelector<HTMLInputElement>("[data-selection-to]");
      if (to) {
        const minEnd = minPeriodEnd(control.value || todayLocal());
        to.min = minEnd;
        if (!to.value || to.value < minEnd) to.value = minEnd;
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
          const node = list.querySelector<HTMLElement>(`[data-selection-status="${CSS.escape(shortlistKey(item))}"]`);
          if (!node) return;
          const states = item.sideCodes.map((code) => {
            const side = construction?.sides.find((entry) => entry.code === code);
            return { code, status: side?.status ?? null };
          });
          states.forEach(({ status }) => {
            const state = status && toUiStatus(status);
            if (state === "free") available += 1;
            else if (state === "partial") partial += 1;
            else if (state === "occupied") occupied += 1;
            else failed += 1;
          });
          const known = states.flatMap(({ status }) => (status ? [toUiStatus(status)] : []));
          const aggregate = known.length === states.length ? selectedAggregate(known) : null;
          if (states.length === 1) {
            const only = states[0]!;
            node.textContent = only.status ? SIDE_STATUS_TEXT[toUiStatus(only.status)] : "Статус не получен";
          } else {
            node.replaceChildren(...states.map(({ code, status }) => {
              const line = element("div", "selection-item__status-line", `${code} — ${status ? sideStatusShort(status) : "статус не получен"}`);
              if (status) line.dataset.state = toUiStatus(status);
              return line;
            }));
          }
          if (aggregate) node.dataset.state = aggregate;
          else node.removeAttribute("data-state");
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (currentGeneration !== generation) return;
        group.forEach((item) => {
          failed += item.sideCodes.length;
          const node = list.querySelector<HTMLElement>(`[data-selection-status="${CSS.escape(shortlistKey(item))}"]`);
          if (node) {
            node.textContent = "Не удалось проверить доступность";
            node.removeAttribute("data-state");
          }
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
    check.textContent = parts.length ? `Проверка завершена (по сторонам): ${parts.join(" · ")}.` : "Проверка завершена.";
  }

  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
