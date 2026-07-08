import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  STAGE_COLORS,
  type Stage,
  type StageColor,
  type StageKind,
} from "@gsk-tower/contracts";
import { api, ApiError } from "../api/client";

const KIND_LABELS: Record<StageKind, string> = {
  in_progress: "В работе",
  won: "Успех",
  lost: "Отказ",
};

const STAGES_KEY = ["stages"];
const FUNNELS_KEY = ["funnels"];

/**
 * Настройка воронок и их этапов (admin). Сверху — выбор/управление воронками
 * (добавить, переименовать, назначить по умолчанию, порядок, архив), ниже —
 * этапы выбранной воронки. Этапы и инварианты (вход/успех/отказ) живут внутри
 * одной воронки.
 */
export function FunnelsAdmin() {
  const queryClient = useQueryClient();
  const funnels = useQuery({ queryKey: FUNNELS_KEY, queryFn: () => api.listFunnels() });
  const stagesQ = useQuery({ queryKey: STAGES_KEY, queryFn: () => api.listStages() });
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");

  const list = funnels.data ?? [];
  // Держим выбранной существующую воронку: по умолчанию — дефолтную или первую.
  useEffect(() => {
    if (list.length === 0) return;
    if (!list.some((f) => f.id === selectedId)) {
      setSelectedId((list.find((f) => f.isDefault) ?? list[0]!).id);
    }
  }, [list, selectedId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: FUNNELS_KEY });
    queryClient.invalidateQueries({ queryKey: STAGES_KEY });
  };
  const onError = (e: unknown) => setError((e as Error).message);
  const clearErr = () => setError("");

  const selected = list.find((f) => f.id === selectedId) ?? null;
  const funnelStages = (stagesQ.data ?? []).filter((s) => s.funnelId === selectedId);

  // --- мутации воронок ---
  const createFunnel = useMutation({
    mutationFn: (name: string) => api.createFunnel({ name }),
    onSuccess: (f) => {
      clearErr();
      setSelectedId(f.id);
      refresh();
    },
    onError,
  });
  const updateFunnel = useMutation({
    mutationFn: (v: { id: string; input: Parameters<typeof api.updateFunnel>[1] }) =>
      api.updateFunnel(v.id, v.input),
    onSuccess: () => {
      clearErr();
      refresh();
    },
    onError,
  });
  const reorderFunnels = useMutation({
    mutationFn: (ids: string[]) => api.reorderFunnels(ids),
    onSuccess: () => {
      clearErr();
      refresh();
    },
    onError,
  });
  const archiveFunnel = useMutation({
    mutationFn: (id: string) => api.archiveFunnel(id),
    onSuccess: () => {
      clearErr();
      setSelectedId("");
      refresh();
    },
    onError,
  });

  const moveFunnel = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((f) => f.id);
    const [m] = ids.splice(index, 1);
    if (m === undefined) return;
    ids.splice(j, 0, m);
    reorderFunnels.mutate(ids);
  };

  const addFunnel = () => {
    const name = window.prompt("Название новой воронки");
    if (name && name.trim()) createFunnel.mutate(name.trim());
  };

  const renameFunnel = () => {
    if (!selected) return;
    const name = window.prompt("Новое название воронки", selected.name);
    if (name && name.trim() && name.trim() !== selected.name) {
      updateFunnel.mutate({ id: selected.id, input: { name: name.trim() } });
    }
  };

  const doArchiveFunnel = () => {
    if (!selected) return;
    if (window.confirm(`Архивировать воронку «${selected.name}» вместе с её этапами?`)) {
      archiveFunnel.mutate(selected.id);
    }
  };

  if (funnels.isLoading || stagesQ.isLoading) return <p className="hint">Загрузка…</p>;

  const selectedIndex = list.findIndex((f) => f.id === selectedId);

  return (
    <section className="page-narrow">
      <p className="hint">
        Воронки — независимые наборы этапов. Новые заявки с сайта попадают во входной
        этап (★) воронки <b>по умолчанию</b>. В каждой воронке должен оставаться хотя бы
        один этап «Успех» и «Отказ».
      </p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="funnel-tabs" role="tablist" aria-label="Воронки">
        {list.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === selectedId}
            className={`funnel-tab${f.id === selectedId ? " is-active" : ""}`}
            onClick={() => setSelectedId(f.id)}
          >
            {f.name}
            {f.isDefault && <span title="По умолчанию"> ★</span>}
            <span className="funnel-tab-count">{f.stageCount}</span>
          </button>
        ))}
        <button className="funnel-tab funnel-tab-add" onClick={addFunnel}>
          + воронка
        </button>
      </div>

      {selected && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="card-body row wrap" style={{ gap: 10, justifyContent: "space-between" }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <b>{selected.name}</b>
              {selected.isDefault ? (
                <span className="badge badge-warn">★ по умолчанию</span>
              ) : (
                <button
                  className="btn-sm"
                  onClick={() => updateFunnel.mutate({ id: selected.id, input: { isDefault: true } })}
                >
                  сделать по умолчанию
                </button>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                className="icon-btn"
                disabled={selectedIndex <= 0}
                onClick={() => moveFunnel(selectedIndex, -1)}
                title="Левее"
                aria-label="Воронку левее"
              >
                ←
              </button>
              <button
                className="icon-btn"
                disabled={selectedIndex >= list.length - 1}
                onClick={() => moveFunnel(selectedIndex, 1)}
                title="Правее"
                aria-label="Воронку правее"
              >
                →
              </button>
              <button className="btn-sm" onClick={renameFunnel}>
                Переименовать
              </button>
              <button
                className="btn-sm btn-danger"
                disabled={selected.isDefault || list.length <= 1}
                title={
                  selected.isDefault
                    ? "Нельзя архивировать воронку по умолчанию"
                    : "Архивировать воронку"
                }
                onClick={doArchiveFunnel}
              >
                Архивировать
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <StagesTable
          key={selected.id}
          funnelId={selected.id}
          stages={funnelStages}
          onError={onError}
          clearErr={clearErr}
          refresh={refresh}
        />
      )}
    </section>
  );
}

/** Таблица этапов выбранной воронки (порядок, тип, цвет, входной, архив). */
function StagesTable({
  funnelId,
  stages,
  onError,
  clearErr,
  refresh,
}: {
  funnelId: string;
  stages: Stage[];
  onError: (e: unknown) => void;
  clearErr: () => void;
  refresh: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<StageKind>("in_progress");
  const [newColor, setNewColor] = useState<StageColor>("blue");
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      api.createStage({ funnelId, name: newName.trim(), kind: newKind, color: newColor }),
    onSuccess: () => {
      setNewName("");
      setNewKind("in_progress");
      setNewColor("blue");
      clearErr();
      refresh();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: (v: { id: string; input: Parameters<typeof api.updateStage>[1] }) =>
      api.updateStage(v.id, v.input),
    onSuccess: () => {
      clearErr();
      refresh();
    },
    onError,
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderStages(ids),
    onSuccess: () => {
      clearErr();
      refresh();
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (v: { id: string; target: string; confirmTerminal?: boolean }) =>
      api.archiveStage(v.id, { targetStageId: v.target, confirmTerminal: v.confirmTerminal }),
    onSuccess: () => {
      setArchivingId(null);
      setArchiveTarget("");
      clearErr();
      refresh();
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.code === "confirm_terminal") {
        if (window.confirm(e.message)) {
          const id = archivingId;
          if (id) archive.mutate({ id, target: archiveTarget, confirmTerminal: true });
        }
        return;
      }
      onError(e);
    },
  });

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= stages.length) return;
    const ids = stages.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(j, 0, moved);
    reorder.mutate(ids);
  };

  const kindBadge = (kind: StageKind) => {
    const cls =
      kind === "won" ? "badge-success" : kind === "lost" ? "badge-danger" : "badge-info";
    return <span className={`badge ${cls}`}>{KIND_LABELS[kind]}</span>;
  };

  return (
    <>
      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 84 }}>Порядок</th>
              <th>Название</th>
              <th style={{ width: 140 }}>Тип</th>
              <th style={{ width: 200 }}>Цвет</th>
              <th style={{ width: 120 }}>Вход</th>
              <th style={{ width: 230 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <span className="row" style={{ gap: 4 }}>
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
                      disabled={i === stages.length - 1}
                      onClick={() => move(i, 1)}
                      title="Ниже"
                      aria-label="Переместить ниже"
                    >
                      ↓
                    </button>
                  </span>
                </td>
                <td>
                  <input
                    defaultValue={s.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== s.name) update.mutate({ id: s.id, input: { name } });
                    }}
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <select
                    value={s.kind}
                    onChange={(e) =>
                      update.mutate({ id: s.id, input: { kind: e.target.value as StageKind } })
                    }
                  >
                    {(Object.keys(KIND_LABELS) as StageKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <StageColorPicker
                    value={s.color}
                    onChange={(color) => update.mutate({ id: s.id, input: { color } })}
                  />
                </td>
                <td>
                  {s.isEntry ? (
                    <span className="badge badge-warn" title="Входной этап">
                      ★ вход
                    </span>
                  ) : (
                    <button
                      className="btn-sm"
                      onClick={() => update.mutate({ id: s.id, input: { isEntry: true } })}
                    >
                      сделать входным
                    </button>
                  )}
                </td>
                <td>
                  {archivingId === s.id ? (
                    <span className="row" style={{ gap: 6 }}>
                      <select
                        value={archiveTarget}
                        onChange={(e) => setArchiveTarget(e.target.value)}
                      >
                        <option value="">перенести в…</option>
                        {stages
                          .filter((t) => t.id !== s.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                      <button
                        className="btn-sm btn-primary"
                        disabled={!archiveTarget}
                        onClick={() => archive.mutate({ id: s.id, target: archiveTarget })}
                      >
                        ок
                      </button>
                      <button className="btn-sm" onClick={() => setArchivingId(null)}>
                        отмена
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-sm btn-danger"
                      disabled={s.isEntry}
                      title={s.isEntry ? "Сначала назначьте другой входной этап" : "Архивировать"}
                      onClick={() => {
                        setArchivingId(s.id);
                        setArchiveTarget("");
                        clearErr();
                      }}
                    >
                      архивировать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate();
        }}
        className="toolbar"
        style={{ marginTop: "1rem" }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Новый этап"
        />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as StageKind)}>
          {(Object.keys(KIND_LABELS) as StageKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <StageColorPicker value={newColor} onChange={setNewColor} />
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Добавить
        </button>
      </form>
      <p className="hint" style={{ marginTop: "0.4rem" }}>
        {kindBadge("in_progress")} — этап в работе, {kindBadge("won")} — успешное закрытие,{" "}
        {kindBadge("lost")} — отказ.
      </p>
    </>
  );
}

/** Пикер цвета этапа: круглые образцы основных цветов. */
function StageColorPicker({
  value,
  onChange,
}: {
  value: StageColor;
  onChange: (color: StageColor) => void;
}) {
  return (
    <span className="swatches" role="group" aria-label="Цвет этапа">
      {STAGE_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`swatch stage-c-${c.value}${value === c.value ? " is-active" : ""}`}
          title={c.label}
          aria-label={c.label}
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
        />
      ))}
    </span>
  );
}
