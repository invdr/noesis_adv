import {
  clearShortlist,
  onShortlistChange,
  readShortlist,
  shortlistLeadText,
  type ShortlistItem,
} from "./shortlist";

interface SiteConfig {
  apiUrl: string;
}

function readConfig(): SiteConfig {
  const node = document.getElementById("site-config");
  try {
    return node?.textContent ? JSON.parse(node.textContent) as SiteConfig : { apiUrl: "" };
  } catch {
    return { apiUrl: "" };
  }
}

function pluralPositions(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

function renderShortlistState(items: ShortlistItem[]): void {
  const count = items.length;
  document.querySelectorAll<HTMLElement>("[data-shortlist-count]").forEach((node) => {
    node.textContent = String(count);
  });
  document.querySelectorAll<HTMLElement>("[data-shortlist-word]").forEach((node) => {
    node.textContent = pluralPositions(count);
  });
  const mobile = document.querySelector<HTMLElement>("[data-mobile-selection]");
  if (mobile) mobile.hidden = count === 0;
  document.body.classList.toggle("has-mobile-selection", count > 0);
  document.querySelectorAll<HTMLElement>("[data-form-selection-count]").forEach((node) => {
    node.textContent = count ? `${count} ${pluralPositions(count)} в подборке` : "Подборка пока пуста";
  });
}

function setupMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
  const closeButton = document.querySelector<HTMLButtonElement>("[data-menu-close]");
  if (!toggle || !menu) return;

  const close = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Открыть меню");
    document.body.classList.remove("menu-open");
    toggle.focus();
  };
  const open = () => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Закрыть меню");
    document.body.classList.add("menu-open");
    closeButton?.focus();
  };

  toggle.addEventListener("click", () => menu.hidden ? open() : close());
  closeButton?.addEventListener("click", close);
  menu.addEventListener("click", (event) => {
    if (event.target === menu || (event.target as Element).closest("a")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) close();
  });
}

function setupCookie(): void {
  const banner = document.querySelector<HTMLElement>("[data-cookie-banner]");
  const accept = document.querySelector<HTMLButtonElement>("[data-cookie-accept]");
  if (!banner || !accept) return;
  const key = "noesis_cookie_consent";
  let accepted = false;
  try { accepted = localStorage.getItem(key) === "1"; } catch { /* noop */ }
  banner.hidden = accepted;
  accept.addEventListener("click", () => {
    try { localStorage.setItem(key, "1"); } catch { /* noop */ }
    banner.hidden = true;
  });
}

function maskPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits[0] === "8") digits = `7${digits.slice(1)}`;
  if (digits[0] !== "7") digits = `7${digits}`;
  digits = digits.slice(0, 11);
  const rest = digits.slice(1);
  let result = "+7";
  if (rest.length) result += ` (${rest.slice(0, 3)}`;
  if (rest.length >= 3) result += ")";
  if (rest.length > 3) result += ` ${rest.slice(3, 6)}`;
  if (rest.length > 6) result += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) result += `-${rest.slice(8, 10)}`;
  return result;
}

function setupPhone(input: HTMLInputElement): void {
  input.addEventListener("input", () => {
    input.value = maskPhone(input.value);
    input.setCustomValidity("");
  });
  input.addEventListener("blur", () => {
    const digits = input.value.replace(/\D/g, "");
    input.setCustomValidity(digits.length === 11 ? "" : "Введите номер телефона полностью");
  });
}

function contactLabel(value: string): string {
  return ({ phone: "Телефон", whatsapp: "WhatsApp", telegram: "Telegram" } as Record<string, string>)[value] ?? value;
}

function responseMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "Не удалось отправить заявку. Попробуйте ещё раз.";
  const value = body as { message?: unknown; error?: { message?: unknown }; issues?: unknown[] };
  if (typeof value.message === "string") return value.message;
  if (typeof value.error?.message === "string") return value.error.message;
  return "Проверьте поля формы и повторите отправку.";
}

function buildMessage(form: HTMLFormElement): string | undefined {
  const data = new FormData(form);
  const organization = String(data.get("organization") || "").trim();
  const contactMethod = String(data.get("contactMethod") || "phone");
  const comment = String(data.get("comment") || "").trim();
  const currentSelection = String(data.get("selectionSummary") || "").trim();
  const includeShortlist = form.dataset.includeShortlist !== "false";
  const shortlist = includeShortlist ? shortlistLeadText(readShortlist()) : "";
  const lines = [
    organization ? `Компания: ${organization}` : "",
    `Предпочтительный способ связи: ${contactLabel(contactMethod)}`,
    currentSelection,
    shortlist,
    comment ? `Комментарий: ${comment}` : "",
  ].filter(Boolean);
  const message = lines.join("\n\n").slice(0, 2000);
  return message || undefined;
}

function setupLeadForm(form: HTMLFormElement, config: SiteConfig): void {
  const phone = form.querySelector<HTMLInputElement>('input[name="phone"]');
  const status = form.querySelector<HTMLElement>("[data-form-status]");
  const success = form.querySelector<HTMLElement>("[data-form-success]");
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!phone || !status || !success || !submit) return;
  setupPhone(phone);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    success.hidden = true;
    phone.dispatchEvent(new Event("blur"));
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    const payload: Record<string, unknown> = {
      name: String(data.get("name") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      consent: data.get("consent") === "on",
      source: form.dataset.source || "contacts",
      message: buildMessage(form),
    };
    const constructionId = String(data.get("constructionId") || "").trim();
    const honeypot = String(data.get("company") || "");
    if (constructionId) payload.constructionId = constructionId;
    if (honeypot) payload.company = honeypot;

    form.setAttribute("aria-busy", "true");
    submit.disabled = true;
    const originalLabel = submit.textContent;
    submit.textContent = "Отправляем…";
    try {
      const response = await fetch(`${config.apiUrl}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(body));

      form.classList.add("is-success");
      success.hidden = false;
      success.focus();
      window.dispatchEvent(new CustomEvent("noesis:lead-success"));
      const goal = (window as typeof window & { ymGoal?: (name: string) => void }).ymGoal;
      goal?.("lead_sent");
      if (form.dataset.clearShortlist === "true") clearShortlist();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Сеть недоступна. Попробуйте ещё раз.";
      status.hidden = false;
      status.focus();
    } finally {
      form.removeAttribute("aria-busy");
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  });
}

function init(): void {
  const config = readConfig();
  setupMenu();
  setupCookie();
  renderShortlistState(readShortlist());
  onShortlistChange(renderShortlistState);
  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith("noesis_shortlist")) renderShortlistState(readShortlist());
  });
  document.querySelectorAll<HTMLFormElement>("[data-lead-form]").forEach((form) => setupLeadForm(form, config));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
