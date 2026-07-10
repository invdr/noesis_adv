import { useQuery } from "@tanstack/react-query";
import {
  BOOKING_STATUS_LABEL,
  type BookingReminderItem,
  type LeadAgendaItem,
  type SessionUser,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import { navigate } from "../router";
import { formatDateTime } from "./shared";
import "./AgendaView.css";

/**
 * «Мой день»: активные заявки с назначенной датой следующего контакта, разбитые
 * на просроченные / сегодня / ближайшие 7 дней, плюс блок броней с подходящим
 * сроком. Менеджер видит свою повестку, admin — всю команду (решает бэкенд по
 * роли). Клик по строке открывает карточку/раздел.
 */
export function AgendaView({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "admin";
  const agenda = useQuery({
    queryKey: ["agenda"],
    queryFn: () => api.getAgenda(),
    retry: false,
  });
  const reminders = useQuery({
    queryKey: ["booking-reminders"],
    queryFn: () => api.getBookingReminders(),
    retry: false,
  });

  const data = agenda.data;
  const empty =
    data &&
    data.overdue.length + data.today.length + data.upcoming.length + data.noTask.length ===
      0;

  return (
    <section className="agenda-view">
      <p className="hint">
        {isAdmin
          ? "Повестка всей команды: активные заявки по дате следующего контакта."
          : "Ваши активные заявки по дате следующего контакта."}
      </p>

      {agenda.isLoading && <p className="hint">Загрузка…</p>}
      {agenda.error && (
        <p className="alert alert-error" role="alert">
          {(agenda.error as ApiError).message}
        </p>
      )}

      {data && (
        <>
          <AgendaGroup title="Просрочено" tone="danger" items={data.overdue} />
          <AgendaGroup title="Сегодня" tone="warn" items={data.today} />
          <AgendaGroup title="Ближайшие 7 дней" tone="info" items={data.upcoming} />
          <AgendaGroup
            title="Без задачи"
            tone="neutral"
            items={data.noTask}
            hint="Активные заявки без даты следующего контакта — назначьте контакт, чтобы заявка не потерялась."
          />
          {empty && (
            <p className="empty agenda-view__empty">
              На ближайшие дни ничего не запланировано.
            </p>
          )}
        </>
      )}

      <BookingReminders
        isAdmin={isAdmin}
        loading={reminders.isLoading}
        error={reminders.error as ApiError | null}
        data={reminders.data}
      />
    </section>
  );
}

function AgendaGroup({
  title,
  tone,
  items,
  hint,
}: {
  title: string;
  tone: "danger" | "warn" | "info" | "neutral";
  items: LeadAgendaItem[];
  hint?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="card agenda-group">
      <div className="card-title">
        {title}{" "}
        <span className={`badge badge-${tone} agenda-group__count`}>
          {items.length}
        </span>
      </div>
      {hint && (
        <p className="hint agenda-group__hint">
          {hint}
        </p>
      )}
      <table className="table-flush table-hover">
        <thead>
          <tr>
            <th className="agenda-group__date-col">Дата контакта</th>
            <th>Имя</th>
            <th>Телефон</th>
            <th>Тип контакта</th>
            <th className="agenda-group__stage-col">Этап</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="muted tnum">{formatDateTime(it.nextContactAt)}</td>
              <td>
                <button className="link-btn" onClick={() => navigate(`/leads/${it.id}`)}>
                  {it.name}
                </button>
              </td>
              <td className="tnum">{it.phone}</td>
              <td>
                {it.nextContactTypeName ?? <span className="subtle">—</span>}
              </td>
              <td>{it.stageName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookingReminders({
  isAdmin,
  loading,
  error,
  data,
}: {
  isAdmin: boolean;
  loading: boolean;
  error: ApiError | null;
  data:
    | { overdue: BookingReminderItem[]; today: BookingReminderItem[]; upcoming: BookingReminderItem[] }
    | undefined;
}) {
  const total = data
    ? data.overdue.length + data.today.length + data.upcoming.length
    : 0;
  return (
    <div className="agenda-view__bookings">
      <h2 className="agenda-view__section-title">Сроки броней</h2>
      <p className="hint">
        {isAdmin
          ? "Брони команды с подходящим сроком размещения."
          : "Ваши брони с подходящим сроком размещения."}
      </p>
      {loading && <p className="hint">Загрузка…</p>}
      {error && (
        <p className="alert alert-error" role="alert">
          {error.message}
        </p>
      )}
      {data && (
        <>
          <BookingReminderGroup title="Просрочено" tone="danger" items={data.overdue} />
          <BookingReminderGroup title="Сегодня" tone="warn" items={data.today} />
          <BookingReminderGroup title="Ближайшие 7 дней" tone="info" items={data.upcoming} />
          {total === 0 && (
            <p className="empty agenda-view__empty">
              Броней с подходящим сроком нет.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function bookingReminderWho(it: BookingReminderItem): string {
  return (
    it.clientName ?? it.brandName ?? it.serviceReasonName ?? it.campaignNote ?? "—"
  );
}

function BookingReminderGroup({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "danger" | "warn" | "info";
  items: BookingReminderItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="card agenda-group">
      <div className="card-title">
        {title}{" "}
        <span className={`badge badge-${tone} agenda-group__count`}>{items.length}</span>
      </div>
      <table className="table-flush table-hover">
        <thead>
          <tr>
            <th className="agenda-group__date-col">Напоминание</th>
            <th>Конструкция</th>
            <th>Клиент / бренд</th>
            <th className="agenda-group__date-col">Срок до</th>
            <th className="agenda-group__stage-col">Статус</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="muted tnum">{it.reminderAt}</td>
              <td>
                <button className="link-btn" onClick={() => navigate("/bookings")}>
                  {(it.constructionCode ?? it.constructionName)} · {it.sideCode}
                </button>
              </td>
              <td>{bookingReminderWho(it)}</td>
              <td className="tnum">{it.endDate}</td>
              <td>{BOOKING_STATUS_LABEL[it.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
