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
  type Contact,
  type Lead,
  type SessionUser,
  type UpsertBookingInput,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import { navigate, type BookingDraft } from "../router";
import { BookingReports } from "./BookingReports";
import {
  DAY_MS,
  dateOnlyMs,
  displayInclusivePeriod,
  monthStart,
  previousDateOnly,
  productToday,
  shiftDateOnly,
} from "../shared/date";
import { parseOptionalNumberInput } from "../shared/number";

const KEY = ["bookings"];

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
  side: Construction["sides"][number];
}

type BookingSideConstruction = Pick<Construction, "sideCount" | "sides"> | null;

export function selectedBookingSide(
  construction: BookingSideConstruction,
  sideId: string,
): Construction["sides"][number] | null {
  const selected = construction?.sides.find((side) => side.id === sideId);
  if (selected) return selected;
  return construction?.sideCount === 1 ? (construction.sides[0] ?? null) : null;
}

export function nextBookingSideId(
  construction: BookingSideConstruction,
  sideId: string,
): string {
  if (!construction) return "";
  if (construction.sides.some((side) => side.id === sideId)) return sideId;
  return construction.sideCount === 1 ? (construction.sides[0]?.id ?? "") : "";
}

function ms(value: string): number {
  return dateOnlyMs(value);
}

function rub(value: number | null | undefined): string {
  if (value == null) return "без цены";
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function sideRows(constructions: Construction[]): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const c of constructions) {
    for (const side of c.sides) rows.push({ construction: c, side });
  }
  return rows;
}

export function BookingsView({ user, draft }: { user: SessionUser; draft?: BookingDraft }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Booking | null | undefined>(undefined);

  // Маршрут «Создать бронь из заявки» (#/bookings/new?…) открывает форму новой
  // брони с префиллом. Ключ-строка вместо объекта: parseHash пересоздаёт draft
  // на каждом рендере, а перескакивать в форму нужно только по смене маршрута.
  const draftKey = draft
    ? `${draft.constructionId ?? ""}|${draft.leadId ?? ""}|${draft.clientId ?? ""}`
    : "";
  useEffect(() => {
    if (draftKey) setEditing(null);
  }, [draftKey]);
  const [from, setFrom] = useState(monthStart(productToday()));
  const [toInclusive, setToInclusive] = useState(previousDateOnly(addBookingMonths(monthStart(productToday()), 6)));
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [constructionId, setConstructionId] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const to = shiftDateOnly(toInclusive, 1);
  const hasValidWindow = Boolean(from && to && from < to);

  const constructions = useQuery({
    queryKey: ["booking-constructions"],
    queryFn: () => api.listAllProjects({ includeArchived: false }),
  });
  const bookings = useQuery({
    queryKey: [...KEY, { from, to, status, kind, constructionId, search }],
    queryFn: () =>
      api.listAllBookings({
        from,
        to,
        status: status || undefined,
        kind: kind || undefined,
        constructionId: constructionId || undefined,
        search: search || undefined,
      }),
    enabled: hasValidWindow,
  });
  const clients = useQuery({
    queryKey: ["booking-clients"],
    queryFn: () => api.listContacts({ role: "client" }),
  });
  const leads = useQuery({
    queryKey: ["booking-leads"],
    queryFn: () => api.listAllLeads(),
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

  // Сетка занятости существует ради недопущения двойной брони, поэтому её
  // нельзя показывать на неполных данных: упавший запрос давал пустой список,
  // и каждая сторона печаталась как «свободно» — неотличимо от реально
  // свободной. Пока данные не загружены или загрузка упала, сетку не рисуем.
  const loadFailed = bookings.isError || constructions.isError;
  const loading =
    constructions.isPending || (hasValidWindow && bookings.isPending);
  const retryLoad = () => {
    if (constructions.isError) void constructions.refetch();
    if (bookings.isError) void bookings.refetch();
  };
  const rows = sideRows(
    constructionId
      ? allConstructions.filter((c) => c.id === constructionId)
      : allConstructions,
  );

  const windowStart = Number.isFinite(ms(from)) ? ms(from) : 0;
  const windowEnd = Number.isFinite(ms(to)) ? ms(to) : windowStart + DAY_MS;
  const windowDays = Math.max(1, Math.round((windowEnd - windowStart) / DAY_MS));

  if (editing !== undefined) {
    return (
      <BookingForm
        key={editing === null ? `new-${draftKey}` : editing.id}
        booking={editing}
        draft={editing === null ? draft : undefined}
        user={user}
        constructions={allConstructions}
        clients={clients.data ?? []}
        leads={leads.data?.items ?? []}
        brands={brands.data ?? []}
        reasons={reasons.data ?? []}
        users={users.data ?? []}
        onClose={() => {
          setEditing(undefined);
          refresh();
          // Сбрасываем маршрут префилла, чтобы «← к сетке» не возвращал в форму.
          navigate("/bookings");
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
        <input type="date" value={toInclusive} onChange={(e) => setToInclusive(e.target.value)} />
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
      {!hasValidWindow && <p className="alert alert-error">Укажите корректный период.</p>}

      {loadFailed && (
        <p className="alert alert-error" role="alert">
          Не удалось загрузить занятость. Сетка скрыта: пустые строки можно
          принять за свободные места и продать сторону дважды.{" "}
          <button className="link-btn" onClick={retryLoad}>
            Повторить
          </button>
        </p>
      )}

      {!loadFailed && loading && hasValidWindow && (
        <p className="subtle" role="status">Загружаем занятость…</p>
      )}

      {!loadFailed && !loading && (
      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 260 }}>Конструкция</th>
              <th>Занятость: {displayInclusivePeriod(from, to)}</th>
              <th style={{ width: 260 }}>Брони</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowBookings = allBookings.filter(
                (b) =>
                  b.construction.id === row.construction.id &&
                  b.side.id === row.side.id,
              );
              return (
                <tr key={`${row.construction.id}-${row.side.id}`}>
                  <td>
                    <strong>{row.construction.code ?? row.construction.name}</strong>
                    <div className="subtle">{row.construction.address ?? row.construction.name}</div>
                    <div className="subtle">
                      {row.construction.sideCount === 1
                        ? "Односторонняя"
                        : `Сторона ${row.side.code}`}
                      {row.side.description ? ` · ${row.side.description}` : ""}
                    </div>
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
                            title={`${displayInclusivePeriod(b.startDate, b.endDate)}: ${bookingTitle(b)}`}
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
                              {displayInclusivePeriod(b.startDate, b.endDate)}
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
      )}
    </section>
  );
}

function bookingTitle(b: Booking): string {
  if (b.kind === "service") return b.serviceReason?.name ?? "Служебная";
  return b.brand?.name ?? b.client?.fullName ?? "Коммерческая";
}

function BookingForm({
  booking,
  draft,
  user,
  constructions,
  clients,
  leads,
  brands,
  reasons,
  users,
  onClose,
}: {
  booking: Booking | null;
  /** Префилл новой брони из карточки заявки (#/bookings/new?…). */
  draft?: BookingDraft;
  user: SessionUser;
  constructions: Construction[];
  clients: Contact[];
  leads: Lead[];
  brands: { id: string; name: string }[];
  reasons: { id: string; name: string }[];
  users: AdminUser[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<BookingKind>(booking?.kind ?? "commercial");
  const [status, setStatus] = useState<BookingStatus>(booking?.status ?? "booked");
  const [constructionId, setConstructionId] = useState(
    booking?.construction.id ?? draft?.constructionId ?? constructions[0]?.id ?? "",
  );
  const selectedConstruction = constructions.find((c) => c.id === constructionId) ?? null;
  const [constructionSideId, setConstructionSideId] = useState(booking?.side.id ?? "");
  const selectedSide = selectedBookingSide(selectedConstruction, constructionSideId);
  const [clientId, setClientId] = useState(booking?.client?.id ?? draft?.clientId ?? "");
  const [leadId, setLeadId] = useState(booking?.lead?.id ?? draft?.leadId ?? "");
  const [serviceReasonId, setServiceReasonId] = useState(booking?.serviceReason?.id ?? "");
  const [brandId, setBrandId] = useState(booking?.brand?.id ?? "");
  const [campaignNote, setCampaignNote] = useState(booking?.campaignNote ?? "");
  const [startDate, setStartDate] = useState(booking?.startDate ?? productToday());
  const [durationMonths, setDurationMonths] = useState(String(booking?.durationMonths ?? 1));
  const [basePricePerMonth, setBasePricePerMonth] = useState(
    booking?.basePricePerMonth != null ? String(booking.basePricePerMonth) : "",
  );
  const [totalPrice, setTotalPrice] = useState(
    booking?.totalPrice != null ? String(booking.totalPrice) : "",
  );
  const [priceNote, setPriceNote] = useState(booking?.priceNote ?? "");
  const [reminderAt, setReminderAt] = useState(booking?.reminderAt ?? defaultBookingReminder(addBookingMonths(productToday(), 1)));
  const [reminderAtTouched, setReminderAtTouched] = useState(false);
  const [managerId, setManagerId] = useState(booking ? (booking.manager?.id ?? "") : user.id);
  const [newBrandName, setNewBrandName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const duration = Math.max(1, Number(durationMonths) || 1);
  const endDate = startDate ? addBookingMonths(startDate, duration) : "";
  const endDateInclusive = previousDateOnly(endDate);

  useEffect(() => {
    if (booking || !selectedSide) return;
    const base = selectedSide.effectivePricePerMonth;
    setBasePricePerMonth(base != null ? String(base) : "");
    const total = bookingDefaultTotal(base, duration);
    setTotalPrice(total != null ? String(total) : "");
  }, [booking, selectedSide, duration]);

  useEffect(() => {
    const nextSideId = nextBookingSideId(selectedConstruction, constructionSideId);
    if (nextSideId !== constructionSideId) setConstructionSideId(nextSideId);
  }, [selectedConstruction, constructionSideId]);

  // Новой брони дефолтное напоминание следует за периодом (как и снимок цены):
  // менять срок и получать напоминание, привязанное к старому «+1 мес от сегодня»,
  // — сюрприз. Существующую бронь и вручную введённую дату не перетираем.
  useEffect(() => {
    if (booking || reminderAtTouched || !endDate) return;
    setReminderAt(defaultBookingReminder(endDate));
  }, [booking, endDate, reminderAtTouched]);

  const save = useMutation({
    mutationFn: () => {
      // Поля цены — свободный ввод, и «50 000» или «50 000 ₽» давали через
      // Number() значение NaN, которое JSON.stringify сериализует как null.
      // Схема null принимает, поэтому бронь молча сохранялась БЕЗ цены и
      // выпадала из плановой выручки. parseOptionalNumberInput отличает
      // пустое поле от нечислового и понимает пробелы с запятой.
      const parseErrors: Record<string, string> = {};
      const priceValue = (field: string, value: string): number | null => {
        const parsed = parseOptionalNumberInput(value);
        if (parsed.error) parseErrors[field] = parsed.error;
        return parsed.value;
      };
      const base = priceValue("basePricePerMonth", basePricePerMonth);
      const total = priceValue("totalPrice", totalPrice);
      if (Object.keys(parseErrors).length > 0) {
        setFieldErrors(parseErrors);
        throw new Error("Проверьте поля формы");
      }
      const data: UpsertBookingInput = {
        kind,
        status,
        constructionId,
        constructionSideId: constructionSideId || null,
        clientId: kind === "commercial" ? clientId || null : null,
        leadId: leadId || null,
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
        // Локальные ошибки разбора полей уже выставлены в fieldErrors.
        setError(e instanceof Error ? e.message : String(e));
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
          {selectedConstruction && selectedConstruction.sideCount > 1 && (
            <Field label="Сторона">
              <select value={constructionSideId} onChange={(e) => setConstructionSideId(e.target.value)}>
                <option value="">Выберите сторону</option>
                {selectedConstruction.sides.map((side) => (
                  <option key={side.id} value={side.id}>
                    Сторона {side.code}
                    {side.description ? ` · ${side.description}` : ""}
                  </option>
                ))}
              </select>
              {err("constructionSideId") || err("side")}
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
            <Field label="Окончание включительно">
              <input value={endDateInclusive} readOnly />
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
          <Field label="Заявка (необязательно)">
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Не выбрана</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}{lead.phone ? ` · ${lead.phone}` : ""}
                </option>
              ))}
            </select>
          </Field>
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
              {err("basePricePerMonth")}
            </Field>
            <Field label="Итого, ₽">
              <input inputMode="numeric" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} disabled={kind === "service"} />
              {err("totalPrice")}
            </Field>
            <Field label="Напомнить">
              <input
                type="date"
                value={reminderAt}
                onChange={(e) => {
                  setReminderAtTouched(true);
                  setReminderAt(e.target.value);
                }}
              />
              {err("reminderAt")}
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
              {err("managerId")}
            </Field>
          )}
        </div>
      </div>

      {booking && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="card-body">
            <BookingReports
              booking={{
                id: booking.id,
                status: booking.status,
                startDate: booking.startDate,
                // Booking.endDate — полуоткрытая граница, ровно то, что нужно.
                exclusiveEndDate: booking.endDate,
              }}
            />
          </div>
        </div>
      )}

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
