import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBookingMonths,
  bookingDefaultTotal,
  BOOKING_KIND_LABEL,
  BOOKING_STATUS_LABEL,
  defaultBookingReminder,
  type AdminUser,
  type Booking,
  type BookingKind,
  type BookingStatus,
  type Construction,
  type ConstructionSide,
  type Contact,
  type SessionUser,
  type UpsertBookingInput,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";

const KEY = ["bookings"];
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_KEYS: BookingStatus[] = ["booked", "onAir", "completed", "cancelled"];
const KIND_KEYS: BookingKind[] = ["commercial", "service"];

const statusBadge: Record<BookingStatus, string> = {
  booked: "badge-neutral",
  onAir: "badge-success",
  completed: "badge-neutral",
  cancelled: "badge-danger",
};

interface InventoryRow {
  construction: Construction;
  side: ConstructionSide | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(value: string): string {
  return `${value.slice(0, 8)}01`;
}

function ms(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function rub(value: number | null | undefined): string {
  if (value == null) return "без цены";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function sideRows(constructions: Construction[]): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const c of constructions) {
    if (c.sideCount === 2) {
      rows.push({ construction: c, side: "A" }, { construction: c, side: "B" });
    } else {
      rows.push({ construction: c, side: null });
    }
  }
  return rows;
}

export function BookingsView({ user }: { user: SessionUser }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Booking | null | undefined>(undefined);
  const [from, setFrom] = useState(monthStart(today()));
  const [to, setTo] = useState(addBookingMonths(monthStart(today()), 6));
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [constructionId, setConstructionId] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const constructions = useQuery({
    queryKey: ["booking-constructions"],
    queryFn: () => api.listProjects({ pageSize: 100, includeArchived: false }),
  });
  const bookings = useQuery({
    queryKey: [...KEY, { from, to, status, kind, constructionId, search }],
    queryFn: () =>
      api.listBookings({
        from,
        to,
        status: status || undefined,
        kind: kind || undefined,
        constructionId: constructionId || undefined,
        search: search || undefined,
        pageSize: 100,
      }),
  });
  const clients = useQuery({
    queryKey: ["booking-clients"],
    queryFn: () => api.listContacts({ kind: "client" }),
  });
  const brands = useQuery({
    queryKey: ["booking-brands"],
    queryFn: () => api.listBookingBrands(false),
  });
  const reasons = useQuery({
    queryKey: ["booking-service-reasons"],
    queryFn: () => api.listBookingServiceReasons(false),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: user.role === "admin",
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["booking-brands"] });
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelBooking(id),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError,
  });

  const allConstructions = constructions.data?.items ?? [];
  const allBookings = bookings.data?.items ?? [];
  const rows = sideRows(
    constructionId
      ? allConstructions.filter((c) => c.id === constructionId)
      : allConstructions,
  );

  const windowStart = ms(from);
  const windowEnd = ms(to);
  const windowDays = Math.max(1, Math.round((windowEnd - windowStart) / DAY_MS));

  if (editing !== undefined) {
    return (
      <BookingForm
        booking={editing}
        user={user}
        constructions={allConstructions}
        clients={clients.data ?? []}
        brands={brands.data ?? []}
        reasons={reasons.data ?? []}
        users={users.data ?? []}
        onClose={() => {
          setEditing(undefined);
          refresh();
        }}
      />
    );
  }

  return (
    <section>
      <div className="toolbar">
        <button className="btn-primary" onClick={() => setEditing(null)}>
          + Новая бронь
        </button>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {STATUS_KEYS.map((s) => (
            <option key={s} value={s}>{BOOKING_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все типы</option>
          {KIND_KEYS.map((k) => (
            <option key={k} value={k}>{BOOKING_KIND_LABEL[k]}</option>
          ))}
        </select>
        <select value={constructionId} onChange={(e) => setConstructionId(e.target.value)}>
          <option value="">Все конструкции</option>
          {allConstructions.map((c) => (
            <option key={c.id} value={c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>
          ))}
        </select>
        <input
          placeholder="Клиент, бренд, кампания"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 260 }}>Конструкция</th>
              <th>Занятость: {from} – {to}</th>
              <th style={{ width: 260 }}>Брони</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowBookings = allBookings.filter(
                (b) =>
                  b.construction.id === row.construction.id &&
                  (row.side === null ? b.side === null : b.side === row.side),
              );
              return (
                <tr key={`${row.construction.id}-${row.side ?? "single"}`}>
                  <td>
                    <strong>{row.construction.code ?? row.construction.name}</strong>
                    <div className="subtle">{row.construction.address ?? row.construction.name}</div>
                    <div className="subtle">{row.side ? `Сторона ${row.side}` : "Односторонняя"}</div>
                  </td>
                  <td>
                    <div style={{ position: "relative", height: 38, background: "var(--surface-muted)", borderRadius: 6, overflow: "hidden" }}>
                      {rowBookings.map((b) => {
                        const left = Math.max(0, ((ms(b.startDate) - windowStart) / DAY_MS / windowDays) * 100);
                        const right = Math.min(100, ((ms(b.endDate) - windowStart) / DAY_MS / windowDays) * 100);
                        const width = Math.max(2, right - left);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setEditing(b)}
                            title={`${b.startDate}–${b.endDate}: ${bookingTitle(b)}`}
                            style={{
                              position: "absolute",
                              left: `${left}%`,
                              width: `${width}%`,
                              top: 7,
                              height: 24,
                              border: 0,
                              borderRadius: 5,
                              background: b.status === "cancelled" ? "#d1d5db" : "#A4161A",
                              color: "#fff",
                              fontSize: 12,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }}
                          >
                            {bookingTitle(b)}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    {rowBookings.length === 0 ? (
                      <span className="subtle">свободно</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {rowBookings.map((b) => (
                          <div key={b.id}>
                            <button className="link-btn" onClick={() => setEditing(b)}>
                              {b.startDate}–{b.endDate}
                            </button>
                            <span className={`badge ${statusBadge[b.status]}`} style={{ marginLeft: 6 }}>
                              {BOOKING_STATUS_LABEL[b.status]}
                            </span>
                            <div className="subtle">
                              {bookingTitle(b)} · {rub(b.totalPrice)}
                              {b.status !== "cancelled" && (
                                <button
                                  className="link-btn"
                                  style={{ marginLeft: 8 }}
                                  onClick={() => {
                                    if (window.confirm("Отменить бронь?")) cancel.mutate(b.id);
                                  }}
                                >
                                  отменить
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="empty" style={{ textAlign: "center" }}>
                  Конструкции не найдены.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function bookingTitle(b: Booking): string {
  if (b.kind === "service") return b.serviceReason?.name ?? "Служебная";
  return b.brand?.name ?? b.client?.fullName ?? "Коммерческая";
}

function BookingForm({
  booking,
  user,
  constructions,
  clients,
  brands,
  reasons,
  users,
  onClose,
}: {
  booking: Booking | null;
  user: SessionUser;
  constructions: Construction[];
  clients: Contact[];
  brands: { id: string; name: string }[];
  reasons: { id: string; name: string }[];
  users: AdminUser[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<BookingKind>(booking?.kind ?? "commercial");
  const [status, setStatus] = useState<BookingStatus>(booking?.status ?? "booked");
  const [constructionId, setConstructionId] = useState(booking?.construction.id ?? constructions[0]?.id ?? "");
  const selectedConstruction = constructions.find((c) => c.id === constructionId) ?? null;
  const [side, setSide] = useState<"" | ConstructionSide>(booking?.side ?? "");
  const [clientId, setClientId] = useState(booking?.client?.id ?? "");
  const [serviceReasonId, setServiceReasonId] = useState(booking?.serviceReason?.id ?? "");
  const [brandId, setBrandId] = useState(booking?.brand?.id ?? "");
  const [campaignNote, setCampaignNote] = useState(booking?.campaignNote ?? "");
  const [startDate, setStartDate] = useState(booking?.startDate ?? today());
  const [durationMonths, setDurationMonths] = useState(String(booking?.durationMonths ?? 1));
  const [basePricePerMonth, setBasePricePerMonth] = useState(
    booking?.basePricePerMonth != null ? String(booking.basePricePerMonth) : "",
  );
  const [totalPrice, setTotalPrice] = useState(
    booking?.totalPrice != null ? String(booking.totalPrice) : "",
  );
  const [priceNote, setPriceNote] = useState(booking?.priceNote ?? "");
  const [reminderAt, setReminderAt] = useState(booking?.reminderAt ?? defaultBookingReminder(addBookingMonths(today(), 1)));
  const [managerId, setManagerId] = useState(booking?.manager?.id ?? user.id);
  const [newBrandName, setNewBrandName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const duration = Math.max(1, Number(durationMonths) || 1);
  const endDate = startDate ? addBookingMonths(startDate, duration) : "";

  useEffect(() => {
    if (booking || !selectedConstruction) return;
    const base = selectedConstruction.pricePerMonth;
    setBasePricePerMonth(base != null ? String(base) : "");
    const total = bookingDefaultTotal(base, duration);
    setTotalPrice(total != null ? String(total) : "");
  }, [booking, selectedConstruction, duration]);

  useEffect(() => {
    if (selectedConstruction?.sideCount === 1) setSide("");
  }, [selectedConstruction?.sideCount]);

  const save = useMutation({
    mutationFn: () => {
      const base = basePricePerMonth.trim() ? Number(basePricePerMonth) : null;
      const total = totalPrice.trim() ? Number(totalPrice) : null;
      const data: UpsertBookingInput = {
        kind,
        status,
        constructionId,
        side: side || null,
        clientId: kind === "commercial" ? clientId || null : null,
        serviceReasonId: kind === "service" ? serviceReasonId || null : null,
        brandId: brandId || null,
        campaignNote: campaignNote.trim() || null,
        startDate,
        durationMonths: duration,
        basePricePerMonth: base,
        totalPrice: kind === "service" ? null : total,
        priceNote: priceNote.trim() || null,
        reminderAt: reminderAt || null,
        managerId: managerId || null,
      };
      return booking ? api.updateBooking(booking.id, data) : api.createBooking(data);
    },
    onSuccess: onClose,
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fields ?? {});
      } else {
        setError(String(e));
      }
    },
  });

  const createBrand = useMutation({
    mutationFn: (name: string) => api.createBookingBrand({ name }),
    onSuccess: (brand) => {
      setBrandId(brand.id);
      setNewBrandName("");
      qc.invalidateQueries({ queryKey: ["booking-brands"] });
    },
  });

  const err = (field: string) =>
    fieldErrors[field] ? <span className="field-error">{fieldErrors[field]}</span> : null;

  return (
    <section className="page-narrow">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{booking ? "Редактирование брони" : "Новая бронь"}</h2>
        <button className="btn-ghost" onClick={onClose}>← к сетке</button>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="card">
        <div className="card-body">
          <h3 className="section-title">Инвентарь и период</h3>
          <Field label="Конструкция">
            <select value={constructionId} onChange={(e) => setConstructionId(e.target.value)}>
              <option value="">Выберите конструкцию</option>
              {constructions.map((c) => (
                <option key={c.id} value={c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>
              ))}
            </select>
            {err("constructionId")}
          </Field>
          {selectedConstruction?.sideCount === 2 && (
            <Field label="Сторона">
              <select value={side} onChange={(e) => setSide(e.target.value as "" | ConstructionSide)}>
                <option value="">Выберите сторону</option>
                <option value="A">Сторона A</option>
                <option value="B">Сторона B</option>
              </select>
              {err("side")}
            </Field>
          )}
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label="Начало">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              {err("startDate")}
            </Field>
            <Field label="Месяцев">
              <input inputMode="numeric" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
              {err("durationMonths")}
            </Field>
            <Field label="Окончание">
              <input value={endDate} readOnly />
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Тип и размещение</h3>
          <Field label="Тип">
            <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind)}>
              {KIND_KEYS.map((k) => (
                <option key={k} value={k}>{BOOKING_KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Статус">
            <select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus)}>
              {STATUS_KEYS.map((s) => (
                <option key={s} value={s}>{BOOKING_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          {kind === "commercial" ? (
            <Field label="Клиент-плательщик">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Выберите клиента</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </select>
              {err("clientId")}
            </Field>
          ) : (
            <Field label="Причина">
              <select value={serviceReasonId} onChange={(e) => setServiceReasonId(e.target.value)}>
                <option value="">Выберите причину</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              {err("serviceReasonId")}
            </Field>
          )}
          <Field label="Бренд">
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">Не выбран</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
              <input
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="Быстро добавить бренд"
              />
              <button
                type="button"
                className="btn-sm"
                disabled={!newBrandName.trim() || createBrand.isPending}
                onClick={() => createBrand.mutate(newBrandName.trim())}
              >
                добавить
              </button>
            </div>
          </Field>
          <Field label="Кампания / примечание">
            <input value={campaignNote} onChange={(e) => setCampaignNote(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Цена и напоминание</h3>
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label="База, ₽/мес">
              <input inputMode="numeric" value={basePricePerMonth} onChange={(e) => setBasePricePerMonth(e.target.value)} />
            </Field>
            <Field label="Итого, ₽">
              <input inputMode="numeric" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} disabled={kind === "service"} />
            </Field>
            <Field label="Напомнить">
              <input type="date" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Комментарий к цене">
            <input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} />
          </Field>
          {user.role === "admin" && (
            <Field label="Ответственный">
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">Не выбран</option>
                {users.filter((u) => u.isActive).map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: "1.25rem" }}>
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Сохранение…" : "Сохранить"}
        </button>
        <button onClick={onClose}>Отмена</button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}
