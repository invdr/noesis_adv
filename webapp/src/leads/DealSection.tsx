import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BOOKING_STATUS_LABEL,
  DEAL_DOCUMENT_TYPE_LABEL,
  UPLOAD_ACCEPT,
  type DealDocumentType,
  type LeadDetail,
} from "@noesis/contracts";
import { api, apiUrl, ApiError } from "../api/client";
import { shiftDateOnly } from "../shared/date";
import { navigate } from "../router";
import { BookingReports } from "../bookings/BookingReports";

const DOC_TYPES = Object.keys(DEAL_DOCUMENT_TYPE_LABEL) as DealDocumentType[];

function priceLabel(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("ru-RU")} ₽`;
}

/**
 * Вкладка «Сделка» на заявке (Этап 4): привязанные брони (read-only) + закрывающие
 * документы (прикрепление/удаление) и отметка «без документов». «Сделка» — это
 * сама заявка; отдельной сущности нет.
 */
export function DealSection({
  leadId,
  detail,
  editable,
}: {
  leadId: string;
  detail: LeadDetail;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DealDocumentType>("contract");
  const [docName, setDocName] = useState("");
  const [error, setError] = useState("");

  const onDeal = (updated: LeadDetail) => {
    qc.setQueryData?.(["lead", leadId], updated);
    qc.invalidateQueries({ queryKey: ["lead", leadId] });
  };

  const addDoc = useMutation({
    mutationFn: () => api.addDealDocument(leadId, { type: docType, name: docName.trim() || undefined }, file!),
    onSuccess: (updated) => {
      setFile(null);
      setDocName("");
      setError("");
      onDeal(updated);
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : "Не удалось прикрепить документ"),
  });

  const removeDoc = useMutation({
    mutationFn: (docId: string) => api.deleteDealDocument(leadId, docId),
    onSuccess: onDeal,
  });

  const toggleNoDocs = useMutation({
    mutationFn: (noDocuments: boolean) => api.setDealNoDocuments(leadId, noDocuments),
    onSuccess: onDeal,
  });

  // Переход в форму новой брони с префиллом: конструкция и клиент заявки
  // подставляются, привязка к заявке уже выбрана (см. #/bookings/new в router).
  const createBooking = () => {
    const params = new URLSearchParams({ leadId });
    if (detail.constructionId) params.set("constructionId", detail.constructionId);
    if (detail.contactId) params.set("clientId", detail.contactId);
    navigate(`/bookings/new?${params.toString()}`);
  };

  return (
    <section className="card">
      <div className="card-body">
        <h3 className="section-title">Брони и документы</h3>

        <h4 className="deal-subtitle">Брони</h4>
        {detail.bookings.length === 0 ? (
          <p className="empty">Броней не привязано.</p>
        ) : (
          <ul className="deal-bookings">
            {detail.bookings.map((b) => (
              <li key={b.id} className="deal-booking">
                <span className="deal-booking-main">
                  {(b.constructionCode || b.constructionName)} · {b.sideCode}
                </span>
                <span className="deal-booking-meta tnum">
                  {b.startDate} – {b.endDate}
                </span>
                <span className={`badge ${b.status === "cancelled" ? "badge-neutral" : "badge-info"}`}>
                  {BOOKING_STATUS_LABEL[b.status]}
                </span>
                <span className="deal-booking-price tnum">{priceLabel(b.totalPrice)}</span>
                <BookingReports
                  booking={{
                    id: b.id,
                    status: b.status,
                    startDate: b.startDate,
                    // В сводке сделки endDate уже включающий — возвращаем к
                    // полуоткрытой границе, которую ждёт компонент.
                    exclusiveEndDate: shiftDateOnly(b.endDate, 1),
                  }}
                  readOnly
                  compact
                />
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <p style={{ margin: "8px 0 0" }}>
            <button type="button" className="btn-sm" onClick={createBooking}>
              + Создать бронь по заявке
            </button>
          </p>
        )}

        {editable && (
          <>
            <h4 className="deal-subtitle">Документы</h4>
            {detail.dealDocuments.length === 0 ? (
              <p className="empty" style={{ marginBottom: 8 }}>
                {detail.dealNoDocuments ? "Отмечено «без документов»." : "Документы не прикреплены."}
              </p>
            ) : (
              <ul className="deal-docs">
                {detail.dealDocuments.map((doc) => (
                  <li key={doc.id} className="deal-doc">
                    <span className="badge badge-neutral">{DEAL_DOCUMENT_TYPE_LABEL[doc.type]}</span>
                    <a href={apiUrl(doc.asset.url)} target="_blank" rel="noopener" className="deal-doc-name">
                      {doc.name}
                    </a>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => {
                        if (window.confirm("Удалить документ безвозвратно?")) removeDoc.mutate(doc.id);
                      }}
                    >
                      удалить
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="deal-upload"
              onSubmit={(e) => {
                e.preventDefault();
                if (file) addDoc.mutate();
              }}
            >
              <select value={docType} onChange={(e) => setDocType(e.target.value as DealDocumentType)}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DEAL_DOCUMENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Название (необязательно)"
                style={{ flex: "1 1 180px", minWidth: 0 }}
              />
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept={UPLOAD_ACCEPT}
              />
              <button type="submit" className="btn-primary" disabled={!file || addDoc.isPending}>
                Прикрепить
              </button>
            </form>
            {error && (
              <p className="alert alert-error" role="alert" style={{ marginTop: 8 }}>
                {error}
              </p>
            )}

            <label className="deal-nodocs">
              <input
                type="checkbox"
                checked={detail.dealNoDocuments}
                disabled={detail.dealDocuments.length > 0 || toggleNoDocs.isPending}
                onChange={(e) => toggleNoDocs.mutate(e.target.checked)}
              />
              <span>По сделке документов нет</span>
            </label>
          </>
        )}
      </div>
    </section>
  );
}
