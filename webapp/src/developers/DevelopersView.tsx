import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Developer, UpsertDeveloperInput } from "@noesis/contracts";
import { api } from "../api/client";

const KEY = ["developers"];

type DeveloperDetailKey = Exclude<keyof UpsertDeveloperInput, "name" | "removeLogo">;

const DETAIL_GROUPS: {
  title: string;
  fields: { key: DeveloperDetailKey; label: string; wide?: boolean }[];
}[] = [
  {
    title: "Данные ООО",
    fields: [
      { key: "legalName", label: "Полное наименование", wide: true },
      { key: "inn", label: "ИНН" },
      { key: "kpp", label: "КПП" },
      { key: "ogrn", label: "ОГРН" },
      { key: "legalAddress", label: "Юридический адрес", wide: true },
      { key: "postalAddress", label: "Почтовый адрес", wide: true },
    ],
  },
  {
    title: "Банк",
    fields: [
      { key: "bankName", label: "Банк", wide: true },
      { key: "bankBik", label: "БИК" },
      { key: "bankAccount", label: "Расчётный счёт" },
      { key: "correspondentAccount", label: "Корр. счёт" },
    ],
  },
  {
    title: "Руководитель",
    fields: [
      { key: "directorTitle", label: "Должность" },
      { key: "directorFullName", label: "ФИО" },
      { key: "directorBasis", label: "Действует на основании", wide: true },
    ],
  },
];

function emptyToNull(value: string): string | null {
  return value.trim() || null;
}

/** Справочник застройщиков (admin): добавление, переименование, логотип, архив. */
export function DevelopersView() {
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [error, setError] = useState("");

  const list = useQuery({
    queryKey: [...KEY, includeArchived],
    queryFn: () => api.listDevelopers(includeArchived),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const ok = () => {
    setError("");
    refresh();
  };

  const create = useMutation({
    mutationFn: () => api.saveDeveloper({ name: name.trim() }, logo ?? undefined),
    onSuccess: () => {
      setName("");
      setLogo(null);
      ok();
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api.saveDeveloper({ name: v.name }, undefined, v.id),
    onSuccess: ok,
    onError,
  });
  const archive = useMutation({ mutationFn: (id: string) => api.archiveDeveloper(id), onSuccess: ok, onError });
  const restore = useMutation({ mutationFn: (id: string) => api.restoreDeveloper(id), onSuccess: ok, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteDeveloper(id), onSuccess: ok, onError });

  const devs = list.data ?? [];

  return (
    <section className="page-narrow">
      <p className="hint">
        Справочник застройщиков. Менеджеры выбирают их при заведении ЖК. «Удалить»
        навсегда можно, только если на застройщика не ссылается ни один ЖК — иначе
        используйте архив.
      </p>

      <label className="check" style={{ marginBottom: "1rem" }}>
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Показывать архивные
      </label>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 72 }}>Лого</th>
              <th>Название</th>
              <th style={{ width: 260 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {devs.map((d) => (
              <Fragment key={d.id}>
                <tr style={{ opacity: d.isArchived ? 0.55 : 1 }}>
                  <td>
                    {d.logo ? (
                      <img src={d.logo.url} alt="" style={{ height: 32, maxWidth: 60, objectFit: "contain" }} />
                    ) : (
                      <span className="subtle">нет</span>
                    )}
                  </td>
                  <td>
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => {
                        const n = e.target.value.trim();
                        if (n && n !== d.name) rename.mutate({ id: d.id, name: n });
                      }}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {d.isArchived ? (
                        <button className="btn-sm" onClick={() => restore.mutate(d.id)}>
                          восстановить
                        </button>
                      ) : (
                        <button className="btn-sm" onClick={() => archive.mutate(d.id)}>
                          архивировать
                        </button>
                      )}
                      <button
                        className="btn-sm btn-danger"
                        onClick={() => {
                          if (window.confirm(`Удалить «${d.name}» навсегда?`)) remove.mutate(d.id);
                        }}
                      >
                        удалить
                      </button>
                    </span>
                  </td>
                </tr>
                <tr style={{ opacity: d.isArchived ? 0.55 : 1 }}>
                  <td colSpan={3} style={{ paddingTop: 0 }}>
                    <DeveloperDetails developer={d} onSaved={ok} onError={onError} />
                  </td>
                </tr>
              </Fragment>
            ))}
            {devs.length === 0 && (
              <tr>
                <td colSpan={3} className="empty" style={{ textAlign: "center" }}>
                  Пока нет застройщиков.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="toolbar"
        style={{ marginTop: "1rem" }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый застройщик" />
        <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Добавить
        </button>
      </form>
    </section>
  );
}

function DeveloperDetails({
  developer,
  onSaved,
  onError,
}: {
  developer: Developer;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [values, setValues] = useState<Record<DeveloperDetailKey, string>>(() => {
    const out = {} as Record<DeveloperDetailKey, string>;
    for (const group of DETAIL_GROUPS) {
      for (const field of group.fields) {
        out[field.key] = developer[field.key] ?? "";
      }
    }
    return out;
  });

  const filled = Object.values(values).filter((v) => v.trim()).length;
  const save = useMutation({
    mutationFn: () =>
      api.saveDeveloper(
        {
          name: developer.name,
          ...Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, emptyToNull(value)]),
          ),
        } as UpsertDeveloperInput,
        undefined,
        developer.id,
      ),
    onSuccess: onSaved,
    onError,
  });

  return (
    <details className="settings-group developer-details">
      <summary className="settings-group-summary">
        <span className="settings-group-chevron" aria-hidden="true">
          ›
        </span>
        <span className="card-title">Реквизиты</span>
        {filled > 0 && <span className="lead-collapse-count">{filled}</span>}
      </summary>
      <div className="settings-group-body">
        {DETAIL_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: "1rem" }}>
            <h4 className="section-title" style={{ margin: "0 0 0.7rem" }}>
              {group.title}
            </h4>
            <div className="settings-grid">
              {group.fields.map((field) => {
                const control = field.wide ? (
                  <textarea
                    rows={2}
                    value={values[field.key]}
                    onChange={(e) =>
                      setValues((cur) => ({ ...cur, [field.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    value={values[field.key]}
                    onChange={(e) =>
                      setValues((cur) => ({ ...cur, [field.key]: e.target.value }))
                    }
                  />
                );
                return (
                  <div key={field.key} className={`field${field.wide ? " field-wide" : ""}`}>
                    <div className="field-label">{field.label}</div>
                    {control}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn-primary"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          Сохранить реквизиты
        </button>
      </div>
    </details>
  );
}
