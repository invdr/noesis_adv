import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CONTACT_KIND_LABEL, type ContactLeadRef } from "@gsk-tower/contracts";
import { api } from "../api/client";
import { copyToClipboard } from "../ui/clipboard";
import { navigate } from "../router";
import { formatDateTime, sourceLabel } from "../leads/shared";
import "./ContactCard.css";

/**
 * Карточка контакта (`#/contacts/<id>`): данные + заявки. Клиенту показываем
 * его заявки-покупателя, партнёру (риелтор/агентство) — приведённые. Списки
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
  const isClient = c.kind === "client";
  const leads = isClient ? c.leads : c.referredLeads;
  const passportRows = isClient
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
          <span className="badge badge-neutral">{CONTACT_KIND_LABEL[c.kind]}</span>
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
          {c.agencyName && <span>агентство: {c.agencyName}</span>}
          {c.companyName && <span>{c.companyName}</span>}
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

      <section className="card">
        <div className="card-body">
          <h3 className="section-title">
            {isClient ? `Заявки клиента (${leads.length})` : `Приведённые заявки (${leads.length})`}
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
                  <th>ЖК</th>
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
