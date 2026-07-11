import { type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser, CreateManualLeadInput, Funnel, SessionUser } from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import {
  formatPhoneInput,
  PHONE_PLACEHOLDER,
  phoneInputError,
} from "../ui/phone";
import { listProjectOptions } from "../projects/project-options";

/**
 * Форма ручного приёма заявки (оффлайн: пришёл в офис / привёл партнёр). Клиент
 * заводится/дедупится по телефону на бэке, как при веб-приёме; согласие ПДн
 * подтверждает оператор чекбоксом. Реферер и ответственный — необязательны
 * (менеджер может взять заявку себе; адресно на другого назначает только admin).
 */
export function ManualLeadForm({
  user,
  managers,
  funnels,
  defaultFunnelId,
  onClose,
  onCreated,
}: {
  user: SessionUser;
  managers: AdminUser[];
  /** Живые воронки — заявка падает во входной этап выбранной. */
  funnels: Funnel[];
  /** Предвыбор — активная вкладка раздела «Заявки». */
  defaultFunnelId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [source, setSource] = useState("offline");
  const [funnelId, setFunnelId] = useState(() => defaultFunnelId ?? funnels[0]?.id ?? "");
  const [constructionId, setProjectId] = useState("");
  const [referrerId, setReferrerId] = useState("");
  const [assigneeId, setAssigneeId] = useState(""); // "" — не назначать/авто
  const [takeSelf, setTakeSelf] = useState(false);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerPhone, setNewPartnerPhone] = useState("");
  const [newPartnerPhoneError, setNewPartnerPhoneError] = useState("");

  const projects = useQuery({
    queryKey: ["projects", "picker", "all"],
    queryFn: () => listProjectOptions(),
    retry: false,
  });
  // Источники ручного приёма: только не-веб (веб-слаги проставляет лендинг).
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.listSources(),
    retry: false,
  });
  const manualSources = (sources.data ?? []).filter((s) => !s.isWeb);
  const clientSearchTerm = clientSearch.trim();
  const clients = useQuery({
    queryKey: ["contacts", "client", clientSearchTerm],
    queryFn: () =>
      api.listContacts({
        role: "client",
        search: clientSearchTerm,
      }),
    enabled: clientSearchTerm.length >= 2,
    retry: false,
  });
  const partners = useQuery({
    queryKey: ["contacts", "partner", ""],
    queryFn: () => api.listContacts({ role: "partner", type: "individual" }),
    retry: false,
  });
  const companies = useQuery({
    queryKey: ["contacts", "company", ""],
    queryFn: () => api.listContacts({ role: "partner", type: "company" }),
    retry: false,
  });

  const activeManagers = managers.filter((u) => u.role === "manager" && u.isActive);

  const save = useMutation({
    mutationFn: () => {
      const input: CreateManualLeadInput = {
        name: name.trim(),
        phone: phone.trim(),
        consent, // реальный стейт чекбокса; сервер требует true (иначе 422)
        source,
        funnelId: funnelId || undefined,
        constructionId: constructionId || undefined,
        message: message.trim() || undefined,
        contactId: selectedClientId || undefined,
        referrerId: referrerId || undefined,
        newReferrer:
          !referrerId && newPartnerName.trim()
            ? {
                fullName: newPartnerName.trim(),
                phone: newPartnerPhone.trim() || null,
              }
            : undefined,
        assigneeId:
          user.role === "admin" ? assigneeId || undefined : takeSelf ? user.id : undefined,
      };
      return api.createManualLead(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      onCreated();
    },
  });

  const phoneErrorText = phoneInputError(phone, true);
  const partnerPhoneErrorText = phoneInputError(newPartnerPhone);
  const partnerDraftValid = !newPartnerPhone.trim() || newPartnerName.trim().length >= 2;
  const canSubmit =
    name.trim().length >= 2 &&
    phoneErrorText === "" &&
    partnerPhoneErrorText === "" &&
    partnerDraftValid &&
    consent;

  return (
    <form
      className="card"
      style={{ marginBottom: "1rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) save.mutate();
      }}
    >
      <div className="card-head">
        <div className="card-title">Приём заявки (оффлайн)</div>
      </div>
      <div className="card-body">
        {(projects.error || clients.error || partners.error || companies.error) && (
          <p className="alert alert-error" role="alert">
            Не удалось загрузить справочники (конструкции/контакты):{" "}
            {((projects.error || clients.error || partners.error || companies.error) as Error).message}
          </p>
        )}

        <Field label="Клиент">
          <input
            value={clientSearch}
            onChange={(e) => {
              setClientSearch(e.target.value);
              if (selectedClientId) setSelectedClientId("");
            }}
            placeholder="Найти клиента по имени или телефону"
          />
          {clientSearchTerm.length >= 2 && (clients.data ?? []).length > 0 && (
            <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
              {(clients.data ?? []).slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={selectedClientId === c.id ? "btn-primary btn-sm" : "btn-sm"}
                  onClick={() => {
                    setSelectedClientId(c.id);
                    setClientSearch(c.fullName);
                    setName(c.fullName);
                    setPhone(formatPhoneInput(c.phone ?? ""));
                    setPhoneError("");
                  }}
                >
                  {c.fullName}
                  {c.phone ? ` · ${c.phone}` : ""}
                </button>
              ))}
            </div>
          )}
          {selectedClientId && (
            <button
              type="button"
              className="link-btn"
              style={{ marginTop: 8 }}
              onClick={() => setSelectedClientId("")}
            >
              Создать нового клиента по данным ниже
            </button>
          )}
        </Field>

        <div className="settings-grid">
          <Field label="Имя">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (selectedClientId) setSelectedClientId("");
              }}
              required
            />
          </Field>
          <Field label="Телефон">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(formatPhoneInput(e.target.value));
                if (selectedClientId) setSelectedClientId("");
                if (phoneError) setPhoneError("");
              }}
              onBlur={() =>
                setPhoneError(phoneInputError(phone, true))
              }
              aria-invalid={phoneError ? true : undefined}
              placeholder={PHONE_PLACEHOLDER}
              required
            />
            {phoneError && (
              <span className="field-error" role="alert">
                {phoneError}
              </span>
            )}
          </Field>
        </div>

        <div className="settings-grid">
          {funnels.length > 1 && (
            <Field label="Воронка">
              {/* Заявка попадёт во входной этап выбранной воронки. */}
              <select value={funnelId} onChange={(e) => setFunnelId(e.target.value)}>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Источник">
            {/* Только каналы ручного приёма — веб-источники проставляет лендинг. */}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {manualSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {manualSources.length === 0 && <option value="offline">Оффлайн</option>}
            </select>
          </Field>
        </div>

        <Field label="Конструкция (необязательно)">
          <select value={constructionId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— не выбран —</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Партнёр, который привёл клиента (необязательно)">
          <select
            value={referrerId}
            onChange={(e) => {
              setReferrerId(e.target.value);
              if (e.target.value) {
                setNewPartnerName("");
                setNewPartnerPhone("");
                setNewPartnerPhoneError("");
              }
            }}
          >
            <option value="">— без реферера —</option>
            {(partners.data ?? []).length > 0 && (
              <optgroup label="Партнёры">
                {(partners.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                    {r.organizationName ? ` (${r.organizationName})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {(companies.data ?? []).length > 0 && (
              <optgroup label="Компании">
                {(companies.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="settings-grid" style={{ marginTop: 10 }}>
            <input
              value={newPartnerName}
              onChange={(e) => {
                setNewPartnerName(e.target.value);
                if (e.target.value.trim()) setReferrerId("");
              }}
              placeholder="Новый партнёр, если его нет в списке"
            />
            <div>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={newPartnerPhone}
                onChange={(e) => {
                  setNewPartnerPhone(e.target.value);
                  if (newPartnerPhoneError) setNewPartnerPhoneError("");
                  if (e.target.value.trim()) setReferrerId("");
                }}
                onBlur={() => setNewPartnerPhoneError(phoneInputError(newPartnerPhone))}
                aria-invalid={newPartnerPhoneError ? true : undefined}
                placeholder={PHONE_PLACEHOLDER}
              />
              {newPartnerPhoneError && (
                <span className="field-error" role="alert">
                  {newPartnerPhoneError}
                </span>
              )}
            </div>
          </div>
        </Field>

        {user.role === "admin" ? (
          <Field label="Ответственный (необязательно)">
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— не назначать —</option>
              {activeManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <label className="check" style={{ marginBottom: "0.9rem" }}>
            <input
              type="checkbox"
              checked={takeSelf}
              onChange={(e) => setTakeSelf(e.target.checked)}
            />
            Взять заявку себе
          </label>
        )}

        <Field label="Комментарий (необязательно)">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
        </Field>

        <label className="check" style={{ marginBottom: "0.9rem" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Клиент дал согласие на обработку персональных данных (бумажная/устная форма получена)
        </label>

        {save.error && (
          <p className="alert alert-error" role="alert">
            {(() => {
              // 422-валидация возвращает общий message + fields{поле: причина};
              // показываем причины по полям (напр. телефон), иначе — общий текст.
              const err = save.error as ApiError;
              const fieldMsgs = err.fields ? Object.values(err.fields) : [];
              return fieldMsgs.length > 0 ? fieldMsgs.join("; ") : err.message;
            })()}
          </p>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button type="submit" className="btn-primary" disabled={!canSubmit || save.isPending}>
            Принять заявку
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}

/** Поле формы: подпись над контролом — единый стиль со всеми формами CRM. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}
