import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BADGE_PALETTE,
  CONSTRUCTION_FORMAT_LABEL,
  CONSTRUCTION_LIGHTING_LABEL,
  CONSTRUCTION_SIDE_COUNT_LABEL,
  MAX_BADGES,
  MAX_GALLERY_IMAGES,
  type Asset,
  type Badge,
  type BadgeColor,
  type Construction,
  type ConstructionFormat,
  type ConstructionLighting,
  type ConstructionSideCount,
  type ConstructionStatus,
  type Developer,
  type UpsertConstructionInput,
} from "@noesis/contracts";
import { api, ApiError } from "../api/client";
import { ProjectDocuments } from "../documents/ProjectDocuments";
import { ProjectProgress } from "./ProjectProgress";

const KEY = ["constructions"];
const FORMAT_KEYS = Object.keys(CONSTRUCTION_FORMAT_LABEL) as ConstructionFormat[];
const LIGHTING_KEYS = Object.keys(
  CONSTRUCTION_LIGHTING_LABEL,
) as ConstructionLighting[];
const BADGE_KEYS = Object.keys(BADGE_PALETTE) as BadgeColor[];

const STATUS_LABEL: Record<ConstructionStatus, string> = {
  draft: "Черновик",
  published: "Опубликована",
};

/** Строка «» / число → number | null (пусто = не задано). */
const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Раздел конструкций: список с фильтрами или форма редактирования. */
export function ProjectsView({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  // undefined — список; null — новая конструкция; string — правка по id.
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
          + Новая конструкция
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
              <th style={{ width: 150 }}>Формат</th>
              <th style={{ width: 160 }}>Владелец сети</th>
              <th style={{ width: 150 }}>Статус</th>
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
                  <div className="subtle" style={{ fontSize: 12 }}>/construction/{p.slug}</div>
                </td>
                <td>{CONSTRUCTION_FORMAT_LABEL[p.format]}</td>
                <td>{p.owner?.name ?? <span className="subtle">нет</span>}</td>
                <td>
                  <span className="row wrap" style={{ gap: 6 }}>
                    <span className={`badge ${p.status === "published" ? "badge-success" : "badge-neutral"}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
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
              <tr><td colSpan={5} className="empty" style={{ textAlign: "center" }}>Пока нет конструкций.</td></tr>
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
        Конструкция не найдена. <button className="link-btn" onClick={onClose}>назад</button>
      </p>
    );

  return <ProjectFormBody id={id} construction={loaded.data ?? null} developers={developers} onClose={onClose} />;
}

function ProjectFormBody({
  id,
  construction,
  developers,
  onClose,
}: {
  id: string | null;
  construction: Construction | null;
  developers: Developer[];
  onClose: () => void;
}) {
  const [name, setName] = useState(construction?.name ?? "");
  const [code, setCode] = useState(construction?.code ?? "");
  const [slug, setSlug] = useState(construction?.slug ?? "");
  const [address, setAddress] = useState(construction?.address ?? "");
  const [district, setDistrict] = useState(construction?.district ?? "");
  const [ownerId, setOwnerId] = useState(construction?.owner?.id ?? "");
  const [format, setFormat] = useState<ConstructionFormat>(construction?.format ?? "cityFormat");
  const [size, setSize] = useState(construction?.size ?? "");
  const [sideCount, setSideCount] = useState<ConstructionSideCount>(construction?.sideCount ?? 1);
  const [lighting, setLighting] = useState<ConstructionLighting>(construction?.lighting ?? "none");
  const [grp, setGrp] = useState(construction?.grp != null ? String(construction.grp) : "");
  const [trafficPerDay, setTrafficPerDay] = useState(construction?.trafficPerDay != null ? String(construction.trafficPerDay) : "");
  const [pricePerMonth, setPricePerMonth] = useState(construction?.pricePerMonth != null ? String(construction.pricePerMonth) : "");
  const [lat, setLat] = useState(construction?.lat != null ? String(construction.lat) : "");
  const [lng, setLng] = useState(construction?.lng != null ? String(construction.lng) : "");
  const [description, setDescription] = useState(construction?.description ?? "");
  const [status, setStatus] = useState<ConstructionStatus>(construction?.status ?? "draft");
  const [badges, setBadges] = useState<Badge[]>(construction?.badges ?? []);
  const [items, setItems] = useState<GalleryItem[]>(
    (construction?.images ?? []).map((asset) => ({ kind: "existing" as const, asset })),
  );
  const [coverKey, setCoverKey] = useState<string>(
    construction?.cover?.id ?? (construction?.images?.[0]?.id ?? ""),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const liveOwners = useMemo(
    // Текущий владелец мог уйти в архив — оставим его в списке выбора.
    () => developers.filter((d) => !d.isArchived || d.id === ownerId),
    [developers, ownerId],
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
      const price = num(pricePerMonth);
      const traffic = num(trafficPerDay);
      const data: UpsertConstructionInput = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        code: code.trim() || undefined,
        address: address.trim() || undefined,
        district: district.trim() || undefined,
        ownerId: ownerId || undefined,
        lat: num(lat),
        lng: num(lng),
        format,
        size: size.trim() || undefined,
        sideCount,
        lighting,
        grp: num(grp),
        trafficPerDay: traffic != null ? Math.round(traffic) : null,
        pricePerMonth: price != null ? Math.round(price) : null,
        description: description.trim() || undefined,
        badges,
        status,
        images,
        coverIndex: coverIndex >= 0 ? coverIndex : undefined,
        expectedUpdatedAt: construction?.updatedAt,
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

  const submit = () => {
    setFieldErrors({});
    setError("");
    save.mutate();
  };

  return (
    <section className="page-narrow">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{id ? "Редактирование конструкции" : "Новая конструкция"}</h2>
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

          <Field label="Инвентарный код">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="напр. СФ-014" />
            {err("code")}
          </Field>

          <Field label="Адрес страницы (slug)">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="генерируется из названия" />
            {err("slug")}
          </Field>

          <Field label="Адрес">
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
            {err("address")}
          </Field>

          <Field label="Район">
            <input value={district} onChange={(e) => setDistrict(e.target.value)} />
            {err("district")}
          </Field>

          <Field label="Владелец сети">
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Не выбран</option>
              {liveOwners.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {err("ownerId")}
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Характеристики</h3>
          <Field label="Формат">
            <select value={format} onChange={(e) => setFormat(e.target.value as ConstructionFormat)}>
              {FORMAT_KEYS.map((f) => (
                <option key={f} value={f}>{CONSTRUCTION_FORMAT_LABEL[f]}</option>
              ))}
            </select>
            {err("format")}
          </Field>

          <Field label="Габариты">
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="напр. 1,2 × 1,8 м" />
            {err("size")}
          </Field>

          <Field label="Стороны">
            <select value={String(sideCount)} onChange={(e) => setSideCount(Number(e.target.value) as ConstructionSideCount)}>
              <option value="1">{CONSTRUCTION_SIDE_COUNT_LABEL[1]}</option>
              <option value="2">{CONSTRUCTION_SIDE_COUNT_LABEL[2]}</option>
            </select>
            {err("sideCount")}
          </Field>

          <Field label="Подсветка">
            <select value={lighting} onChange={(e) => setLighting(e.target.value as ConstructionLighting)}>
              {LIGHTING_KEYS.map((l) => (
                <option key={l} value={l}>{CONSTRUCTION_LIGHTING_LABEL[l]}</option>
              ))}
            </select>
            {err("lighting")}
          </Field>

          <Field label="GRP (охват)">
            <input value={grp} onChange={(e) => setGrp(e.target.value)} inputMode="decimal" placeholder="если известен" />
            {err("grp")}
          </Field>

          <Field label="Суточный трафик">
            <input value={trafficPerDay} onChange={(e) => setTrafficPerDay(e.target.value)} inputMode="numeric" placeholder="пассажиро-/автопоток" />
            {err("trafficPerDay")}
          </Field>

          <Field label="Цена, ₽/мес">
            <input value={pricePerMonth} onChange={(e) => setPricePerMonth(e.target.value)} inputMode="numeric" placeholder="пусто → «Цена по запросу»" />
            {err("pricePerMonth")}
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Расположение на карте</h3>
          <p className="hint" style={{ marginTop: 0 }}>Координаты для карты города. Заполняются парой.</p>
          <div className="row wrap" style={{ gap: 12 }}>
            <Field label="Широта (lat)">
              <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="43.3169" />
              {err("lat")}
            </Field>
            <Field label="Долгота (lng)">
              <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="45.6942" />
              {err("lng")}
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
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
            <select value={status} onChange={(e) => setStatus(e.target.value as ConstructionStatus)}>
              <option value="draft">Черновик (только в CRM)</option>
              <option value="published">Опубликована</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Документы</h3>
          {id === null ? (
            <p className="hint" style={{ marginTop: 0 }}>
              Сохраните конструкцию, затем добавьте документы — они привязываются к
              карточке и сохраняются сразу.
            </p>
          ) : (
            <ProjectDocuments projectId={id} />
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-body">
          <h3 className="section-title">Фотоотчёты</h3>
          {id === null ? (
            <p className="hint" style={{ marginTop: 0 }}>
              Сохраните конструкцию, затем добавьте фотоотчёты по месяцам — они
              привязываются к карточке и сохраняются сразу.
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
