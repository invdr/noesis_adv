import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { COUNTERPARTY_TYPE_LABEL, type ContactLeadRef } from "@noesis/contracts";
import { api } from "../api/client";
import { copyToClipboard } from "../ui/clipboard";
import { navigate } from "../router";
import { formatDateTime, sourceLabel } from "../leads/shared";
import "./ContactCard.css";

/**
 * Карточка контакта (`#/contacts/<id>`): данные + заявки. Клиенту показываем
 * его заявки-покупателя, партнёру — приведённые. Списки
 * уже отфильтрованы видимостью на бэке. Read-only: партнёров редактируют в
 * списке, клиент — агрегат по заявкам.
 */
export function ContactCard({ contactId, onBack }: { contactId: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const contact = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => api.getContact(contactId),
    retry: false,
  });

  if (contact.isLoading) return <p className="hint">Загрузка…</p>;
  if (contact.error || !contact.data) {
    return (
      <div className="contact-card">
        <button className="btn-ghost" onClick={onBack}>
          ← к списку
        </button>
        <p className="alert alert-error contact-card__error-alert" role="alert">
          {(contact.error as Error)?.message ?? "Контакт не найден"}
        </p>
      </div>
    );
  }

  const c = contact.data;
  const leads = c.isClient && c.isPartner ? [...c.leads, ...c.referredLeads] : c.isClient ? c.leads : c.referredLeads;
  const leadsTitle = c.isClient && c.isPartner
    ? `Заявки клиента и приведённые (${leads.length})`
    : c.isClient
      ? `Заявки клиента (${leads.length})`
      : `Приведённые заявки (${leads.length})`;
  const passportRows = c.type === "individual"
    ? [
        ["Дата рождения", c.birthDate],
        ["Место рождения", c.birthPlace],
        ["Серия", c.passportSeries],
        ["Номер", c.passportNumber],
        ["Дата выдачи", c.passportIssuedAt],
        ["Код подразделения", c.passportDepartmentCode],
        ["Кем выдан", c.passportIssuedBy],
        ["Адрес регистрации", c.registrationAddress],
        ["Фактический адрес", c.actualAddress],
      ].filter((row): row is [string, string] => Boolean(row[1]))
    : [];

  const copyPhone = (phone: string) => {
    void copyToClipboard(phone);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="contact-card">
      <button className="btn-ghost contact-card__back" onClick={onBack}>
        ← к списку
      </button>

      <div className="contact-card__header">
        <h2 className="contact-card__title">
          {c.fullName}
          <span className="badge badge-neutral">{COUNTERPARTY_TYPE_LABEL[c.type]}</span>
          {c.isClient && <span className="badge badge-info">клиент</span>}
          {c.isPartner && <span className="badge badge-neutral">партнёр</span>}
          {c.isArchived && <span className="badge badge-warn">в архиве</span>}
        </h2>
        <div className="contact-card__meta">
          {c.phone && (
            <span className="contact-card__phone">
              <a className="tnum lead-phone" href={`tel:${c.phone}`}>
                {c.phone}
              </a>
              <button
                type="button"
                className="btn-sm"
                onClick={() => copyPhone(c.phone!)}
                title="Скопировать телефон"
              >
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </span>
          )}
          {c.organizationName && <span>компания: {c.organizationName}</span>}
          {c.legalName && c.legalName !== c.fullName && <span>{c.legalName}</span>}
          {c.lastInteractionAt && (
            <span className="subtle">
              последнее взаимодействие: {formatDateTime(c.lastInteractionAt)}
            </span>
          )}
        </div>
        {c.note && (
          <p className="hint contact-card__note">
            {c.note}
          </p>
        )}
      </div>

      {passportRows.length > 0 && (
        <details className="card lead-collapse contact-card__passport">
          <summary className="lead-collapse-summary">
            <span className="lead-collapse-chevron" aria-hidden="true">
              ›
            </span>
            <h3 className="section-title" style={{ margin: 0 }}>
              Паспортные данные
            </h3>
          </summary>
          <div className="card-body">
            <dl className="contact-card__details">
              {passportRows.map(([label, value]) => (
                <div key={label} className="contact-card__details-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      )}

      <Requisites contact={c} />

      <section className="card">
        <div className="card-body">
          <h3 className="section-title">
            {leadsTitle}
          </h3>
          {leads.length === 0 ? (
            <p className="empty">Заявок нет.</p>
          ) : (
            <table className="table-flush table-hover">
              <thead>
                <tr>
                  <th className="contact-card__date-col">Дата</th>
                  <th>Имя</th>
                  <th>Источник</th>
                  <th>Конструкция</th>
                  <th className="contact-card__stage-col">Этап</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: ContactLeadRef) => (
                  <tr key={l.id}>
                    <td className="muted tnum">{formatDateTime(l.createdAt)}</td>
                    <td>
                      <button className="link-btn" onClick={() => navigate(`/leads/${l.id}`)}>
                        {l.name}
                      </button>
                    </td>
                    <td>{l.sourceName ?? sourceLabel(l.source)}</td>
                    <td>{l.projectName ?? <span className="subtle">—</span>}</td>
                    <td>{l.stage.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Requisites({ contact }: { contact: import("@noesis/contracts").Contact }) {
  const rows = [
    ["Юридическое название", contact.legalName],
    ["ИНН", contact.inn],
    ["КПП", contact.kpp],
    ["ОГРН / ОГРНИП", contact.ogrn],
    ["Юридический адрес", contact.legalAddress],
    ["Почтовый адрес", contact.postalAddress],
    ["Должность руководителя", contact.directorTitle],
    ["ФИО руководителя", contact.directorFullName],
    ["Основание полномочий", contact.directorBasis],
    ["Банк", contact.bankName],
    ["БИК", contact.bankBik],
    ["Расчётный счёт", contact.bankAccount],
    ["Корреспондентский счёт", contact.correspondentAccount],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  if (rows.length === 0) return null;
  return (
    <details className="card lead-collapse contact-card__passport">
      <summary className="lead-collapse-summary">
        <span className="lead-collapse-chevron" aria-hidden="true">›</span>
        <h3 className="section-title" style={{ margin: 0 }}>Реквизиты</h3>
      </summary>
      <div className="card-body">
        <dl className="contact-card__details">
          {rows.map(([label, value]) => <div key={label} className="contact-card__details-row"><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </div>
    </details>
  );
}
