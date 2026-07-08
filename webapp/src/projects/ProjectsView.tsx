import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BADGE_PALETTE,
  EMPTY_PROJECT_TOOLS,
  MAX_BADGES,
  MAX_GALLERY_IMAGES,
  ROOM_FORMAT_LABEL,
  type Asset,
  type Badge,
  type BadgeColor,
  type Developer,
  type Project,
  type ProjectStatus,
  type ProjectTools,
  type RoomFormat,
  type UpsertProjectInput,
} from "@gsk-tower/contracts";

/** Инструменты «Выбор квартиры»: подписи карточек лендинга. */
const TOOL_DEFS: { key: keyof ProjectTools; label: string; hint: string }[] = [
  { key: "chessboardUrl", label: "Интерактивная шахматка", hint: "«Открыть →»" },
  { key: "plansUrl", label: "Планировки", hint: "«Смотреть →»" },
  { key: "tour3dUrl", label: "3D тур", hint: "«Запустить →»" },
];
import { api, ApiError } from "../api/client";
import { ProjectDocuments } from "../documents/ProjectDocuments";
import { ProjectProgress } from "./ProjectProgress";

const KEY = ["projects"];
const ROOM_ORDER = Object.keys(ROOM_FORMAT_LABEL) as RoomFormat[];
const BADGE_KEYS = Object.keys(BADGE_PALETTE) as BadgeColor[];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Черновик",
  published: "Опубликован",
};

/** Раздел ЖК: список со списком/фильтрами или форма редактирования. */
export function ProjectsView({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  // undefined — список; null — новый ЖК; string — редактирование по id.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");

  const developers = useQuery({ queryKey: ["developers"], queryFn: () => api.listDevelopers() });
  const list = useQuery({
    queryKey: [...KEY, { search, status, includeArchived }],
    queryFn: () => api.listProjects({ search: search || undefined, status: status || undefined, includeArchived }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const archive = useMutation({ mutationFn: (id: string) => api.archiveProject(id), onSuccess: () => { setError(""); refresh(); }, onError });
  const restore = useMutation({ mutationFn: (id: string) => api.restoreProject(id), onSuccess: () => { setError(""); refresh(); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteProject(id), onSuccess: () => { setError(""); refresh(); }, onError });

  if (editing !== undefined) {
    return (
      <ProjectForm
        id={editing}
        developers={developers.data ?? []}
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
          + Новый ЖК
        </button>
        <input placeholder="Поиск по названию" value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <th>Название</th>
              <th style={{ width: 170 }}>Застройщик</th>
              <th style={{ width: 170 }}>Статус</th>
              <th style={{ width: 240 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} style={{ opacity: p.isArchived ? 0.55 : 1 }}>
                <td>
                  <button onClick={() => setEditing(p.id)} className="link-btn">
                    {p.name}
                  </button>
                  <div className="subtle" style={{ fontSize: 12 }}>/zhk/{p.slug}</div>
                </td>
                <td>{p.developer?.name ?? <span className="subtle">нет</span>}</td>
                <td>
                  <span className="row wrap" style={{ gap: 6 }}>
                    <span className={`badge ${p.status === "published" ? "badge-success" : "badge-neutral"}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                    {p.comingSoon && <span className="badge badge-info">Скоро</span>}
                    {p.isArchived && <span className="badge badge-neutral">архив</span>}
                  </span>
                </td>
                <td>
                  <span className="row wrap" style={{ gap: 6 }}>
                    {p.isArchived ? (
                      <button className="btn-sm" onClick={() => restore.mutate(p.id)}>восстановить</button>
                    ) : (
                      <button className="btn-sm" onClick={() => archive.mutate(p.id)}>архивировать</button>
                    )}
                    {isAdmin && (
                      <button className="btn-sm btn-danger" onClick={() => { if (window.confirm(`Удалить «${p.name}» навсегда?`)) remove.mutate(p.id); }}>
                        удалить
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="empty" style={{ textAlign: "center" }}>Пока нет ЖК.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Элемент галереи в форме: уже сохранённое фото или новый файл. */
type GalleryItem =
  | { kind: "existing"; asset: Asset }
  | { kind: "new"; file: File; url: string };

const keyOf = (item: GalleryItem) => (item.kind === "existing" ? item.asset.id : item.url);
const previewOf = (item: GalleryItem) =>
  item.kind === "existing" ? (item.asset.renditions?.thumbnailUrl ?? item.asset.url) : item.url;

function ProjectForm({
  id,
  developers,
  onClose,
}: {
  id: string | null;
  developers: Developer[];
  onClose: () => void;
}) {
  const loaded = useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api.getProject(id as string),
    enabled: id !== null,
  });

  if (id !== null && loaded.isLoading) return <p className="hint">Загрузка…</p>;
  if (id !== null && !loaded.data)
    return (
      <p className="alert alert-error">
        ЖК не найден. <button className="link-btn" onClick={onClose}>назад</button>
      </p>
    );

  return <ProjectFormBody id={id} project={loaded.data ?? null} developers={developers} onClose={onClose} />;
}

function ProjectFormBody({
  id,
  project,
  developers,
  onClose,
}: {
  id: string | null;
  project: Project | null;
  developers: Developer[];
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [address, setAddress] = useState(project?.address ?? "");
  const [developerId, setDeveloperId] = useState(project?.developer?.id ?? "");
  const [priceFrom, setPriceFrom] = useState(project?.priceFrom != null ? String(project.priceFrom) : "");
  const [rooms, setRooms] = useState<RoomFormat[]>(project?.rooms ?? []);
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "draft");
  const [comingSoon, setComingSoon] = useState(project?.comingSoon ?? false);
  const [badges, setBadges] = useState<Badge[]>(project?.badges ?? []);
  // Черновик инструментов: галочка + ссылка; сохраняется URL либо null.
  const [tools, setTools] = useState<Record<keyof ProjectTools, { enabled: boolean; url: string }>>(() => {
    const t = project?.tools ?? EMPTY_PROJECT_TOOLS;
    return {
      chessboardUrl: { enabled: t.chessboardUrl !== null, url: t.chessboardUrl ?? "" },
      plansUrl: { enabled: t.plansUrl !== null, url: t.plansUrl ?? "" },
      tour3dUrl: { enabled: t.tour3dUrl !== null, url: t.tour3dUrl ?? "" },
    };
  });
  const [items, setItems] = useState<GalleryItem[]>(
    (project?.images ?? []).map((asset) => ({ kind: "existing" as const, asset })),
  );
  const [coverKey, setCoverKey] = useState<string>(
    project?.cover?.id ?? (project?.images?.[0]?.id ?? ""),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const liveDevelopers = useMemo(
    // Текущий застройщик мог уйти в архив — оставим его в списке выбора.
    () => developers.filter((d) => !d.isArchived || d.id === developerId),
    [developers, developerId],
  );

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: GalleryItem[] = [];
    for (const file of Array.from(files)) {
      if (items.length + next.length >= MAX_GALLERY_IMAGES) break;
      next.push({ kind: "new", file, url: URL.createObjectURL(file) });
    }
    setItems((prev) => {
      const merged = [...prev, ...next];
      if (!coverKey && merged.length > 0) setCoverKey(keyOf(merged[0]!));
      return merged;
    });
  };

  const removeItem = (key: string) => {
    setItems((prev) => {
      const rest = prev.filter((it) => keyOf(it) !== key);
      if (key === coverKey) setCoverKey(rest[0] ? keyOf(rest[0]) : "");
      return rest;
    });
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      if (moved) copy.splice(j, 0, moved);
      return copy;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const newFiles: File[] = [];
      const images = items.map((item) => {
        if (item.kind === "existing") return { kind: "existing" as const, assetId: item.asset.id };
        const uploadIndex = newFiles.length;
        newFiles.push(item.file);
        return { kind: "new" as const, uploadIndex };
      });
      const coverIndex = items.findIndex((it) => keyOf(it) === coverKey);
      const priceTrim = priceFrom.trim();
      const price = priceTrim === "" ? null : Math.round(Number(priceTrim));
      const data: UpsertProjectInput = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        address: address.trim() || undefined,
        developerId: developerId || undefined,
        priceFrom: Number.isFinite(price) ? price : null,
        rooms: ROOM_ORDER.filter((r) => rooms.includes(r)),
        description: description.trim() || undefined,
        badges,
        tools: Object.fromEntries(
          TOOL_DEFS.map((t) => [t.key, tools[t.key].enabled ? tools[t.key].url.trim() : null]),
        ) as ProjectTools,
        status,
        comingSoon,
        images,
        coverIndex: coverIndex >= 0 ? coverIndex : undefined,
        expectedUpdatedAt: project?.updatedAt,
      };
      return api.saveProject(data, newFiles, id ?? undefined);
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

  // Включённый инструмент обязан иметь http(s)-ссылку — иначе на сайте была бы
  // «мёртвая» карточка (ровно от этого ушли от глобальных флагов).
  const submit = () => {
    const toolErrors: Record<string, string> = {};
    for (const t of TOOL_DEFS) {
      const draft = tools[t.key];
      if (!draft.enabled) continue;
      if (!/^https?:\/\//i.test(draft.url.trim())) {
        toolErrors[`tools.${t.key}`] = "Укажите ссылку (http:// или https://)";
      }
    }
    if (Object.keys(toolErrors).length > 0) {
      setFieldErrors(toolErrors);
      setError("Проверьте ссылки инструментов «Выбор квартиры».");
      return;
    }
    setFieldErrors({});
    setError("");
    save.mutate();
  };

  return (
    <section className="page-narrow">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{id ? "Редактирование ЖК" : "Новый ЖК"}</h2>
        <button className="btn-ghost" onClick={onClose}>← к списку</button>
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <div className="card-body">
          <Field label="Название*">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            {err("name")}
          </Field>

          <Field label="Адрес страницы (slug)">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="генерируется из названия" />
            {err("slug")}
          </Field>

          <Field label="Адрес">
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
            {err("address")}
          </Field>

          <Field label="Застройщик">
            <select value={developerId} onChange={(e) => setDeveloperId(e.target.value)}>
              <option value="">Не выбран</option>
              {liveDevelopers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {err("developerId")}
          </Field>

          <Field label="Цена «от», ₽">
            <input value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} inputMode="numeric" placeholder="пусто → «Цена по запросу»" />
            {err("priceFrom")}
          </Field>

          <Field label="Комнатность">
            <div className="row wrap" style={{ gap: 12 }}>
              {ROOM_ORDER.map((r) => (
                <label key={r} className="check">
                  <input
                    type="checkbox"
                    checked={rooms.includes(r)}
                    onChange={(e) =>
                      setRooms((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))
                    }
                  />
                  {ROOM_FORMAT_LABEL[r]}
                </label>
              ))}
            </div>
            {err("rooms")}
          </Field>

          <Field label="Описание">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
            {err("description")}
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Фотографии</h3>
          <p className="hint" style={{ marginTop: 0 }}>Обложка отмечена звёздочкой.</p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {err("images")}
          {err("coverIndex")}
          <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
            {items.map((item, i) => {
              const key = keyOf(item);
              return (
                <div key={key} className="thumb">
                  <img src={previewOf(item)} alt="" />
                  <div className="row" style={{ gap: 4, justifyContent: "space-between", marginTop: 6 }}>
                    <button type="button" className="icon-btn" title="Сделать обложкой" aria-label={key === coverKey ? "Обложка" : "Сделать обложкой"} aria-pressed={key === coverKey} onClick={() => setCoverKey(key)} style={{ color: key === coverKey ? "#f59e0b" : "var(--fg-subtle)" }}>★</button>
                    <span className="row" style={{ gap: 2 }}>
                      <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label="Сдвинуть левее">←</button>
                      <button type="button" className="icon-btn" disabled={i === items.length - 1} onClick={() => moveItem(i, 1)} aria-label="Сдвинуть правее">→</button>
                    </span>
                    <button type="button" className="icon-btn" onClick={() => removeItem(key)} title="Удалить" aria-label="Удалить фото">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Бейджи</h3>
          {badges.map((b, i) => (
            <div key={i} className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              <input
                value={b.text}
                onChange={(e) => setBadges((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                placeholder="Текст"
                style={{ width: 200 }}
              />
              <select
                value={b.color}
                onChange={(e) => setBadges((prev) => prev.map((x, j) => (j === i ? { ...x, color: e.target.value as BadgeColor } : x)))}
              >
                {BADGE_KEYS.map((c) => (
                  <option key={c} value={c}>{BADGE_PALETTE[c].label}</option>
                ))}
              </select>
              <span style={{ background: BADGE_PALETTE[b.color].bg, color: BADGE_PALETTE[b.color].fg, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                {b.text || "бейдж"}
              </span>
              <button type="button" className="icon-btn" aria-label="Удалить бейдж" onClick={() => setBadges((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {badges.length < MAX_BADGES && (
            <button type="button" className="btn-sm" onClick={() => setBadges((prev) => [...prev, { text: "", color: "blue" }])}>+ бейдж</button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Публикация</h3>
          <Field label="Статус">
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              <option value="draft">Черновик (только в CRM)</option>
              <option value="published">Опубликован</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={comingSoon} onChange={(e) => setComingSoon(e.target.checked)} />
            «Скоро на сайте» (тизер-карточка без страницы)
          </label>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Инструменты «Выбор квартиры»</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Карточки «Интерактивная шахматка / Планировки / 3D тур» на странице этого ЖК
            и в карточке на главной. Карточка показывается только с заполненной
            ссылкой (открывается в новой вкладке); без ссылки — скрыта.
          </p>
          {TOOL_DEFS.map((t) => {
            const draft = tools[t.key];
            return (
              <div key={t.key} style={{ marginBottom: 10 }}>
                <label className="check" style={{ display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) =>
                      setTools((prev) => ({
                        ...prev,
                        [t.key]: { ...prev[t.key], enabled: e.target.checked },
                      }))
                    }
                  />
                  <span>
                    {t.label} <span className="hint">{t.hint}</span>
                  </span>
                </label>
                {draft.enabled && (
                  <div style={{ marginTop: 6, marginLeft: 26 }}>
                    <input
                      type="url"
                      value={draft.url}
                      onChange={(e) =>
                        setTools((prev) => ({
                          ...prev,
                          [t.key]: { ...prev[t.key], url: e.target.value },
                        }))
                      }
                      placeholder="https://…"
                      style={{ width: "100%", maxWidth: 480 }}
                    />
                    {err(`tools.${t.key}`)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Документы</h3>
          {id === null ? (
            <p className="hint" style={{ marginTop: 0 }}>
              Сохраните ЖК, затем добавьте документы — они привязываются к карточке и
              сохраняются сразу.
            </p>
          ) : (
            <ProjectDocuments projectId={id} />
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Ход строительства</h3>
          {id === null ? (
            <p className="hint" style={{ marginTop: 0 }}>
              Сохраните ЖК, затем добавьте фотоотчёты по месяцам — они привязываются
              к карточке и сохраняются сразу.
            </p>
          ) : (
            <ProjectProgress projectId={id} />
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: "1.25rem" }}>
        <button onClick={submit} disabled={save.isPending} className="btn-primary" style={{ padding: "0.55rem 1.25rem" }}>
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
