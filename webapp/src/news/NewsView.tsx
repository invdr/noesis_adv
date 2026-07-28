import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Asset,
  type News,
  type NewsLabel,
  type NewsStatus,
  type UpsertNewsInput,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import { productToday } from "../shared/date";

const KEY = ["news"];
const LABELS_KEY = ["news-labels"];

const STATUS_LABEL: Record<NewsStatus, string> = {
  draft: "Черновик",
  published: "Опубликован",
};

/** Раздел Новостей: список с фильтрами или форма редактирования. */
export function NewsView({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");

  const labels = useQuery({ queryKey: LABELS_KEY, queryFn: () => api.listNewsLabels() });
  const list = useQuery({
    queryKey: [...KEY, { search, status, includeArchived }],
    queryFn: () =>
      api.listNews({
        search: search || undefined,
        status: status || undefined,
        includeArchived,
      }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const archive = useMutation({ mutationFn: (id: string) => api.archiveNews(id), onSuccess: () => { setError(""); refresh(); }, onError });
  const restore = useMutation({ mutationFn: (id: string) => api.restoreNews(id), onSuccess: () => { setError(""); refresh(); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteNews(id), onSuccess: () => { setError(""); refresh(); }, onError });

  if (editing !== undefined) {
    return (
      <NewsForm
        id={editing}
        labels={labels.data ?? []}
        onClose={() => {
          setEditing(undefined);
          refresh();
        }}
      />
    );
  }

  const items = list.data?.items ?? [];

  return (
    <section>
      <div className="toolbar">
        <button onClick={() => setEditing(null)} className="btn-primary">
          + Новость
        </button>
        <input placeholder="Поиск по заголовку" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="draft">Черновики</option>
          <option value="published">Опубликованные</option>
        </select>
        {isAdmin && (
          <label className="check">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            архивные
          </label>
        )}
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>Заголовок</th>
              <th style={{ width: 150 }}>Метка</th>
              <th style={{ width: 130 }}>Дата</th>
              <th style={{ width: 160 }}>Статус</th>
              <th style={{ width: 240 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id} style={{ opacity: n.isArchived ? 0.55 : 1 }}>
                <td>
                  <button onClick={() => setEditing(n.id)} className="link-btn">{n.title}</button>
                  <div className="subtle-sm">/news/{n.slug}</div>
                </td>
                <td>{n.label?.name ?? <span className="subtle">нет</span>}</td>
                <td className="tnum">{formatDate(n.date)}</td>
                <td>
                  <span className="row wrap" style={{ gap: 6 }}>
                    <span className={`badge ${n.status === "published" ? "badge-success" : "badge-neutral"}`}>
                      {STATUS_LABEL[n.status]}
                    </span>
                    {n.isArchived && <span className="badge badge-neutral">архив</span>}
                  </span>
                </td>
                <td>
                  <span className="row wrap" style={{ gap: 6 }}>
                    {n.isArchived ? (
                      <button className="btn-sm" onClick={() => restore.mutate(n.id)}>восстановить</button>
                    ) : (
                      <button className="btn-sm" onClick={() => archive.mutate(n.id)}>архивировать</button>
                    )}
                    {isAdmin && (
                      <button className="btn-sm btn-danger" onClick={() => { if (window.confirm(`Удалить «${n.title}» навсегда?`)) remove.mutate(n.id); }}>
                        удалить
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="empty" style={{ textAlign: "center" }}>Пока нет новостей.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Обложка в форме: уже сохранённая или новый файл. */
type CoverItem =
  | { kind: "existing"; asset: Asset }
  | { kind: "new"; file: File; url: string }
  | null;

function NewsForm({
  id,
  labels,
  onClose,
}: {
  id: string | null;
  labels: NewsLabel[];
  onClose: () => void;
}) {
  const loaded = useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api.getNews(id as string),
    enabled: id !== null,
  });

  if (id !== null && loaded.isLoading) return <p className="hint">Загрузка…</p>;
  if (id !== null && !loaded.data)
    return (
      <p className="alert alert-error">
        Новость не найдена. <button className="link-btn" onClick={onClose}>назад</button>
      </p>
    );

  return <NewsFormBody id={id} news={loaded.data ?? null} labels={labels} onClose={onClose} />;
}

function NewsFormBody({
  id,
  news,
  labels,
  onClose,
}: {
  id: string | null;
  news: News | null;
  labels: NewsLabel[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(news?.title ?? "");
  const [slug, setSlug] = useState(news?.slug ?? "");
  const [labelId, setLabelId] = useState(news?.label?.id ?? "");
  const [date, setDate] = useState(toDateInput(news?.date));
  const [excerpt, setExcerpt] = useState(news?.excerpt ?? "");
  const [body, setBody] = useState(news?.body ?? "");
  const [status, setStatus] = useState<NewsStatus>(news?.status ?? "draft");
  const [cover, setCover] = useState<CoverItem>(
    news?.cover ? { kind: "existing", asset: news.cover } : null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  // Текущая метка могла уйти в архив — оставим её в списке выбора.
  const liveLabels = labels.filter((l) => !l.isArchived || l.id === labelId);

  const save = useMutation({
    mutationFn: () => {
      const removeCover = !cover && !!news?.cover;
      const coverFile = cover && cover.kind === "new" ? cover.file : undefined;
      const data: UpsertNewsInput = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        labelId: labelId || undefined,
        date: date || undefined,
        excerpt: excerpt.trim() || undefined,
        body: body.trim() || undefined,
        status,
        removeCover: removeCover || undefined,
        expectedUpdatedAt: news?.updatedAt,
      };
      return api.saveNews(data, coverFile, id ?? undefined);
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

  const err = (field: string) =>
    fieldErrors[field] ? <span className="field-error">{fieldErrors[field]}</span> : null;

  const coverPreview =
    cover?.kind === "existing"
      ? (cover.asset.renditions?.thumbnailUrl ?? cover.asset.url)
      : cover?.kind === "new"
        ? cover.url
        : null;

  return (
    <section className="page-narrow">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{id ? "Редактирование новости" : "Новая новость"}</h2>
        <button className="btn-ghost" onClick={onClose}>← к списку</button>
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <div className="card-body">
          <Field label="Заголовок*">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
            {err("title")}
          </Field>

          <Field label="Адрес страницы (slug)">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="генерируется из заголовка" />
            {err("slug")}
          </Field>

          <Field label="Метка">
            <select value={labelId} onChange={(e) => setLabelId(e.target.value)}>
              <option value="">Не выбрана</option>
              {liveLabels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {err("labelId")}
          </Field>

          <Field label="Дата">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {err("date")}
          </Field>

          <Field label="Краткое описание (для карточки каталога)">
            <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />
            {err("excerpt")}
          </Field>

          <Field label="Текст статьи (абзацы — через пустую строку)">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
            {err("body")}
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Обложка</h3>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCover({ kind: "new", file, url: URL.createObjectURL(file) });
              e.target.value = "";
            }}
          />
          {err("cover")}
          {coverPreview && (
            <div className="row" style={{ marginTop: 10, gap: 10 }}>
              <img src={coverPreview} alt="" style={{ width: 160, height: 90, objectFit: "cover", borderRadius: 8 }} />
              <button type="button" onClick={() => setCover(null)}>убрать обложку</button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Публикация</h3>
          <Field label="Статус">
            <select value={status} onChange={(e) => setStatus(e.target.value as NewsStatus)}>
              <option value="draft">Черновик (только в CRM)</option>
              <option value="published">Опубликован</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: "1.25rem" }}>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary" style={{ padding: "0.55rem 1.25rem" }}>
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

/**
 * ISO-дата → значение для `<input type="date">` (yyyy-mm-dd). Для НОВОЙ новости
 * подставляем продуктовый день (МСК), а не UTC: с 00:00 до 03:00 по Москве
 * `toISOString()` даёт вчерашнюю дату, и новость публиковалась задним числом.
 */
function toDateInput(iso?: string): string {
  if (!iso) return productToday();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** ISO-дата → «дд.мм.гггг» для списка. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU");
}
