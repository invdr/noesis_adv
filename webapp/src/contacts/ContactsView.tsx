import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Contact,
  ContactKind,
  SessionUser,
  UpsertContactInput,
} from "@gsk-tower/contracts";
import { CONTACT_KIND_LABEL } from "@gsk-tower/contracts";
import { api, ApiError } from "../api/client";
import { navigate } from "../router";
import {
  formatPhoneInput,
  PHONE_PLACEHOLDER,
  phoneInputError,
} from "../ui/phone";
import { formatDateTime, sourceLabel } from "../leads/shared";
import { ContactCard } from "./ContactCard";

const KIND_TABS: ContactKind[] = ["client", "realtor", "agency"];

/** ISO → значение для <input type="datetime-local"> в местном времени. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function emptyToNull(value: string): string | null {
  return value.trim() || null;
}

/**
 * Раздел «Контакты» — единый список контактов CRM с фильтром по типу. Клиенты —
 * агрегат по заявкам (имя/этап/источник из свежайшей заявки). Риелторы и
 * агентства — партнёры, приводящие заявки; их можно заводить/редактировать
 * прямо здесь (доступно всем сотрудникам).
 */
export function ContactsView({
  user,
  selectedContactId,
  onOpenContact,
  onCloseContact,
}: {
  user: SessionUser;
  /** Открытая карточка контакта — из маршрута `#/contacts/<id>`. */
  selectedContactId?: string;
  onOpenContact?: (id: string) => void;
  onCloseContact?: () => void;
}) {
  const [kind, setKind] = useState<ContactKind>("client");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const contacts = useQuery({
    queryKey: ["contacts", kind, search, includeArchived],
    queryFn: () =>
      api.listContacts({
        kind,
        search: search || undefined,
        includeArchived: includeArchived || undefined,
      }),
    retry: false,
  });
  // Учётки для показа ответственного по клиентам — только админу.
  const managers = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: user.role === "admin" && kind === "client",
    retry: false,
  });
  const userById = useMemo(
    () => new Map((managers.data ?? []).map((u) => [u.id, u] as const)),
    [managers.data],
  );

  const assigneeCell = (assigneeId: string | null) => {
    if (!assigneeId) return <span className="subtle">Не назначен</span>;
    if (assigneeId === user.id) return <span className="badge badge-info">Вы</span>;
    const u = userById.get(assigneeId);
    return u ? (
      <span className="muted" title={u.email}>
        {u.name || u.email}
      </span>
    ) : (
      <span className="muted">Другой менеджер</span>
    );
  };

  const list = contacts.data ?? [];
  const isPartner = kind !== "client";

  if (selectedContactId) {
    return (
      <ContactCard
        contactId={selectedContactId}
        onBack={() => onCloseContact?.()}
      />
    );
  }

  return (
    <section>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {KIND_TABS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === kind ? "btn-primary" : ""}
            onClick={() => {
              setKind(k);
              setIncludeArchived(false);
              setShowAddForm(false);
            }}
          >
            {k === "client" ? "Клиенты" : k === "realtor" ? "Риелторы" : "Агентства"}
          </button>
        ))}
      </div>

      <p className="hint">
        {kind === "client"
          ? "Клиенты — покупатели, к которым привязаны заявки. Их можно завести вручную или выбрать при оффлайн-приёме; телефон обязателен и защищает от дублей."
          : "Партнёры приводят заявки (реферер в карточке заявки). Аналитику по ним смотрите в разделе «Аналитика риелторов»."}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchDraft.trim());
        }}
        className="toolbar"
      >
        <input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={isPartner ? "Поиск по имени" : "Поиск по имени или телефону"}
          style={{ minWidth: 260 }}
        />
        <button type="submit" className="btn-primary">
          Найти
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              setSearch("");
            }}
          >
            Сбросить
          </button>
        )}
      </form>

      {user.role === "admin" && (
        <label
          className="hint"
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}
        >
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Показывать архивные
        </label>
      )}

      <div className="toolbar">
        <button
          type="button"
          className={showAddForm ? "" : "btn-primary"}
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm
            ? "Скрыть форму"
            : kind === "client"
              ? "Добавить клиента"
              : kind === "realtor"
                ? "Добавить риелтора"
                : "Добавить агентство"}
        </button>
      </div>

      {showAddForm && (
        <PartnerEditor
          key={`add-${kind}`}
          kind={kind}
          onDone={() => setShowAddForm(false)}
        />
      )}

      {contacts.isLoading && <p className="hint">Загрузка…</p>}
      {contacts.error && (
        <p className="alert alert-error" role="alert">
          {(contacts.error as Error).message}
        </p>
      )}

      {contacts.data && !isPartner && (
        <ClientTable
          list={list}
          user={user}
          onOpen={onOpenContact}
          assigneeCell={assigneeCell}
        />
      )}

      {contacts.data && isPartner && (
        <PartnerTable kind={kind} list={list} user={user} onOpen={onOpenContact} />
      )}
    </section>
  );
}

/** Таблица клиентов: агрегаты сделок + действия с карточкой клиента. */
function ClientTable({
  list,
  user,
  onOpen,
  assigneeCell,
}: {
  list: Contact[];
  user: SessionUser;
  onOpen?: (id: string) => void;
  assigneeCell: (assigneeId: string | null) => ReactNode;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Contact | null>(null);

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  return (
    <>
      {editing && (
        <PartnerEditor
          key={editing.id}
          kind="client"
          initial={editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Телефон</th>
              <th style={{ width: 90 }}>Заявок</th>
              <th style={{ width: 160 }}>Последняя</th>
              <th>Этап</th>
              <th>Источник</th>
              <th>Ответственный</th>
              <th style={{ width: 250 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={c.isArchived ? "muted" : undefined}>
                <td>
                  <button className="link-btn" onClick={() => onOpen?.(c.id)}>
                    {c.fullName}
                  </button>
                  {c.isArchived && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      в архиве
                    </span>
                  )}
                </td>
                <td className="tnum">{c.phone ?? "—"}</td>
                <td className="tnum">{c.leadsCount}</td>
                <td className="muted tnum">
                  {c.lastLeadId ? (
                    <button
                      className="link-btn"
                      title="Открыть последнюю заявку клиента"
                      onClick={() => navigate(`/leads/${c.lastLeadId}`)}
                    >
                      {formatDateTime(c.lastLeadAt)}
                    </button>
                  ) : (
                    formatDateTime(c.lastLeadAt)
                  )}
                </td>
                <td>{c.lastStage?.name ?? "—"}</td>
                <td>{c.lastSourceName ?? (c.lastSource ? sourceLabel(c.lastSource) : "—")}</td>
                <td>{assigneeCell(c.assigneeId)}</td>
                <td>
                  <div className="row-actions">
                    {c.isArchived ? (
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => restore.mutate(c.id)}
                        disabled={restore.isPending}
                      >
                        Восстановить
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn-sm" onClick={() => setEditing(c)}>
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => archive.mutate(c.id)}
                          disabled={archive.isPending}
                        >
                          В архив
                        </button>
                      </>
                    )}
                    {user.role === "admin" && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => {
                          if (confirm(`Удалить «${c.fullName}» без возможности восстановления?`)) {
                            remove.mutate(c.id);
                          }
                        }}
                        disabled={remove.isPending}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="empty" style={{ textAlign: "center" }}>
                  Клиентов нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {(archive.error || restore.error || remove.error) && (
          <p className="alert alert-error" role="alert" style={{ margin: 12 }}>
            {((archive.error || restore.error || remove.error) as ApiError).message}
          </p>
        )}
      </div>
    </>
  );
}

/** Таблица партнёров (риелторы/агентства) с действиями. */
function PartnerTable({
  kind,
  list,
  user,
  onOpen,
}: {
  kind: ContactKind;
  list: Contact[];
  user: SessionUser;
  onOpen?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Contact | null>(null);

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  return (
    <>
      {editing && (
        <PartnerEditor
          key={editing.id}
          kind={kind}
          initial={editing}
          onDone={() => setEditing(null)}
        />
      )}
      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>{kind === "agency" ? "Агентство" : "ФИО"}</th>
              <th>Телефон</th>
              {kind === "realtor" && <th>Агентство</th>}
              {kind === "agency" && <th>Название</th>}
              <th style={{ width: 110 }}>Приведено</th>
              <th style={{ width: 170 }}>Последнее (вручную)</th>
              <th style={{ width: 280 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={c.isArchived ? "muted" : undefined}>
                <td>
                  <button className="link-btn" onClick={() => onOpen?.(c.id)}>
                    {c.fullName}
                  </button>
                  {c.isArchived && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      в архиве
                    </span>
                  )}
                </td>
                <td className="tnum">{c.phone ?? "—"}</td>
                {kind === "realtor" && <td>{c.agencyName ?? <span className="subtle">—</span>}</td>}
                {kind === "agency" && <td>{c.companyName ?? "—"}</td>}
                <td className="tnum">{c.referredCount}</td>
                <td className="muted tnum">{formatDateTime(c.lastInteractionAt)}</td>
                <td>
                  <div className="row-actions">
                    {c.isArchived ? (
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => restore.mutate(c.id)}
                        disabled={restore.isPending}
                      >
                        Восстановить
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn-sm" onClick={() => setEditing(c)}>
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => archive.mutate(c.id)}
                          disabled={archive.isPending}
                        >
                          В архив
                        </button>
                      </>
                    )}
                    {user.role === "admin" && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => {
                          if (confirm(`Удалить «${c.fullName}» без возможности восстановления?`)) {
                            remove.mutate(c.id);
                          }
                        }}
                        disabled={remove.isPending}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="empty" style={{ textAlign: "center" }}>
                  Пока пусто
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {(archive.error || restore.error || remove.error) && (
          <p className="alert alert-error" role="alert" style={{ margin: 12 }}>
            {((archive.error || restore.error || remove.error) as ApiError).message}
          </p>
        )}
      </div>
    </>
  );
}

/** Форма создания/редактирования партнёра. */
function PartnerEditor({
  kind,
  initial,
  onDone,
}: {
  kind: ContactKind;
  initial?: Contact;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const isClient = kind === "client";
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(
    isClient ? formatPhoneInput(initial?.phone ?? "") : initial?.phone ?? "",
  );
  const [phoneError, setPhoneError] = useState("");
  const [companyName, setCompanyName] = useState(initial?.companyName ?? "");
  const [agencyId, setAgencyId] = useState(initial?.agencyId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [birthPlace, setBirthPlace] = useState(initial?.birthPlace ?? "");
  const [passportSeries, setPassportSeries] = useState(initial?.passportSeries ?? "");
  const [passportNumber, setPassportNumber] = useState(initial?.passportNumber ?? "");
  const [passportIssuedBy, setPassportIssuedBy] = useState(initial?.passportIssuedBy ?? "");
  const [passportIssuedAt, setPassportIssuedAt] = useState(initial?.passportIssuedAt ?? "");
  const [passportDepartmentCode, setPassportDepartmentCode] = useState(
    initial?.passportDepartmentCode ?? "",
  );
  const [registrationAddress, setRegistrationAddress] = useState(
    initial?.registrationAddress ?? "",
  );
  const [actualAddress, setActualAddress] = useState(initial?.actualAddress ?? "");
  const [lastInteraction, setLastInteraction] = useState(
    toLocalInput(initial?.lastInteractionAt ?? null),
  );

  // Список агентств для выбора у риелтора.
  const agencies = useQuery({
    queryKey: ["contacts", "agency", ""],
    queryFn: () => api.listContacts({ kind: "agency" }),
    enabled: kind === "realtor",
    retry: false,
  });

  const resetPassport = () => {
    setBirthDate("");
    setBirthPlace("");
    setPassportSeries("");
    setPassportNumber("");
    setPassportIssuedBy("");
    setPassportIssuedAt("");
    setPassportDepartmentCode("");
    setRegistrationAddress("");
    setActualAddress("");
  };

  const buildInput = (): UpsertContactInput => ({
    kind,
    fullName: fullName.trim(),
    phone: phone.trim() || null,
    companyName: kind === "agency" ? emptyToNull(companyName) : null,
    agencyId: kind === "realtor" ? agencyId || null : null,
    note: emptyToNull(note),
    ...(isClient
      ? {
          birthDate: emptyToNull(birthDate),
          birthPlace: emptyToNull(birthPlace),
          passportSeries: emptyToNull(passportSeries),
          passportNumber: emptyToNull(passportNumber),
          passportIssuedBy: emptyToNull(passportIssuedBy),
          passportIssuedAt: emptyToNull(passportIssuedAt),
          passportDepartmentCode: emptyToNull(passportDepartmentCode),
          registrationAddress: emptyToNull(registrationAddress),
          actualAddress: emptyToNull(actualAddress),
        }
      : {}),
    lastInteractionAt: lastInteraction ? new Date(lastInteraction).toISOString() : null,
    ...(initial ? { expectedUpdatedAt: initial.updatedAt } : {}),
  });

  const save = useMutation({
    mutationFn: () =>
      initial ? api.updateContact(initial.id, buildInput()) : api.createContact(buildInput()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      if (initial) onDone?.();
      else if (onDone) onDone();
      else {
        setFullName("");
        setPhone("");
        setCompanyName("");
        setAgencyId("");
        setNote("");
        resetPassport();
        setLastInteraction("");
      }
    },
  });

  const kindLabel = CONTACT_KIND_LABEL[kind];
  const submitDisabled =
    save.isPending || !fullName.trim() || phoneInputError(phone, isClient) !== "";

  return (
    <form
      className="card"
      style={{ marginBottom: "1rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!fullName.trim()) return;
        const nextPhoneError = phoneInputError(phone, isClient);
        if (nextPhoneError) {
          setPhoneError(nextPhoneError);
          return;
        }
        save.mutate();
      }}
    >
      <div className="card-head">
        <div className="card-title">
          {initial ? `Редактирование: ${initial.fullName}` : `Новый ${kindLabel.toLowerCase()}`}
        </div>
      </div>
      <div className="card-body">
        <div className="settings-grid">
          <Field label={kind === "agency" ? "Название / контактное лицо" : "ФИО"}>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field label="Телефон">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(isClient ? formatPhoneInput(e.target.value) : e.target.value);
                if (phoneError) setPhoneError("");
              }}
              onBlur={() => setPhoneError(phoneInputError(phone, isClient))}
              aria-invalid={phoneError ? true : undefined}
              placeholder={isClient ? PHONE_PLACEHOLDER : undefined}
              required={isClient}
            />
            {phoneError && (
              <span className="field-error" role="alert">
                {phoneError}
              </span>
            )}
          </Field>
        </div>
        {kind === "agency" && (
          <Field label="Юр. название агентства">
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </Field>
        )}
        {kind === "realtor" && (
          <Field label="Агентство">
            <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
              <option value="">— без агентства —</option>
              {/* Привязанное, но заархивированное агентство нет в списке живых —
                  добавим заглушку, чтобы select не «терял» текущую привязку. */}
              {agencyId &&
                agencies.data &&
                !agencies.data.some((a) => a.id === agencyId) && (
                  <option value={agencyId}>{initial?.agencyName ?? "Агентство"} (архив)</option>
                )}
              {(agencies.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isClient && (
          <details className="settings-group" style={{ margin: "0.3rem 0 1rem" }}>
            <summary className="settings-group-summary">
              <span className="settings-group-chevron" aria-hidden="true">
                ›
              </span>
              <span className="card-title">Паспортные данные</span>
            </summary>
            <div className="settings-group-body">
              <div className="settings-grid">
                <Field label="Дата рождения">
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                </Field>
                <Field label="Место рождения">
                  <input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} />
                </Field>
                <Field label="Серия">
                  <input value={passportSeries} onChange={(e) => setPassportSeries(e.target.value)} />
                </Field>
                <Field label="Номер">
                  <input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} />
                </Field>
                <Field label="Дата выдачи">
                  <input
                    type="date"
                    value={passportIssuedAt}
                    onChange={(e) => setPassportIssuedAt(e.target.value)}
                  />
                </Field>
                <Field label="Код подразделения">
                  <input
                    value={passportDepartmentCode}
                    onChange={(e) => setPassportDepartmentCode(e.target.value)}
                  />
                </Field>
                <div className="field field-wide">
                  <div className="field-label">Кем выдан</div>
                  <textarea
                    value={passportIssuedBy}
                    onChange={(e) => setPassportIssuedBy(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="field field-wide">
                  <div className="field-label">Адрес регистрации</div>
                  <textarea
                    value={registrationAddress}
                    onChange={(e) => setRegistrationAddress(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="field field-wide">
                  <div className="field-label">Фактический адрес</div>
                  <textarea
                    value={actualAddress}
                    onChange={(e) => setActualAddress(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </details>
        )}
        <Field label="Последнее взаимодействие (ручное; иначе считается по заявкам)">
          <input
            type="datetime-local"
            value={lastInteraction}
            onChange={(e) => setLastInteraction(e.target.value)}
          />
        </Field>
        <Field label="Заметка">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        {save.error && (
          <p className="alert alert-error" role="alert">
            {(() => {
              const err = save.error as ApiError;
              const fieldMsgs = err.fields ? Object.values(err.fields) : [];
              return fieldMsgs.length > 0 ? fieldMsgs.join("; ") : err.message;
            })()}
          </p>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="submit" className="btn-primary" disabled={submitDisabled}>
            {initial ? "Сохранить" : "Добавить"}
          </button>
          {initial && (
            <button type="button" onClick={() => onDone?.()}>
              Отмена
            </button>
          )}
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
