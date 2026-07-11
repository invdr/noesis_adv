import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, CounterpartyType, SessionUser, UpsertContactInput } from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import { formatPhoneInput, PHONE_PLACEHOLDER, phoneInputError } from "../ui/phone";
import { ContactCard } from "./ContactCard";

type ContactsTab = "clients" | "partners" | "companies";

const TABS: { id: ContactsTab; label: string }[] = [
  { id: "clients", label: "Клиенты" },
  { id: "partners", label: "Партнёры" },
  { id: "companies", label: "Компании" },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function emptyToNull(value: string): string | null {
  return value.trim() || null;
}

function tabQuery(tab: ContactsTab) {
  if (tab === "clients") return { role: "client" as const };
  if (tab === "partners") return { role: "partner" as const, type: "individual" as const };
  return { type: "company" as const };
}

function defaultForTab(tab: ContactsTab) {
  if (tab === "clients") return { type: "individual" as const, isClient: true, isPartner: false };
  if (tab === "partners") return { type: "individual" as const, isClient: false, isPartner: true };
  return { type: "company" as const, isClient: false, isPartner: true };
}

export function ContactsView({
  user,
  selectedContactId,
  onOpenContact,
  onCloseContact,
}: {
  user: SessionUser;
  selectedContactId?: string;
  onOpenContact?: (id: string) => void;
  onCloseContact?: () => void;
}) {
  const [tab, setTab] = useState<ContactsTab>("clients");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const query = tabQuery(tab);
  const contacts = useQuery({
    queryKey: ["contacts", tab, search, includeArchived],
    queryFn: () => api.listContacts({ ...query, search: search || undefined, includeArchived: includeArchived || undefined }),
    retry: false,
  });
  const managers = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: user.role === "admin" && tab === "clients",
    retry: false,
  });
  const userById = useMemo(
    () => new Map((managers.data ?? []).map((u) => [u.id, u] as const)),
    [managers.data],
  );

  if (selectedContactId) {
    return <ContactCard contactId={selectedContactId} onBack={() => onCloseContact?.()} />;
  }

  return (
    <section>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === tab ? "btn-primary" : ""}
            onClick={() => {
              setTab(item.id);
              setIncludeArchived(false);
              setShowAddForm(false);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="hint">
        Контрагент может одновременно быть клиентом и партнёром. Компания и её представители
        ведутся в отдельных карточках; реквизиты хранятся в карточке контрагента.
      </p>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchDraft.trim());
        }}
      >
        <input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Поиск по имени, реквизитам или телефону"
          style={{ minWidth: 280 }}
        />
        <button type="submit" className="btn-primary">Найти</button>
        {search && (
          <button type="button" onClick={() => { setSearchDraft(""); setSearch(""); }}>
            Сбросить
          </button>
        )}
      </form>

      {user.role === "admin" && (
        <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Показывать архивные
        </label>
      )}

      <div className="toolbar">
        <button type="button" className={showAddForm ? "" : "btn-primary"} onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Скрыть форму" : tab === "companies" ? "Добавить компанию" : tab === "partners" ? "Добавить партнёра" : "Добавить клиента"}
        </button>
      </div>

      {showAddForm && <CounterpartyEditor key={`add-${tab}`} defaults={defaultForTab(tab)} onDone={() => setShowAddForm(false)} />}
      {contacts.isLoading && <p className="hint">Загрузка…</p>}
      {contacts.error && <p className="alert alert-error" role="alert">{(contacts.error as Error).message}</p>}
      {contacts.data && (
        <CounterpartyTable
          list={contacts.data}
          user={user}
          tab={tab}
          userById={userById}
          onOpen={onOpenContact}
        />
      )}
    </section>
  );
}

function CounterpartyTable({
  list,
  user,
  tab,
  userById,
  onOpen,
}: {
  list: Contact[];
  user: SessionUser;
  tab: ContactsTab;
  userById: Map<string, { id: string; email: string; name: string | null }>;
  onOpen?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Contact | null>(null);
  const archive = useMutation({ mutationFn: api.archiveContact, onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }) });
  const restore = useMutation({ mutationFn: api.restoreContact, onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }) });
  const remove = useMutation({ mutationFn: api.deleteContact, onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }) });
  const isClientList = tab === "clients";

  return (
    <>
      {editing && <CounterpartyEditor key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>{tab === "companies" ? "Компания" : "Контрагент"}</th>
              <th>Роли</th>
              <th>Телефон</th>
              {tab === "partners" && <th>Компания</th>}
              {isClientList && <th>Заявок</th>}
              {isClientList && <th>Ответственный</th>}
              {!isClientList && <th>Приведено</th>}
              <th style={{ width: 230 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const manager = c.assigneeId ? userById.get(c.assigneeId) : null;
              return (
                <tr key={c.id} className={c.isArchived ? "muted" : undefined}>
                  <td>
                    <button className="link-btn" onClick={() => onOpen?.(c.id)}>{c.fullName}</button>
                    {c.legalName && c.legalName !== c.fullName && <div className="subtle">{c.legalName}</div>}
                    {c.isArchived && <span className="badge" style={{ marginLeft: 8 }}>в архиве</span>}
                  </td>
                  <td>
                    {c.isClient && <span className="badge badge-info">клиент</span>}
                    {c.isPartner && <span className="badge badge-neutral" style={{ marginLeft: c.isClient ? 4 : 0 }}>партнёр</span>}
                  </td>
                  <td className="tnum">{c.phone ?? "—"}</td>
                  {tab === "partners" && <td>{c.organizationName ?? <span className="subtle">—</span>}</td>}
                  {isClientList && <td className="tnum">{c.leadsCount}</td>}
                  {isClientList && <td>{manager ? (manager.name || manager.email) : <span className="subtle">Не назначен</span>}</td>}
                  {!isClientList && <td className="tnum">{c.referredCount}</td>}
                  <td>
                    <div className="row-actions">
                      {c.isArchived ? (
                        <button type="button" className="btn-sm" onClick={() => restore.mutate(c.id)} disabled={restore.isPending}>Восстановить</button>
                      ) : (
                        <>
                          <button type="button" className="btn-sm" onClick={() => setEditing(c)}>Изменить</button>
                          <button type="button" className="btn-sm" onClick={() => archive.mutate(c.id)} disabled={archive.isPending}>В архив</button>
                        </>
                      )}
                      {user.role === "admin" && (
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => { if (confirm(`Удалить «${c.fullName}» без возможности восстановления?`)) remove.mutate(c.id); }}
                          disabled={remove.isPending}
                        >Удалить</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={8} className="empty" style={{ textAlign: "center" }}>Пока пусто</td></tr>}
          </tbody>
        </table>
        {(archive.error || restore.error || remove.error) && <p className="alert alert-error" role="alert" style={{ margin: 12 }}>{((archive.error || restore.error || remove.error) as ApiError).message}</p>}
      </div>
    </>
  );
}

function CounterpartyEditor({
  initial,
  defaults,
  onDone,
}: {
  initial?: Contact;
  defaults?: { type: CounterpartyType; isClient: boolean; isPartner: boolean };
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const start = defaults ?? { type: initial?.type ?? "individual", isClient: initial?.isClient ?? true, isPartner: initial?.isPartner ?? false };
  const [type, setType] = useState<CounterpartyType>(start.type);
  const [isClient, setIsClient] = useState(start.isClient);
  const [isPartner, setIsPartner] = useState(start.isPartner);
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [phoneError, setPhoneError] = useState("");
  const [organizationId, setOrganizationId] = useState(initial?.organizationId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [birthPlace, setBirthPlace] = useState(initial?.birthPlace ?? "");
  const [passportSeries, setPassportSeries] = useState(initial?.passportSeries ?? "");
  const [passportNumber, setPassportNumber] = useState(initial?.passportNumber ?? "");
  const [passportIssuedBy, setPassportIssuedBy] = useState(initial?.passportIssuedBy ?? "");
  const [passportIssuedAt, setPassportIssuedAt] = useState(initial?.passportIssuedAt ?? "");
  const [passportDepartmentCode, setPassportDepartmentCode] = useState(initial?.passportDepartmentCode ?? "");
  const [registrationAddress, setRegistrationAddress] = useState(initial?.registrationAddress ?? "");
  const [actualAddress, setActualAddress] = useState(initial?.actualAddress ?? "");
  const [legalName, setLegalName] = useState(initial?.legalName ?? "");
  const [inn, setInn] = useState(initial?.inn ?? "");
  const [kpp, setKpp] = useState(initial?.kpp ?? "");
  const [ogrn, setOgrn] = useState(initial?.ogrn ?? "");
  const [legalAddress, setLegalAddress] = useState(initial?.legalAddress ?? "");
  const [postalAddress, setPostalAddress] = useState(initial?.postalAddress ?? "");
  const [directorTitle, setDirectorTitle] = useState(initial?.directorTitle ?? "");
  const [directorFullName, setDirectorFullName] = useState(initial?.directorFullName ?? "");
  const [directorBasis, setDirectorBasis] = useState(initial?.directorBasis ?? "");
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [bankBik, setBankBik] = useState(initial?.bankBik ?? "");
  const [bankAccount, setBankAccount] = useState(initial?.bankAccount ?? "");
  const [correspondentAccount, setCorrespondentAccount] = useState(initial?.correspondentAccount ?? "");
  const [lastInteraction, setLastInteraction] = useState(toLocalInput(initial?.lastInteractionAt ?? null));
  const companies = useQuery({
    queryKey: ["contacts", "companies-for-representatives"],
    queryFn: () => api.listContacts({ type: "company" }),
    enabled: type === "individual" && isPartner,
    retry: false,
  });
  const isIndividual = type === "individual";
  const canHaveOrganization = isIndividual && isPartner;
  const requirePhone = isClient;
  const buildInput = (): UpsertContactInput => ({
    type,
    isClient,
    isPartner,
    fullName: fullName.trim(),
    phone: phone.trim() || null,
    organizationId: canHaveOrganization ? organizationId || null : null,
    note: emptyToNull(note),
    birthDate: isIndividual ? emptyToNull(birthDate) : null,
    birthPlace: isIndividual ? emptyToNull(birthPlace) : null,
    passportSeries: isIndividual ? emptyToNull(passportSeries) : null,
    passportNumber: isIndividual ? emptyToNull(passportNumber) : null,
    passportIssuedBy: isIndividual ? emptyToNull(passportIssuedBy) : null,
    passportIssuedAt: isIndividual ? emptyToNull(passportIssuedAt) : null,
    passportDepartmentCode: isIndividual ? emptyToNull(passportDepartmentCode) : null,
    registrationAddress: isIndividual ? emptyToNull(registrationAddress) : null,
    actualAddress: isIndividual ? emptyToNull(actualAddress) : null,
    legalName: !isIndividual ? emptyToNull(legalName) : null,
    inn: !isIndividual ? emptyToNull(inn) : null,
    kpp: !isIndividual ? emptyToNull(kpp) : null,
    ogrn: !isIndividual ? emptyToNull(ogrn) : null,
    legalAddress: !isIndividual ? emptyToNull(legalAddress) : null,
    postalAddress: !isIndividual ? emptyToNull(postalAddress) : null,
    directorTitle: !isIndividual ? emptyToNull(directorTitle) : null,
    directorFullName: !isIndividual ? emptyToNull(directorFullName) : null,
    directorBasis: !isIndividual ? emptyToNull(directorBasis) : null,
    bankName: emptyToNull(bankName),
    bankBik: emptyToNull(bankBik),
    bankAccount: emptyToNull(bankAccount),
    correspondentAccount: emptyToNull(correspondentAccount),
    lastInteractionAt: lastInteraction ? new Date(lastInteraction).toISOString() : null,
    ...(initial ? { expectedUpdatedAt: initial.updatedAt } : {}),
  });
  const save = useMutation({
    mutationFn: () => initial ? api.updateContact(initial.id, buildInput()) : api.createContact(buildInput()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); onDone?.(); },
  });
  const submitDisabled = save.isPending || !fullName.trim() || !isClient && !isPartner || phoneInputError(phone, requirePhone) !== "";

  return (
    <form className="card" style={{ marginBottom: "1rem" }} onSubmit={(e) => {
      e.preventDefault();
      const error = phoneInputError(phone, requirePhone);
      if (error) { setPhoneError(error); return; }
      save.mutate();
    }}>
      <div className="card-head"><div className="card-title">{initial ? `Редактирование: ${initial.fullName}` : "Новый контрагент"}</div></div>
      <div className="card-body">
        <div className="settings-grid">
          <Field label="Вид контрагента">
            <select value={type} onChange={(e) => { const next = e.target.value as CounterpartyType; setType(next); if (next === "company") setOrganizationId(""); }}>
              <option value="individual">Человек</option><option value="company">Компания</option>
            </select>
          </Field>
          <Field label={type === "company" ? "Название для работы" : "ФИО"}><input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></Field>
          <Field label="Телефон">
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(requirePhone ? formatPhoneInput(e.target.value) : e.target.value); if (phoneError) setPhoneError(""); }} onBlur={() => setPhoneError(phoneInputError(phone, requirePhone))} placeholder={requirePhone ? PHONE_PLACEHOLDER : undefined} required={requirePhone} />
            {phoneError && <span className="field-error" role="alert">{phoneError}</span>}
          </Field>
        </div>
        <div className="row" style={{ gap: 18, margin: "12px 0" }}>
          <label><input type="checkbox" checked={isClient} onChange={(e) => setIsClient(e.target.checked)} /> Клиент</label>
          <label><input type="checkbox" checked={isPartner} onChange={(e) => setIsPartner(e.target.checked)} /> Партнёр</label>
        </div>
        {canHaveOrganization && <Field label="Компания партнёра"><select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}><option value="">— без компании —</option>{organizationId && companies.data && !companies.data.some((company) => company.id === organizationId) && <option value={organizationId}>{initial?.organizationName ?? "Компания"} (архив)</option>}{(companies.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.fullName}</option>)}</select></Field>}
        {isIndividual ? <IndividualFields {...{ birthDate, setBirthDate, birthPlace, setBirthPlace, passportSeries, setPassportSeries, passportNumber, setPassportNumber, passportIssuedBy, setPassportIssuedBy, passportIssuedAt, setPassportIssuedAt, passportDepartmentCode, setPassportDepartmentCode, registrationAddress, setRegistrationAddress, actualAddress, setActualAddress }} /> : <CompanyFields {...{ legalName, setLegalName, inn, setInn, kpp, setKpp, ogrn, setOgrn, legalAddress, setLegalAddress, postalAddress, setPostalAddress, directorTitle, setDirectorTitle, directorFullName, setDirectorFullName, directorBasis, setDirectorBasis }} />}
        <details className="settings-group" style={{ margin: "0.3rem 0 1rem" }}><summary className="settings-group-summary"><span className="settings-group-chevron" aria-hidden="true">›</span><span className="card-title">Банковские реквизиты</span></summary><div className="settings-group-body"><div className="settings-grid"><Field label="Банк"><input value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field><Field label="БИК"><input value={bankBik} onChange={(e) => setBankBik(e.target.value)} /></Field><Field label="Расчётный счёт"><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} /></Field><Field label="Корреспондентский счёт"><input value={correspondentAccount} onChange={(e) => setCorrespondentAccount(e.target.value)} /></Field></div></div></details>
        <Field label="Последнее взаимодействие (ручное; иначе считается по заявкам)"><input type="datetime-local" value={lastInteraction} onChange={(e) => setLastInteraction(e.target.value)} /></Field>
        <Field label="Заметка"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
        {save.error && <p className="alert alert-error" role="alert">{(() => { const err = save.error as ApiError; const fields = err.fields ? Object.values(err.fields) : []; return fields.length ? fields.join("; ") : err.message; })()}</p>}
        <div className="row" style={{ gap: 10 }}><button type="submit" className="btn-primary" disabled={submitDisabled}>{initial ? "Сохранить" : "Добавить"}</button>{initial && <button type="button" onClick={() => onDone?.()}>Отмена</button>}</div>
      </div>
    </form>
  );
}

type Setter = (value: string) => void;
function IndividualFields(props: Record<string, string | Setter>) {
  const get = (name: string) => props[name] as string;
  const set = (name: string) => props[`set${name.charAt(0).toUpperCase()}${name.slice(1)}`] as Setter;
  return <details className="settings-group" style={{ margin: "0.3rem 0 1rem" }}><summary className="settings-group-summary"><span className="settings-group-chevron" aria-hidden="true">›</span><span className="card-title">Паспортные данные</span></summary><div className="settings-group-body"><div className="settings-grid"><Field label="Дата рождения"><input type="date" value={get("birthDate")} onChange={(e) => set("birthDate")(e.target.value)} /></Field><Field label="Место рождения"><input value={get("birthPlace")} onChange={(e) => set("birthPlace")(e.target.value)} /></Field><Field label="Серия"><input value={get("passportSeries")} onChange={(e) => set("passportSeries")(e.target.value)} /></Field><Field label="Номер"><input value={get("passportNumber")} onChange={(e) => set("passportNumber")(e.target.value)} /></Field><Field label="Дата выдачи"><input type="date" value={get("passportIssuedAt")} onChange={(e) => set("passportIssuedAt")(e.target.value)} /></Field><Field label="Код подразделения"><input value={get("passportDepartmentCode")} onChange={(e) => set("passportDepartmentCode")(e.target.value)} /></Field><Field label="Кем выдан"><input value={get("passportIssuedBy")} onChange={(e) => set("passportIssuedBy")(e.target.value)} /></Field><Field label="Адрес регистрации"><input value={get("registrationAddress")} onChange={(e) => set("registrationAddress")(e.target.value)} /></Field><Field label="Фактический адрес"><input value={get("actualAddress")} onChange={(e) => set("actualAddress")(e.target.value)} /></Field></div></div></details>;
}

function CompanyFields(props: Record<string, string | Setter>) {
  const get = (name: string) => props[name] as string;
  const set = (name: string) => props[`set${name.charAt(0).toUpperCase()}${name.slice(1)}`] as Setter;
  return <details className="settings-group" open style={{ margin: "0.3rem 0 1rem" }}><summary className="settings-group-summary"><span className="settings-group-chevron" aria-hidden="true">›</span><span className="card-title">Реквизиты компании</span></summary><div className="settings-group-body"><div className="settings-grid"><Field label="Юридическое название"><input value={get("legalName")} onChange={(e) => set("legalName")(e.target.value)} /></Field><Field label="ИНН"><input value={get("inn")} onChange={(e) => set("inn")(e.target.value)} /></Field><Field label="КПП"><input value={get("kpp")} onChange={(e) => set("kpp")(e.target.value)} /></Field><Field label="ОГРН / ОГРНИП"><input value={get("ogrn")} onChange={(e) => set("ogrn")(e.target.value)} /></Field><Field label="Юридический адрес"><input value={get("legalAddress")} onChange={(e) => set("legalAddress")(e.target.value)} /></Field><Field label="Почтовый адрес"><input value={get("postalAddress")} onChange={(e) => set("postalAddress")(e.target.value)} /></Field><Field label="Должность руководителя"><input value={get("directorTitle")} onChange={(e) => set("directorTitle")(e.target.value)} /></Field><Field label="ФИО руководителя"><input value={get("directorFullName")} onChange={(e) => set("directorFullName")(e.target.value)} /></Field><Field label="Основание полномочий"><input value={get("directorBasis")} onChange={(e) => set("directorBasis")(e.target.value)} /></Field></div></div></details>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><div className="field-label">{label}</div>{children}</div>;
}
