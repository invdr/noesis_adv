import { expect, test } from "@playwright/test";

/**
 * Сквозной смоук CRM против реального стека (Postgres + backend + собранный
 * webapp): логин сид-админом со сменой пароля первого входа → дашборд → ручной
 * приём заявки → её карточка. Ловит поломки склейки фронт↔бэк↔БД (сессия в
 * cookie, чтение/запись через API), которые юнит-тесты не видят. Одна заявка
 * мутирует БД, поэтому прогон линейный и без ретраев (см. playwright.config).
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@test.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-password-1";
// Пароль после принудительной смены при первом входе (≥8 символов).
const NEW_PASSWORD = "e2e-password-42";

// Уникальные имя/телефон на прогон — повторные запуски не конфликтуют дедупом.
const stamp = String(Date.now());
const phone = `+7928${stamp.slice(-7)}`;
const leadName = `E2E Смоук ${stamp}`;

test("логин → дашборд → ручной приём заявки → карточка", async ({ page }) => {
  // --- Логин; сид ставит mustChangePassword — при первом входе меняем пароль.
  await page.goto("/");
  await page.getByPlaceholder("Email").fill(ADMIN_EMAIL);
  await page.getByPlaceholder("Пароль").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();

  const changePassword = page.getByRole("heading", { name: "Смена пароля" });
  const sidebar = page.getByText("CRM заявок");
  await expect(changePassword.or(sidebar)).toBeVisible({ timeout: 20_000 });
  if (await changePassword.isVisible()) {
    await page.getByPlaceholder("Текущий пароль").fill(ADMIN_PASSWORD);
    await page.getByPlaceholder("Новый пароль", { exact: true }).fill(NEW_PASSWORD);
    await page.getByPlaceholder("Повторите новый пароль").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Сохранить пароль" }).click();
  }
  // Полный стек ожил: дашборд отрисован по данным из API за сессией.
  await expect(sidebar).toBeVisible({ timeout: 20_000 });

  // --- Раздел «Заявки»: список грузится из бэка (кнопка приёма доступна).
  await page.getByRole("button", { name: "Заявки", exact: true }).click();
  const acceptBtn = page.getByRole("button", { name: "Принять заявку" });
  await expect(acceptBtn).toBeVisible({ timeout: 15_000 });

  // --- Ручной приём заявки (селекторы скоуплены к форме — без неоднозначности).
  await acceptBtn.click();
  const form = page.locator("form", { hasText: "Приём заявки (оффлайн)" });
  await expect(form).toBeVisible();
  await form.getByLabel("Имя").fill(leadName);
  await form.getByLabel("Телефон").fill(phone);
  await form.getByText("Клиент дал согласие").click();
  await form.getByRole("button", { name: "Принять заявку" }).click();

  // Успех создания закрывает форму (onCreated → setAdding(false)) — детерминированный
  // сигнал, что мутация прошла через бэк в БД. Ошибка бэка оставляет форму с alert:
  // поднимаем его текст в отчёт, чтобы падение было читаемым, а не «форма видна».
  await expect(async () => {
    const alert = form.locator(".alert-error");
    if (await alert.count()) {
      throw new Error(`Приём заявки отклонён бэкендом: ${(await alert.first().innerText()).trim()}`);
    }
    await expect(form).toBeHidden();
  }).toPass({ timeout: 15_000 });

  // Созданная заявка видна в списке; открываем её карточку.
  const leadLink = page.getByRole("button", { name: leadName });
  await expect(leadLink).toBeVisible({ timeout: 15_000 });
  await leadLink.click();

  // --- Карточка сделки: полный стек отдал детальный DTO (шапка + tel-ссылка).
  await expect(page.getByRole("heading", { name: new RegExp(leadName) })).toBeVisible();
  await expect(page.locator(`a[href="tel:${phone}"]`)).toBeVisible();
});
