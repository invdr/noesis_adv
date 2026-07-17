import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ALLOWED_IMAGE_MIMES,
  MAX_PROGRESS_PHOTOS_PER_REQUEST,
  PROGRESS_MONTHS,
  progressPeriodLabel,
  type ProgressAlbum,
} from "@noesis/contracts";
import { api } from "../api/client";

/**
 * Фотоотчёты в карточке конструкции: альбомы по месяцам с фотографиями.
 * Операции мгновенные (не в снимке «Сохранить конструкцию»), как у документов:
 * альбом (месяц+год+комментарий) создаётся отдельно, фото грузятся в него
 * пачкой. Пустой альбом на лендинг не попадает.
 */
export function ProjectProgress({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["project-progress", projectId];
  const [error, setError] = useState("");

  const albums = useQuery({
    queryKey: key,
    queryFn: () => api.listProjectProgress(projectId),
  });

  // При ошибке тоже перечитываем список: пакетная загрузка не транзакционна,
  // часть фото могла записаться до сбоя — иначе CRM покажет устаревшее
  // состояние и повторная загрузка даст дубли.
  const onError = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    qc.invalidateQueries({ queryKey: key });
  };
  const ok = () => {
    setError("");
    qc.invalidateQueries({ queryKey: key });
  };

  const removeAlbum = useMutation({
    mutationFn: (id: string) => api.deleteProgressAlbum(projectId, id),
    onSuccess: ok,
    onError,
  });

  const items = albums.data ?? [];

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Фотоотчёты по месяцам — хранятся в карточке конструкции (от новых к
        старым). Изменения применяются сразу; альбом без фото на сайт не попадает.
      </p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {items.map((album) => (
        <AlbumRow
          key={album.id}
          projectId={projectId}
          album={album}
          onChanged={ok}
          onError={onError}
          onDelete={() => {
            const label = progressPeriodLabel(album.year, album.month);
            if (window.confirm(`Удалить альбом «${label}» со всеми фото?`)) {
              removeAlbum.mutate(album.id);
            }
          }}
        />
      ))}
      {items.length === 0 && <p className="empty">Пока нет фотоотчётов.</p>}

      <AddAlbum projectId={projectId} onAdded={ok} onError={onError} />
    </div>
  );
}

function AlbumRow({
  projectId,
  album,
  onChanged,
  onError,
  onDelete,
}: {
  projectId: string;
  album: ProgressAlbum;
  onChanged: () => void;
  onError: (e: unknown) => void;
  onDelete: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  const addPhotos = useMutation({
    mutationFn: (files: File[]) => api.addProgressPhotos(projectId, album.id, files),
    // Сбрасываем input и при ошибке: иначе повторный выбор тех же файлов
    // не вызовет onChange и «+ фото» будет выглядеть сломанным.
    onSettled: () => {
      if (fileInput.current) fileInput.current.value = "";
    },
    onSuccess: onChanged,
    onError,
  });
  const removePhoto = useMutation({
    mutationFn: (photoId: string) =>
      api.deleteProgressPhoto(projectId, album.id, photoId),
    onSuccess: onChanged,
    onError,
  });
  const saveNote = useMutation({
    mutationFn: (note: string) =>
      api.updateProgressAlbum(projectId, album.id, {
        year: album.year,
        month: album.month,
        note: note || undefined,
      }),
    onSuccess: onChanged,
    onError,
  });

  return (
    <div className="divider-top">
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <strong>{progressPeriodLabel(album.year, album.month)}</strong>
        <span className="subtle-sm">
          {album.photos.length} фото
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Удалить альбом" onClick={onDelete}>
          ✕
        </button>
      </div>
      <input
        defaultValue={album.note ?? ""}
        placeholder="Комментарий к этапу (напр. «Смонтированы окна»)"
        maxLength={300}
        onBlur={(e) => {
          const note = e.target.value.trim();
          if (note !== (album.note ?? "")) saveNote.mutate(note);
        }}
        style={{ width: "100%", marginTop: 6 }}
      />
      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        {album.photos.map((photo) => (
          <div key={photo.id} style={{ position: "relative" }}>
            <a href={photo.url} target="_blank" rel="noopener noreferrer">
              <img
                src={photo.renditions?.thumbnailUrl ?? photo.url}
                alt={photo.originalName}
                className="photo-thumb"
              />
            </a>
            <button
              className="icon-btn photo-thumb-remove"
              aria-label="Удалить фото"
              onClick={() => {
                if (window.confirm("Удалить фото безвозвратно?")) {
                  removePhoto.mutate(photo.id);
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <label className="btn-ghost" style={{ alignSelf: "center", cursor: "pointer" }}>
          <input
            ref={fileInput}
            type="file"
            accept={ALLOWED_IMAGE_MIMES.join(",")}
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length > MAX_PROGRESS_PHOTOS_PER_REQUEST) {
                e.target.value = "";
                onError(
                  new Error(
                    `За раз можно загрузить не больше ${MAX_PROGRESS_PHOTOS_PER_REQUEST} фото (выбрано ${files.length}). Разбейте на несколько загрузок.`,
                  ),
                );
                return;
              }
              if (files.length > 0) addPhotos.mutate(files);
            }}
          />
          {addPhotos.isPending ? "Загрузка…" : "+ фото"}
        </label>
      </div>
    </div>
  );
}

function AddAlbum({
  projectId,
  onAdded,
  onError,
}: {
  projectId: string;
  onAdded: () => void;
  onError: (e: unknown) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.createProgressAlbum(projectId, {
        year,
        month,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setNote("");
      onAdded();
    },
    onError,
  });

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() + 1 - i);

  return (
    <div className="divider-top">
      <div className="row wrap" style={{ gap: 8 }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {PROGRESS_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий (необязательно)"
          maxLength={300}
          style={{ minWidth: 220 }}
        />
        <button className="btn-primary" disabled={add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? "Добавление…" : "+ альбом"}
        </button>
      </div>
    </div>
  );
}
