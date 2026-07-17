import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ALLOWED_IMAGE_MIMES,
  MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST,
  type BookingReport,
  type BookingStatus,
} from "@noesis/contracts";
import { api, ApiError, apiUrl } from "../api/client";
import { previousDateOnly, productToday } from "../shared/date";

type BookingReportTarget = {
  id: string;
  status: BookingStatus;
  /** В карточке брони `endDate` — первый свободный день, не включённый в период. */
  startDate?: string;
  endDate?: string;
};

/**
 * Внутренние помесячные фотоотчёты по размещению. В отличие от ProjectProgress,
 * эти изображения всегда читаются через авторизованный API, а не из `/files`.
 */
export function BookingReports({
  booking,
  readOnly = false,
  compact = false,
}: {
  booking: BookingReportTarget;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const key = ["booking-reports", booking.id];
  const [error, setError] = useState("");
  const reports = useQuery({
    queryKey: key,
    queryFn: () => api.listBookingReports(booking.id),
  });
  const canManage = !readOnly && booking.status !== "cancelled";
  const canCreate = canManage && Boolean(booking.startDate && booking.endDate);

  const changed = () => {
    setError("");
    qc.invalidateQueries({ queryKey: key });
  };
  const failed = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Не удалось изменить фотоотчёт");
    qc.invalidateQueries({ queryKey: key });
  };

  const removeReport = useMutation({
    mutationFn: (reportId: string) => api.deleteBookingReport(booking.id, reportId),
    onSuccess: changed,
    onError: failed,
  });
  const items = reports.data ?? [];

  return (
    <div style={compact ? { marginTop: 10, width: "100%" } : undefined}>
      {!compact && <h3 className="section-title">Фотоотчёты о размещении</h3>}
      {compact && items.length > 0 && (
        <div className="subtle-sm" style={{ marginTop: 2 }}>
          Фотоотчёты
        </div>
      )}
      {reports.isError && (
        <p className="alert alert-error" role="alert">
          Не удалось загрузить фотоотчёты
        </p>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {items.map((report) => (
        <ReportRow
          key={report.id}
          bookingId={booking.id}
          report={report}
          canManage={canManage}
          minDate={booking.startDate}
          maxDate={booking.endDate ? previousDateOnly(booking.endDate) : undefined}
          onChanged={changed}
          onError={failed}
          onDelete={() => {
            if (window.confirm(`Удалить фотоотчёт за ${report.date} со всеми фотографиями?`)) {
              removeReport.mutate(report.id);
            }
          }}
        />
      ))}
      {!reports.isLoading && items.length === 0 && (
        <p className="empty">Фотоотчётов пока нет.</p>
      )}
      {canCreate && (
        <AddReport
          bookingId={booking.id}
          initialDate={booking.startDate ?? productToday()}
          minDate={booking.startDate!}
          maxDate={previousDateOnly(booking.endDate!)}
          onAdded={changed}
          onError={failed}
        />
      )}
      {booking.status === "cancelled" && !readOnly && (
        <p className="hint">К отменённой брони нельзя добавлять или менять фотоотчёты.</p>
      )}
    </div>
  );
}

function ReportRow({
  bookingId,
  report,
  canManage,
  minDate,
  maxDate,
  onChanged,
  onError,
  onDelete,
}: {
  bookingId: string;
  report: BookingReport;
  canManage: boolean;
  minDate?: string;
  maxDate?: string;
  onChanged: () => void;
  onError: (e: unknown) => void;
  onDelete: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const update = useMutation({
    mutationFn: (next: { date: string; note: string }) =>
      api.updateBookingReport(bookingId, report.id, {
        date: next.date,
        note: next.note.trim() || undefined,
      }),
    onSuccess: onChanged,
    onError,
  });
  const addPhotos = useMutation({
    mutationFn: (files: File[]) => api.addBookingReportPhotos(bookingId, report.id, files),
    onSettled: () => {
      if (input.current) input.current.value = "";
    },
    onSuccess: onChanged,
    onError,
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: string) => api.deleteBookingReportPhoto(bookingId, report.id, photoId),
    onSuccess: onChanged,
    onError,
  });

  return (
    <div className="divider-top">
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        {canManage ? (
          <input
            type="date"
            defaultValue={report.date}
            min={minDate}
            max={maxDate}
            aria-label="Дата фотоотчёта"
            onBlur={(e) => {
              if (e.target.value && e.target.value !== report.date) {
                update.mutate({ date: e.target.value, note: report.note ?? "" });
              }
            }}
          />
        ) : (
          <strong>{report.date}</strong>
        )}
        <span className="subtle-sm">
          {report.photos.length} фото
        </span>
        {canManage && (
          <>
            <span style={{ flex: 1 }} />
            <button type="button" className="icon-btn" aria-label="Удалить фотоотчёт" onClick={onDelete}>
              ×
            </button>
          </>
        )}
      </div>
      {canManage ? (
        <input
          defaultValue={report.note ?? ""}
          placeholder="Комментарий к размещению (необязательно)"
          maxLength={300}
          style={{ width: "100%", marginTop: 6 }}
          onBlur={(e) => {
            const note = e.target.value.trim();
            if (note !== (report.note ?? "")) update.mutate({ date: report.date, note });
          }}
        />
      ) : report.note ? (
        <p className="subtle" style={{ margin: "6px 0 0" }}>
          {report.note}
        </p>
      ) : null}
      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        {report.photos.map((photo) => (
          <div key={photo.id} style={{ position: "relative" }}>
            <a href={apiUrl(photo.url)} target="_blank" rel="noopener noreferrer">
              <img
                src={apiUrl(photo.url)}
                alt={photo.originalName}
                loading="lazy"
                className="photo-thumb"
              />
            </a>
            {canManage && (
              <button
                type="button"
                className="icon-btn photo-thumb-remove"
                aria-label="Удалить фото"
                onClick={() => {
                  if (window.confirm("Удалить фото безвозвратно?")) removePhoto.mutate(photo.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canManage && (
          <label className="btn-ghost" style={{ alignSelf: "center", cursor: "pointer" }}>
            <input
              ref={input}
              type="file"
              accept={ALLOWED_IMAGE_MIMES.join(",")}
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length > MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST) {
                  e.target.value = "";
                  onError(
                    new Error(
                      `За раз можно загрузить не больше ${MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST} фото (выбрано ${files.length}).`,
                    ),
                  );
                  return;
                }
                if (files.length > 0) addPhotos.mutate(files);
              }}
            />
            {addPhotos.isPending ? "Загрузка…" : "+ фото"}
          </label>
        )}
      </div>
    </div>
  );
}

function AddReport({
  bookingId,
  initialDate,
  minDate,
  maxDate,
  onAdded,
  onError,
}: {
  bookingId: string;
  initialDate: string;
  minDate: string;
  maxDate: string;
  onAdded: () => void;
  onError: (e: unknown) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => api.createBookingReport(bookingId, { date, note: note.trim() || undefined }),
    onSuccess: () => {
      setNote("");
      onAdded();
    },
    onError,
  });

  return (
    <div className="divider-top">
      <div className="row wrap" style={{ gap: 8 }}>
        <input type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий (необязательно)"
          maxLength={300}
          style={{ minWidth: 220 }}
        />
        <button type="button" className="btn-primary" disabled={!date || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Добавление…" : "+ фотоотчёт"}
        </button>
      </div>
    </div>
  );
}
