import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  documentFileMeta,
  type CreateDocumentInput,
  type Document,
  type DocumentKind,
} from "@noesis/contracts";
import { api } from "../api/client";

/**
 * Управление документами в карточке ЖК. Операции мгновенные (не в снимке
 * «Сохранить ЖК»): добавление файла/ссылки, переименование, удаление. Документы
 * сгруппированы по категориям общего справочника.
 */
export function ProjectDocuments({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["project-documents", projectId];
  const [error, setError] = useState("");

  const docs = useQuery({ queryKey: key, queryFn: () => api.listProjectDocuments(projectId) });
  const categories = useQuery({
    queryKey: ["document-categories"],
    queryFn: () => api.listDocumentCategories(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const ok = () => {
    setError("");
    refresh();
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDocument(projectId, id),
    onSuccess: ok,
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api.updateDocument(projectId, v.id, { name: v.name }),
    onSuccess: ok,
    onError,
  });

  const items = docs.data ?? [];
  const groups = new Map<string, { name: string; docs: Document[] }>();
  for (const d of items) {
    const k = d.category?.id ?? "—";
    if (!groups.has(k)) groups.set(k, { name: d.category?.name ?? "Без категории", docs: [] });
    groups.get(k)!.docs.push(d);
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Документы добавляются и удаляются сразу (отдельно от кнопки «Сохранить ЖК»).
        Категории — из общего справочника.
      </p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {[...groups.values()].map((g) => (
        <div key={g.name} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, margin: "6px 0" }}>{g.name}</div>
          {g.docs.map((d) => (
            <div key={d.id} className="row" style={{ gap: 8, padding: "0.3rem 0" }}>
              <input
                defaultValue={d.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== d.name) rename.mutate({ id: d.id, name });
                }}
                style={{ flex: 1 }}
              />
              <span className="subtle" style={{ fontSize: 12, minWidth: 130 }}>{metaOf(d)}</span>
              <a href={hrefOf(d)} target="_blank" rel="noopener noreferrer">
                {d.kind === "file" ? "↓ скачать" : "↗ открыть"}
              </a>
              <button
                className="icon-btn"
                aria-label="Удалить документ"
                onClick={() => {
                  if (window.confirm(`Удалить документ «${d.name}»?`)) remove.mutate(d.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
      {items.length === 0 && <p className="empty">Пока нет документов.</p>}

      <AddDocument
        projectId={projectId}
        categories={(categories.data ?? []).filter((c) => !c.isArchived)}
        onAdded={ok}
        onError={onError}
      />
    </div>
  );
}

/** Мелкая строка карточки: тип·размер для файла, подпись/«ссылка» для ссылки. */
function metaOf(d: Document): string {
  if (d.kind === "file") return documentFileMeta(d.asset.mimeType, d.asset.size);
  return d.caption || "Внешняя ссылка";
}

function hrefOf(d: Document): string {
  return d.kind === "file" ? d.asset.url : d.url;
}

function AddDocument({
  projectId,
  categories,
  onAdded,
  onError,
}: {
  projectId: string;
  categories: { id: string; name: string }[];
  onAdded: () => void;
  onError: (e: unknown) => void;
}) {
  const [kind, setKind] = useState<DocumentKind>("file");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const add = useMutation({
    mutationFn: () => {
      if (kind === "link") {
        const input: CreateDocumentInput = {
          kind: "link",
          categoryId,
          name: name.trim(),
          url: url.trim(),
          caption: caption.trim() || undefined,
        };
        return api.addDocument(projectId, input);
      }
      const input: CreateDocumentInput = {
        kind: "file",
        categoryId,
        name: name.trim() || undefined,
      };
      return api.addDocument(projectId, input, file ?? undefined);
    },
    onSuccess: () => {
      setName("");
      setUrl("");
      setCaption("");
      setFile(null);
      onAdded();
    },
    onError,
  });

  const canAdd =
    categoryId !== "" &&
    (kind === "link" ? name.trim() !== "" && url.trim() !== "" : file !== null);

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          <option value="file">Файл</option>
          <option value="link">Ссылка</option>
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Категория</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "file" ? "Название (или из имени файла)" : "Название*"}
          style={{ minWidth: 200 }}
        />
        {kind === "file" ? (
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,.pptx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        ) : (
          <>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              style={{ minWidth: 220 }}
            />
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Подпись (напр. «Декларация на наш.дом.рф»)"
              style={{ minWidth: 220 }}
            />
          </>
        )}
        <button className="btn-primary" disabled={!canAdd || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Добавление…" : "+ добавить"}
        </button>
      </div>
      {categories.length === 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          Нет категорий. Заведите их в разделе «Категории документов» (admin).
        </p>
      )}
    </div>
  );
}
