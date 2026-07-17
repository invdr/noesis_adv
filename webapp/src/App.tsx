import { Suspense, lazy, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@noesis/contracts";
import { api, ApiError } from "./api/client";
import { Icon, type IconName } from "./ui/icons";
import { LeadsView } from "./leads/LeadsView";
import { AgendaView } from "./leads/AgendaView";
import { navigate, useHashRoute } from "./router";

// Заявки (LeadsView) — стартовый раздел, грузим сразу. Остальные разделы редко
// открывают вместе и они тянут тяжёлые зависимости (схемы, графики, калькулятор),
// поэтому грузим их по требованию отдельными чанками (см. Suspense ниже).
const ContactsView = lazy(() => import("./contacts/ContactsView").then((m) => ({ default: m.ContactsView })));
const BookingsView = lazy(() => import("./bookings/BookingsView").then((m) => ({ default: m.BookingsView })));
const FunnelsAdmin = lazy(() => import("./funnels/FunnelsAdmin").then((m) => ({ default: m.FunnelsAdmin })));
const ProjectsView = lazy(() => import("./projects/ProjectsView").then((m) => ({ default: m.ProjectsView })));
const DevelopersView = lazy(() => import("./developers/DevelopersView").then((m) => ({ default: m.DevelopersView })));
const NewsView = lazy(() => import("./news/NewsView").then((m) => ({ default: m.NewsView })));
const NewsLabelsAdmin = lazy(() => import("./news/NewsLabelsAdmin").then((m) => ({ default: m.NewsLabelsAdmin })));
const DocumentCategoriesAdmin = lazy(() =>
  import("./documents/DocumentCategoriesAdmin").then((m) => ({ default: m.DocumentCategoriesAdmin })),
);
const ContactTypesAdmin = lazy(() =>
  import("./contact-types/ContactTypesAdmin").then((m) => ({ default: m.ContactTypesAdmin })),
);
const BookingBrandsAdmin = lazy(() =>
  import("./bookings/BookingBrandsAdmin").then((m) => ({ default: m.BookingBrandsAdmin })),
);
const BookingServiceReasonsAdmin = lazy(() =>
  import("./bookings/BookingServiceReasonsAdmin").then((m) => ({ default: m.BookingServiceReasonsAdmin })),
);
const FinanceView = lazy(() => import("./finance/FinanceView").then((m) => ({ default: m.FinanceView })));
const FinanceCategoriesAdmin = lazy(() =>
  import("./finance/FinanceCategoriesAdmin").then((m) => ({ default: m.FinanceCategoriesAdmin })),
);
const SourcesAdmin = lazy(() =>
  import("./sources/SourcesAdmin").then((m) => ({ default: m.SourcesAdmin })),
);
const SiteSettingsView = lazy(() =>
  import("./site-settings/SiteSettingsView").then((m) => ({ default: m.SiteSettingsView })),
);
const UsersView = lazy(() => import("./users/UsersView").then((m) => ({ default: m.UsersView })));
const AnalyticsView = lazy(() => import("./analytics/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));

const SESSION_KEY = ["session"];
const STAGES_KEY = ["stages"];
const FUNNELS_KEY = ["funnels"];

type View =
  | "myday"
  | "leads"
  | "bookings"
  | "contacts"
  | "analytics"
  | "projects"
  | "news"
  | "developers"
  | "stages"
  | "contactTypes"
  | "bookingBrands"
  | "bookingServiceReasons"
  | "financeCategories"
  | "sources"
  | "newsLabels"
  | "docCategories"
  | "finance"
  | "users"
  | "siteSettings";

interface NavLink {
  id: View;
  label: string;
  icon: IconName;
  admin?: boolean;
}

const NAV_GROUPS: { label: string; items: NavLink[] }[] = [
  {
    // Ежедневная работа в CRM и её настройка (воронка) — в одной группе.
    label: "CRM",
    items: [
      { id: "myday", label: "Мой день", icon: "calendar" },
      { id: "leads", label: "Заявки", icon: "inbox" },
      { id: "bookings", label: "Брони", icon: "calendar" },
      { id: "contacts", label: "Контрагенты и реквизиты", icon: "user" },
      { id: "analytics", label: "Аналитика", icon: "chart" },
      { id: "finance", label: "Финансы", icon: "briefcase", admin: true },
      { id: "stages", label: "Воронки", icon: "layers", admin: true },
    ],
  },
  {
    // Всё, что попадает на публичный лендинг: контент и его настройки.
    label: "Сайт",
    items: [
      { id: "projects", label: "Конструкции", icon: "building" },
      { id: "news", label: "Новости", icon: "news" },
      { id: "siteSettings", label: "Настройки", icon: "globe", admin: true },
    ],
  },
  {
    // Справочники: CRM (тип контакта) и контент сайта.
    label: "Справочники",
    items: [
      { id: "contactTypes", label: "Тип след. контакта", icon: "phone", admin: true },
      { id: "bookingBrands", label: "Бренды", icon: "tag", admin: true },
      { id: "bookingServiceReasons", label: "Причины броней", icon: "folder", admin: true },
      { id: "financeCategories", label: "Статьи расходов", icon: "folder", admin: true },
      { id: "sources", label: "Источники заявок", icon: "inbox", admin: true },
      { id: "developers", label: "Владельцы сети", icon: "briefcase", admin: true },
      { id: "newsLabels", label: "Метки новостей", icon: "tag", admin: true },
      { id: "docCategories", label: "Категории документов", icon: "folder", admin: true },
    ],
  },
  {
    label: "Система",
    items: [{ id: "users", label: "Пользователи", icon: "users", admin: true }],
  },
];

const PAGE_TITLES: Record<View, string> = {
  myday: "Мой день",
  leads: "Заявки",
  bookings: "Брони",
  contacts: "Контрагенты и реквизиты",
  analytics: "Аналитика",
  projects: "Конструкции",
  news: "Новости",
  developers: "Владельцы сети",
  stages: "Воронки",
  contactTypes: "Тип следующего контакта",
  bookingBrands: "Бренды",
  bookingServiceReasons: "Причины служебных броней",
  financeCategories: "Статьи расходов",
  sources: "Источники заявок",
  newsLabels: "Метки новостей",
  docCategories: "Категории документов",
  finance: "Финансы",
  users: "Пользователи",
  siteSettings: "Настройки сайта",
};

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const DEFAULT_VIEW: View = "myday";

/** Валидирует раздел из URL: неизвестный или недоступный по роли → дефолт. */
function resolveView(raw: string, isAdmin: boolean): View {
  const item = NAV_ITEMS.find((i) => i.id === raw);
  if (!item) return DEFAULT_VIEW;
  if (item.admin && !isAdmin) return DEFAULT_VIEW;
  return item.id;
}

export function App() {
  const session = useQuery<SessionUser>({
    queryKey: SESSION_KEY,
    queryFn: () => api.me(),
    retry: false,
  });

  if (session.isLoading) {
    return <div className="centered">Загрузка…</div>;
  }

  // Нет валидной сессии (401 или иная ошибка) — показываем вход.
  if (session.isError || !session.data) {
    return <Login />;
  }

  if (session.data.mustChangePassword) {
    return <ChangePassword />;
  }

  return <Dashboard user={session.data} />;
}

function BrandMark() {
  return <span className="brand-mark">ГТ</span>;
}

function Login() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <div className="brand-name">Noesis</div>
            <div className="brand-sub">CRM для сотрудников</div>
          </div>
        </div>
        <h1>Вход в систему</h1>
        <p className="hint">Введите рабочую почту и пароль.</p>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || !password) return;
            mutation.mutate();
          }}
        >
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
          />
          {mutation.isError && (
            <p className="alert alert-error" role="alert">
              {(mutation.error as Error).message}
            </p>
          )}
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </main>
  );
}

function ChangePassword() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [localError, setLocalError] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: (user) => {
      queryClient.setQueryData(SESSION_KEY, user);
    },
  });

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <div className="brand-name">Noesis</div>
            <div className="brand-sub">CRM для сотрудников</div>
          </div>
        </div>
        <h1>Смена пароля</h1>
        <p className="hint">Задайте новый пароль для входа в CRM (минимум 8 символов).</p>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            setLocalError("");
            if (newPassword !== repeat) {
              setLocalError("Пароли не совпадают");
              return;
            }
            mutation.mutate();
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Текущий пароль"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            placeholder="Повторите новый пароль"
          />
          {(localError || mutation.isError) && (
            <p className="alert alert-error" role="alert">
              {localError || (mutation.error as Error).message}
            </p>
          )}
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? "Сохранение…" : "Сохранить пароль"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Dashboard({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "admin";
  const route = useHashRoute();
  const view = resolveView(route.view || DEFAULT_VIEW, isAdmin);
  // Карточка заявки открыта только на маршруте `#/leads/<id>`.
  const leadId = view === "leads" ? route.leadId : undefined;
  // Карточка контакта — на `#/contacts/<id>`.
  const contactId = view === "contacts" ? route.contactId : undefined;
  // Неизвестный или недоступный по роли раздел в URL → канонизируем хэш на дефолт.
  useEffect(() => {
    const raw = route.view || DEFAULT_VIEW;
    if (raw !== view) navigate(`/${view}`);
  }, [route.view, view]);

  // Свёрнутый сайдбар (только иконки) — состояние запоминаем между визитами.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* приватный режим и т. п. — молча игнорируем */
    }
  }, [collapsed]);
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => {
      queryClient.setQueryData(SESSION_KEY, null);
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });

  // Живые этапы воронки — общий справочник для списка и фильтра заявок.
  const stages = useQuery({
    queryKey: STAGES_KEY,
    queryFn: () => api.listStages(),
    retry: false,
  });

  // Воронки — для переключателя в заявках и админ-экрана.
  const funnels = useQuery({
    queryKey: FUNNELS_KEY,
    queryFn: () => api.listFunnels(),
    retry: false,
  });

  // Сессия истекла на сервере (401) — возвращаемся на экран входа.
  const expired = stages.error instanceof ApiError && stages.error.status === 401;
  useEffect(() => {
    if (expired) {
      queryClient.setQueryData(SESSION_KEY, null);
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    }
  }, [expired, queryClient]);

  return (
    <div className={`app${collapsed ? " is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <div className="brand-name">Noesis</div>
            <div className="brand-sub">CRM заявок</div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-pressed={collapsed}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          >
            <Icon name="chevronLeft" className="nav-ico" />
          </button>
        </div>

        <nav className="nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((i) => !i.admin || isAdmin);
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item${view === item.id ? " is-active" : ""}`}
                    aria-current={view === item.id ? "page" : undefined}
                    onClick={() => navigate(`/${item.id}`)}
                    title={collapsed ? item.label : undefined}
                    aria-label={item.label}
                  >
                    <Icon name={item.icon} />
                    <span className="nav-item-label">{item.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar" title={user.email}>
              {(user.name || user.email).slice(0, 1)}
            </span>
            <div className="user-chip-text" style={{ minWidth: 0 }}>
              <div className="user-email" title={user.email}>
                {user.name || user.email}
              </div>
              <div className="user-role">{isAdmin ? "Администратор" : "Менеджер"}</div>
            </div>
          </div>
          <button
            className="btn-ghost"
            onClick={() => logout.mutate()}
            title="Выйти"
            aria-label="Выйти"
          >
            <Icon name="logout" className="nav-ico" />
            <span className="nav-item-label">Выйти</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="topbar-title">{PAGE_TITLES[view]}</h1>
          <SiteBuildIndicator canPublish={isAdmin} />
        </header>

        <div className="content">
          <Suspense fallback={<div className="centered">Загрузка…</div>}>
            {view === "myday" && <AgendaView user={user} />}
            {view === "leads" && (
              <LeadsView
                stages={stages.data ?? []}
                funnels={funnels.data ?? []}
                user={user}
                expired={expired}
                selectedLeadId={leadId}
                onOpenLead={(id) => navigate(`/leads/${id}`)}
                onCloseLead={() => navigate("/leads")}
              />
            )}
            {view === "bookings" && <BookingsView user={user} draft={route.bookingDraft} />}
            {view === "contacts" && (
              <ContactsView
                user={user}
                selectedContactId={contactId}
                onOpenContact={(id) => navigate(`/contacts/${id}`)}
                onCloseContact={() => navigate("/contacts")}
              />
            )}
            {view === "analytics" && <AnalyticsView user={user} />}
            {view === "finance" && isAdmin && <FinanceView />}
            {view === "projects" && <ProjectsView isAdmin={isAdmin} />}
            {view === "news" && <NewsView isAdmin={isAdmin} />}
            {view === "developers" && isAdmin && <DevelopersView />}
            {view === "stages" && isAdmin && <FunnelsAdmin />}
            {view === "contactTypes" && isAdmin && <ContactTypesAdmin />}
            {view === "bookingBrands" && isAdmin && <BookingBrandsAdmin />}
            {view === "bookingServiceReasons" && isAdmin && <BookingServiceReasonsAdmin />}
            {view === "financeCategories" && isAdmin && <FinanceCategoriesAdmin />}
            {view === "sources" && isAdmin && <SourcesAdmin />}
            {view === "newsLabels" && isAdmin && <NewsLabelsAdmin />}
            {view === "docCategories" && isAdmin && <DocumentCategoriesAdmin />}
            {view === "users" && isAdmin && <UsersView user={user} />}
            {view === "siteSettings" && isAdmin && <SiteSettingsView />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/**
 * Индикатор публикации лендинга: черновые правки, очередь/сборка, успех или
 * сбой. Для админа рядом — кнопка «Опубликовать сайт» (запуск публикации всех
 * накопленных правок; раньше жила в «Настройках сайта»).
 */
function SiteBuildIndicator({ canPublish = false }: { canPublish?: boolean }) {
  const qc = useQueryClient();
  const build = useQuery({
    queryKey: ["site-build"],
    queryFn: () => api.getSiteBuild(),
    refetchInterval: 20_000,
    retry: false,
  });
  const publish = useMutation({
    mutationFn: () => api.requestSitePublish(),
    onSuccess: (status) => {
      qc.setQueryData(["site-build"], status);
      qc.invalidateQueries({ queryKey: ["site-build"] });
    },
  });
  const s = build.data;
  if (!s) return null;

  const pill = (() => {
    if (s.status === "failed") {
      return (
        <span
          className="status-pill is-err"
          title={s.lastError ?? "Сборка сайта не удалась"}
        >
          <span className="status-pill-text">
            <span className="status-pill-title">Публикация не удалась</span>
            <span className="status-pill-sub">сайт на прошлой версии</span>
          </span>
        </span>
      );
    }
    if (s.status === "building") {
      return (
        <span className="status-pill is-warn">
          <span className="status-pill-text">
            <span className="status-pill-title">Сайт публикуется</span>
            <span className="status-pill-sub">сборка идёт</span>
          </span>
        </span>
      );
    }
    if (s.pending) {
      return (
        <span className="status-pill is-warn">
          <span className="status-pill-text">
            <span className="status-pill-title">Публикация в очереди</span>
            <span className="status-pill-sub">ждёт сборщик</span>
          </span>
        </span>
      );
    }
    if (s.unpublished) {
      const since = s.unpublishedSince
        ? new Date(s.unpublishedSince).toLocaleString("ru-RU")
        : null;
      return (
        <span
          className="status-pill is-warn"
          title={since ? `Не опубликовано с: ${since}` : undefined}
        >
          <span className="status-pill-text">
            <span className="status-pill-title">Есть изменения</span>
            <span className="status-pill-sub">нужна публикация</span>
          </span>
        </span>
      );
    }
    const when = s.lastSuccessAt
      ? new Date(s.lastSuccessAt).toLocaleString("ru-RU")
      : null;
    return (
      <span
        className="status-pill is-ok"
        title={when ? `Последняя публикация: ${when}` : undefined}
      >
        <span className="status-pill-text">
          <span className="status-pill-title">Сайт опубликован</span>
          {when && <span className="status-pill-sub">{when}</span>}
        </span>
      </span>
    );
  })();

  return (
    <div className="topbar-site">
      {pill}
      {publish.isError && (
        <span
          className="status-pill is-err"
          title={publish.error instanceof Error ? publish.error.message : String(publish.error)}
        >
          <span className="status-pill-text">
            <span className="status-pill-title">Не удалось запустить</span>
          </span>
        </span>
      )}
      {canPublish && (
        <button
          type="button"
          className="btn-sm"
          onClick={() => publish.mutate()}
          disabled={
            publish.isPending ||
            s.status === "building" ||
            s.pending === true ||
            s.unpublished !== true
          }
          title={
            s.unpublished
              ? "Запустить публикацию всех накопленных правок сайта"
              : "Нет сохранённых правок для публикации"
          }
        >
          {publish.isPending ? "Публикация…" : "Опубликовать сайт"}
        </button>
      )}
    </div>
  );
}
