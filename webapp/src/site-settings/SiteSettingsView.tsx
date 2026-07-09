import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatPhoneRu,
  normalizeRuPhone,
  orderHomepageConstructions,
  SITE_SETTINGS_DEFAULTS,
  SITE_SETTINGS_LIMITS,
  type Construction,
  type SecondaryContactKind,
  type SiteSettingsOverrides,
  type UpdateSiteSettingsInput,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";

const L = SITE_SETTINGS_LIMITS;
const D = SITE_SETTINGS_DEFAULTS;

/** Ключи строковых полей (всё, кроме числа/массивов/типа второго контакта). */
type TextKey = Exclude<
  keyof SiteSettingsOverrides,
  "newsHomeCount" | "homepageOrder" | "homepageHidden" | "secondaryContactKind"
>;

interface FieldDef {
  key: TextKey;
  label: string;
  limit: number;
  multiline?: boolean;
  placeholder?: string;
  /** Телефонное поле: type="tel" + инлайн-проверка РФ-номера на blur/сабмите. */
  tel?: boolean;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Контакты и реквизиты",
    fields: [
      { key: "siteName", label: "Название сайта", limit: L.siteName },
      { key: "phonePrimary", label: "Телефон", limit: 24, placeholder: formatPhoneRu(D.phonePrimary), tel: true },
      { key: "email", label: "E-mail", limit: 254 },
      { key: "address", label: "Адрес офиса", limit: L.address },
      { key: "workHoursWeekday", label: "Часы работы — будни", limit: L.workHours },
      { key: "workHoursSaturday", label: "Часы работы — суббота", limit: L.workHours },
      { key: "footerBrand", label: "Описание в подвале", limit: L.footerBrand, multiline: true },
      { key: "copyright", label: "Строка копирайта", limit: L.copyright },
      { key: "slogan", label: "Слоган", limit: L.slogan },
    ],
  },
  {
    title: "Навигация (только подписи)",
    fields: [
      { key: "navCatalog", label: "Каталог", limit: L.navItem },
      { key: "navFlats", label: "Карта", limit: L.navItem },
      { key: "navAbout", label: "О нас", limit: L.navItem },
      { key: "navDocs", label: "Документы", limit: L.navItem },
      { key: "navContacts", label: "Контакты", limit: L.navItem },
      { key: "ctaSelectFlat", label: "Кнопка «Выбрать конструкцию»", limit: L.cta },
    ],
  },
  {
    title: "Главный экран (hero)",
    fields: [
      { key: "heroEyebrow", label: "Надзаголовок", limit: L.eyebrow },
      { key: "heroTitleLine1", label: "Заголовок — строка 1", limit: L.heroLine },
      { key: "heroTitleLine2", label: "Заголовок — строка 2 (акцент)", limit: L.heroLine },
      { key: "heroSubtitle", label: "Подзаголовок", limit: L.heroSub, multiline: true },
      { key: "heroCtaPrimary", label: "Кнопка 1", limit: L.cta },
      { key: "heroCtaSecondary", label: "Кнопка 2", limit: L.cta },
    ],
  },
  {
    title: "Заголовки секций",
    fields: [
      { key: "catalogEyebrow", label: "Каталог — надзаголовок", limit: L.eyebrow },
      { key: "catalogTitle", label: "Каталог — заголовок", limit: L.title },
      { key: "flatsEyebrow", label: "Карта — надзаголовок", limit: L.eyebrow },
      { key: "flatsTitle", label: "Карта — заголовок", limit: L.title },
      { key: "newsEyebrow", label: "Новости — надзаголовок", limit: L.eyebrow },
      { key: "newsTitle", label: "Новости — заголовок", limit: L.title },
      { key: "docsEyebrow", label: "Документы — надзаголовок", limit: L.eyebrow },
      { key: "aboutEyebrow", label: "О нас — надзаголовок", limit: L.eyebrow },
      { key: "contactsEyebrow", label: "Контакты — надзаголовок", limit: L.eyebrow },
      { key: "contactsTitle", label: "Контакты — заголовок", limit: L.title },
    ],
  },
  {
    title: "Кнопки",
    fields: [
      { key: "flatsCta", label: "«К каталогу»", limit: L.cta },
      { key: "newsAllCta", label: "«Все акции и новости»", limit: L.cta },
      { key: "contactsLeaveCta", label: "«Оставить заявку»", limit: L.cta },
      { key: "ctaOrderCall", label: "«Заказать звонок»", limit: L.cta },
    ],
  },
];

const CONTACT_KINDS: { value: SecondaryContactKind; label: string }[] = [
  { value: "email", label: "E-mail (Написать на почту)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "phone", label: "Звонок (телефон)" },
  { value: "link", label: "Произвольная ссылка" },
];

const TEXT_KEYS: TextKey[] = GROUPS.flatMap((g) => g.fields.map((f) => f.key)).concat([
  "secondaryContactValue",
  "secondaryContactLabel",
  "metrikaCounterId",
]);

export function SiteSettingsView() {
  const settingsQ = useQuery({ queryKey: ["site-settings"], queryFn: () => api.getSiteSettings() });
  const projectsQ = useQuery({
    queryKey: ["projects", "for-homepage"],
    queryFn: () => api.listProjects({ pageSize: 100 }),
  });

  if (settingsQ.isLoading || projectsQ.isLoading) return <p className="hint">Загрузка…</p>;
  if (settingsQ.isError || projectsQ.isError)
    return <p className="alert alert-error" role="alert">Не удалось загрузить настройки.</p>;

  const data = settingsQ.data!;
  const published = (projectsQ.data?.items ?? []).filter((p) => p.status === "published");

  // key по updatedAt: после сохранения форма перемонтируется со свежими данными.
  return (
    <Editor
      key={data.updatedAt}
      initial={data.settings}
      updatedAt={data.updatedAt}
      published={published}
    />
  );
}

function Editor({
  initial,
  updatedAt,
  published,
}: {
  initial: SiteSettingsOverrides;
  updatedAt: string;
  published: Construction[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<TextKey, string>>(() => {
    const f = {} as Record<TextKey, string>;
    for (const k of TEXT_KEYS) f[k] = (initial[k] as string | undefined) ?? "";
    return f;
  });
  const [kind, setKind] = useState<SecondaryContactKind>(initial.secondaryContactKind ?? "email");
  const [newsCount, setNewsCount] = useState<3 | 6>(initial.newsHomeCount ?? 3);
  const [order, setOrder] = useState<string[]>(() =>
    orderHomepageConstructions(published, initial.homepageOrder ?? [], []).map((p) => p.id),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.homepageHidden ?? []));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const buildQ = useQuery({
    queryKey: ["site-build"],
    queryFn: () => api.getSiteBuild(),
    refetchInterval: 20_000,
    retry: false,
  });

  const byId = useMemo(() => new Map(published.map((p) => [p.id, p])), [published]);

  const set = (k: TextKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    setOrder((o) => {
      const next = o.slice();
      const [m] = next.splice(i, 1);
      if (m === undefined) return o;
      next.splice(j, 0, m);
      return next;
    });
  };
  const toggleHidden = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = useMutation({
    mutationFn: () => {
      const payload: UpdateSiteSettingsInput = {
        ...Object.fromEntries(TEXT_KEYS.map((k) => [k, form[k]])),
        secondaryContactKind: kind,
        newsHomeCount: newsCount,
        homepageOrder: order,
        homepageHidden: [...hidden],
        expectedUpdatedAt: updatedAt,
      } as UpdateSiteSettingsInput;
      return api.updateSiteSettings(payload);
    },
    onSuccess: () => {
      setFieldErrors({});
      setBanner({ kind: "ok", text: "Сохранено в CRM. Чтобы обновить сайт, нажмите «Опубликовать сайт»." });
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      qc.invalidateQueries({ queryKey: ["site-build"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setBanner({ kind: "err", text: "Настройки изменил другой администратор — страница обновлена, повторите правку." });
        qc.invalidateQueries({ queryKey: ["site-settings"] });
        return;
      }
      if (e instanceof ApiError && e.fields) {
        setFieldErrors(e.fields);
        setBanner({ kind: "err", text: "Проверьте отмеченные поля." });
        return;
      }
      setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    },
  });

  const publish = useMutation({
    mutationFn: () => api.requestSitePublish(),
    onSuccess: (status) => {
      qc.setQueryData(["site-build"], status);
      qc.invalidateQueries({ queryKey: ["site-build"] });
      setBanner({
        kind: "ok",
        text: status.pending
          ? "Публикация поставлена в очередь. Сборщик обновит сайт отдельным шагом."
          : "Публиковать нечего — новых сохранённых изменений нет.",
      });
    },
    onError: (e) => {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    },
  });

  // Инлайн-проверка телефонного поля (то же правило, что на сервере): пустое —
  // ок (вернётся дефолт), иначе валидный РФ-номер.
  const telError = (value: string): string | null =>
    value.trim() !== "" && normalizeRuPhone(value) === null
      ? "Введите номер телефона полностью"
      : null;

  const setFieldError = (key: string, message: string | null) =>
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  // Клиентская валидация перед сохранением — чтобы ошибка была видна сразу,
  // без серверного round-trip.
  const validateAndSave = () => {
    const errors: Record<string, string> = {};
    const phoneErr = telError(form.phonePrimary);
    if (phoneErr) errors.phonePrimary = phoneErr;
    if (kind === "phone" || kind === "whatsapp") {
      const secErr = telError(form.secondaryContactValue);
      if (secErr) errors.secondaryContactValue = secErr;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBanner({ kind: "err", text: "Проверьте отмеченные поля." });
      return;
    }
    save.mutate();
  };

  const renderField = (f: FieldDef) => {
    const v = form[f.key];
    const err = fieldErrors[f.key];
    return (
      <label key={f.key} className={`field${f.multiline ? " field-wide" : ""}`}>
        <span className="field-label">
          <span>{f.label}</span>
          <span style={{ color: v.length > f.limit ? "var(--danger)" : "var(--fg-subtle)" }}>
            {v.length}/{f.limit}
          </span>
        </span>
        {f.multiline ? (
          <textarea
            value={v}
            maxLength={f.limit}
            placeholder={f.placeholder ?? (D[f.key] as string)}
            onChange={(e) => set(f.key, e.target.value)}
            rows={2}
          />
        ) : (
          <input
            type={f.tel ? "tel" : undefined}
            value={v}
            maxLength={f.limit}
            placeholder={f.placeholder ?? (D[f.key] as string)}
            onChange={(e) => set(f.key, e.target.value)}
            onBlur={f.tel ? () => setFieldError(f.key, telError(v)) : undefined}
          />
        )}
        {err && <span className="field-error">{err}</span>}
      </label>
    );
  };

  return (
    <section className="page-narrow">
      <h2>Настройки сайта</h2>
      <p className="hint">
        Тексты и контакты лендинга. Пустое поле = стандартное значение (показано серым).
        Сохранение не запускает пересборку: внесите все правки, затем опубликуйте сайт одним действием.
      </p>

      {banner && (
        <p
          className={banner.kind === "ok" ? "alert alert-ok" : "alert alert-error"}
          role={banner.kind === "ok" ? "status" : "alert"}
        >
          {banner.text}
        </p>
      )}

      <p className="hint" style={{ marginTop: "-0.4rem" }}>
        Разделы свёрнуты — раскрывайте нужный. Открыт первый.
      </p>

      {GROUPS.map((g, i) => (
        <CollapsibleFieldset key={g.title} title={g.title} defaultOpen={i === 0}>
          <div className="settings-grid">{g.fields.map(renderField)}</div>
        </CollapsibleFieldset>
      ))}

      <CollapsibleFieldset title="Второй контакт (кнопка «Написать…»)">
        <label className="field">
          <span className="field-label">Тип</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SecondaryContactKind)}
          >
            {CONTACT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== "email" &&
          renderField({
            key: "secondaryContactValue",
            label: kind === "link" ? "Ссылка (https://…)" : "Номер / адрес",
            limit: L.contactValue,
            placeholder: kind === "link" ? "https://…" : "+7 (___) ___-__-__ или @username",
            tel: kind === "phone" || kind === "whatsapp",
          })}
        {renderField({
          key: "secondaryContactLabel",
          label: "Подпись кнопки (необязательно)",
          limit: L.contactLabel,
          placeholder: "по умолчанию — по типу контакта",
        })}
      </CollapsibleFieldset>

      <CollapsibleFieldset title="Блок новостей">
        <label className="field">
          <span className="field-label">Сколько новостей на главной</span>
          <select
            value={newsCount}
            onChange={(e) => setNewsCount(Number(e.target.value) === 6 ? 6 : 3)}
          >
            <option value={3}>3</option>
            <option value={6}>6</option>
          </select>
        </label>
      </CollapsibleFieldset>

      <CollapsibleFieldset title="Конструкции на главной">
        <p className="hint" style={{ marginTop: 0 }}>
          Порядок карточек в каталоге и видимость. «Скрыть» убирает конструкцию с главной,
          карты и из блока «Документы».
        </p>
        {order.length === 0 && <p className="empty">Опубликованных конструкций нет.</p>}
        <ol style={{ paddingLeft: 18 }}>
          {order.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <li key={id} style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Выше" aria-label="Переместить выше">↑</button>
                <button type="button" className="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Ниже" aria-label="Переместить ниже">↓</button>
                <span style={{ flex: 1, textDecoration: hidden.has(id) ? "line-through" : "none", color: hidden.has(id) ? "var(--fg-subtle)" : "inherit" }}>
                  {p.name}
                </span>
                <label className="check" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={hidden.has(id)} onChange={() => toggleHidden(id)} /> скрыть
                </label>
              </li>
            );
          })}
        </ol>
      </CollapsibleFieldset>

      <CollapsibleFieldset title="Яндекс.Метрика">
        {renderField({
          key: "metrikaCounterId",
          label: "ID счётчика (только цифры; пусто = выключена)",
          limit: L.metrika,
          placeholder: "например, 12345678",
        })}
      </CollapsibleFieldset>

      <div className="toolbar" style={{ marginTop: "0.25rem" }}>
        <button
          onClick={validateAndSave}
          disabled={save.isPending}
          className="btn-primary"
          style={{ padding: "0.55rem 1.25rem" }}
        >
          {save.isPending ? "Сохранение…" : "Сохранить в CRM"}
        </button>
        <button
          type="button"
          onClick={() => publish.mutate()}
          disabled={
            publish.isPending ||
            buildQ.data?.status === "building" ||
            buildQ.data?.pending === true ||
            buildQ.data?.unpublished !== true
          }
          title={
            buildQ.data?.unpublished
              ? "Запустить публикацию всех накопленных правок сайта"
              : "Нет сохранённых правок для публикации"
          }
        >
          {publish.isPending ? "Публикация…" : "Опубликовать сайт"}
        </button>
      </div>
      {buildQ.data?.unpublished && !buildQ.data.pending && buildQ.data.status !== "building" && (
        <p className="hint" style={{ marginTop: 8 }}>
          Есть сохранённые изменения, которых ещё нет на публичном сайте.
        </p>
      )}
      {buildQ.data?.pending && buildQ.data.status !== "building" && (
        <p className="hint" style={{ marginTop: 8 }}>
          Публикация уже в очереди; сборщик заберёт её после короткой паузы.
        </p>
      )}
      {buildQ.data?.status === "building" && (
        <p className="hint" style={{ marginTop: 8 }}>
          Сайт сейчас публикуется. Дождитесь завершения перед следующей публикацией.
        </p>
      )}
    </section>
  );
}

/**
 * Сворачиваемая группа настроек: заменяет «простыню» из fieldset на аккордеон.
 * По умолчанию свёрнута (кроме первой), чтобы экран не растягивался на километр.
 */
function CollapsibleFieldset({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="settings-group" open={defaultOpen}>
      <summary className="settings-group-summary">
        <span className="settings-group-chevron" aria-hidden="true">
          ›
        </span>
        <span>{title}</span>
      </summary>
      <div className="settings-group-body">{children}</div>
    </details>
  );
}
