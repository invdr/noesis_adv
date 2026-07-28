import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import "./DictionaryAdmin.css";

/** Минимальная форма записи справочника. */
export interface DictEntry {
  id: string;
  name: string;
  isArchived: boolean;
}

/** Набор операций справочника (метки новостей, категории документов и т. п.). */
export interface DictApi<T extends DictEntry> {
  queryKey: string[];
  list: (includeArchived: boolean) => Promise<T[]>;
  create: (name: string) => Promise<T>;
  rename: (id: string, name: string) => Promise<T>;
  reorder: (ids: string[]) => Promise<T[]>;
  archive: (id: string) => Promise<T>;
  restore: (id: string) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

/**
 * Общий экран простого справочника (admin): добавление, переименование,
 * перестановка живых записей, архивация/восстановление и удаление навсегда
 * (если запись не используется). Используется для меток новостей, категорий
 * документов и источников заявок.
 *
 * `lockOf` позволяет справочнику с системными строками (источники) ограничить
 * действия по записи: `"full"` — только перестановка (имя и жизненный цикл
 * заблокированы), `"lifecycle"` — можно переименовать, нельзя архивировать/
 * удалить. По умолчанию запись полностью редактируемая.
 */
export function DictionaryAdmin<T extends DictEntry>({
  api: d,
  title,
  description,
  addPlaceholder,
  lockOf,
}: {
  api: DictApi<T>;
  title: string;
  description: string;
  addPlaceholder: string;
  lockOf?: (item: T) => "full" | "lifecycle" | undefined;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  // Флаг архивных — часть ключа, как в DevelopersView. Экран справочника
  // просит list(true), а рабочие экраны — list(false) под тем же голым ключом:
  // после захода сюда в пикерах заявок и броней из кэша появлялись архивные
  // записи. Инвалидация по базовому ключу задевает оба варианта по префиксу.
  const items = useQuery({
    queryKey: [...d.queryKey, { includeArchived: true }],
    queryFn: () => d.list(true),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: d.queryKey });
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const ok = () => {
    setError("");
    refresh();
  };

  const create = useMutation({
    mutationFn: (name: string) => d.create(name),
    onSuccess: () => {
      setNewName("");
      ok();
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => d.rename(v.id, v.name),
    onSuccess: ok,
    onError,
  });
  const reorder = useMutation({ mutationFn: (ids: string[]) => d.reorder(ids), onSuccess: ok, onError });
  const archive = useMutation({ mutationFn: (id: string) => d.archive(id), onSuccess: ok, onError });
  const restore = useMutation({ mutationFn: (id: string) => d.restore(id), onSuccess: ok, onError });
  const remove = useMutation({ mutationFn: (id: string) => d.remove(id), onSuccess: ok, onError });

  const rows = items.data ?? [];
  const live = rows.filter((r) => !r.isArchived);
  const archived = rows.filter((r) => r.isArchived);

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= live.length) return;
    const ids = live.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(j, 0, moved);
    reorder.mutate(ids);
  };

  return (
    <section className="dictionary-admin">
      <h2>{title}</h2>
      <p className="hint">{description}</p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card dictionary-admin__table-card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th className="dictionary-admin__order-col">Порядок</th>
              <th>Название</th>
              <th className="dictionary-admin__actions-col">Действия</th>
            </tr>
          </thead>
          <tbody>
            {live.map((item, i) => {
              const lock = lockOf?.(item);
              return (
                <tr key={item.id}>
                  <td>
                    <span className="dictionary-admin__order-controls">
                      <button
                        className="icon-btn"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        title="Выше"
                        aria-label="Переместить выше"
                      >
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        disabled={i === live.length - 1}
                        onClick={() => move(i, 1)}
                        title="Ниже"
                        aria-label="Переместить ниже"
                      >
                        ↓
                      </button>
                    </span>
                  </td>
                  <td>
                    {lock === "full" ? (
                      <span className="dictionary-admin__name-row">
                        {item.name}
                        <span className="badge badge-neutral" title="Идентификатор зашит в формы сайта">
                          системный
                        </span>
                      </span>
                    ) : (
                      <span className="dictionary-admin__name-row">
                        <input
                          className="dictionary-admin__name-input"
                          defaultValue={item.name}
                          onBlur={(e) => {
                            const name = e.target.value.trim();
                            if (name && name !== item.name) rename.mutate({ id: item.id, name });
                          }}
                        />
                        {lock === "lifecycle" && (
                          <span className="badge badge-neutral" title="Встроенный: удалить нельзя">
                            встроенный
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    {lock ? (
                      <span className="subtle">—</span>
                    ) : (
                      <span className="dictionary-admin__actions">
                        <button className="btn-sm" onClick={() => archive.mutate(item.id)}>
                          архивировать
                        </button>
                        <button
                          className="btn-sm btn-danger"
                          onClick={() => {
                            if (window.confirm(`Удалить «${item.name}» навсегда?`)) remove.mutate(item.id);
                          }}
                        >
                          удалить
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {archived.map((item) => (
              <tr key={item.id} className="dictionary-admin__archived-row">
                <td className="subtle">—</td>
                <td>
                  {item.name} <span className="badge badge-neutral">архив</span>
                </td>
                <td>
                  <button className="btn-sm" onClick={() => restore.mutate(item.id)}>
                    восстановить
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="empty dictionary-admin__empty-cell">
                  Пока пусто.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate(newName.trim());
        }}
        className="toolbar dictionary-admin__form"
      >
        <input
          className="dictionary-admin__new-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={addPlaceholder}
        />
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Добавить
        </button>
      </form>
    </section>
  );
}
