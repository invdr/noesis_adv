import { useEffect, useRef, useState } from "react";
import { loadYandexMaps } from "../shared/yandexMaps";

const MAPS_KEY = (import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined) ?? "";
const GROZNY: [number, number] = [43.318, 45.698];

function parseCoord(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** До 6 знаков — субметровая точность, без хвоста float. */
function fmt(coord: number): string {
  return String(Math.round(coord * 1e6) / 1e6);
}

/**
 * Пикер координат конструкции на Яндекс-карте: клик по карте или перетаскивание
 * маркера ставит точку, поиск по адресу центрирует и ставит маркер. Значения
 * синхронизированы с ручными полями широты/долготы (правка полей двигает маркер,
 * маркер обновляет поля). Если ключ карт не задан — компонент не рендерится,
 * остаётся ручной ввод.
 */
export function CoordinatePicker({
  lat,
  lng,
  onChange,
}: {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const setMarkerRef = useRef<((coords: [number, number]) => void) | null>(null);
  const removeMarkerRef = useRef<(() => void) | null>(null);
  const geocodeRef = useRef<((q: string) => Promise<void>) | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");
  const [searchMsg, setSearchMsg] = useState("");

  // Инициализация карты — один раз. Ввод в поля карту не пересоздаёт.
  useEffect(() => {
    if (!MAPS_KEY || !elRef.current) return;
    let disposed = false;
    let map: any = null;

    loadYandexMaps(MAPS_KEY)
      .then((ymaps) => {
        ymaps.ready(() => {
          if (disposed || !elRef.current) return;
          const la = parseCoord(lat);
          const ln = parseCoord(lng);
          const hasPoint = la != null && ln != null;
          map = new ymaps.Map(
            elRef.current,
            {
              center: hasPoint ? [la!, ln!] : GROZNY,
              zoom: hasPoint ? 16 : 12,
              controls: ["zoomControl", "fullscreenControl"],
            },
            { suppressMapOpenBlock: true },
          );
          mapRef.current = map;

          let marker: any = null;
          const emit = (coords: [number, number]) =>
            onChangeRef.current(fmt(coords[0]), fmt(coords[1]));
          const setMarker = (coords: [number, number]) => {
            if (marker) {
              marker.geometry.setCoordinates(coords);
            } else {
              marker = new ymaps.Placemark(coords, {}, {
                draggable: true,
                preset: "islands#redDotIcon",
              });
              marker.events.add("dragend", () =>
                emit(marker.geometry.getCoordinates()),
              );
              map.geoObjects.add(marker);
            }
          };
          setMarkerRef.current = setMarker;
          removeMarkerRef.current = () => {
            if (marker) {
              map.geoObjects.remove(marker);
              marker = null;
            }
          };
          geocodeRef.current = async (q: string) => {
            const res = await ymaps.geocode(q, { results: 1, boundedBy: map.getBounds() });
            const first = res.geoObjects.get(0);
            if (!first) {
              setSearchMsg("Адрес не найден");
              return;
            }
            const coords = first.geometry.getCoordinates() as [number, number];
            setMarker(coords);
            map.setCenter(coords, 16);
            emit(coords);
            setSearchMsg("");
          };

          if (hasPoint) setMarker([la!, ln!]);
          map.events.add("click", (e: any) => {
            const coords = e.get("coords") as [number, number];
            setMarker(coords);
            emit(coords);
          });
          setStatus("ready");
        });
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
      setMarkerRef.current = null;
      removeMarkerRef.current = null;
      geocodeRef.current = null;
      mapRef.current = null;
      if (map) map.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синхронизация маркера при правке полей широты/долготы вручную (или очистке пары).
  useEffect(() => {
    if (status !== "ready") return;
    const la = parseCoord(lat);
    const ln = parseCoord(lng);
    if (la == null || ln == null) {
      removeMarkerRef.current?.();
    } else {
      setMarkerRef.current?.([la, ln]);
    }
  }, [lat, lng, status]);

  if (!MAPS_KEY) return null;

  const runSearch = () => {
    const q = search.trim();
    if (!q) return;
    setSearchMsg("");
    geocodeRef.current?.(q).catch(() => setSearchMsg("Не удалось выполнить поиск"));
  };

  return (
    <div className="coordinate-picker">
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder="Найти по адресу (напр. Грозный, проспект Путина 1)"
          style={{ flex: "1 1 260px", minWidth: 0 }}
          disabled={status !== "ready"}
        />
        <button type="button" className="btn btn-ghost" onClick={runSearch} disabled={status !== "ready"}>
          Найти
        </button>
      </div>
      {searchMsg && <p className="hint" style={{ marginTop: 0 }}>{searchMsg}</p>}
      <div
        ref={elRef}
        style={{ width: "100%", height: 320, borderRadius: 10, overflow: "hidden", background: "#f1f5f9" }}
      />
      {status === "loading" && <p className="hint">Карта загружается…</p>}
      {status === "error" && (
        <p className="hint">Не удалось загрузить карту — используйте ручной ввод координат.</p>
      )}
      {status === "ready" && (
        <p className="hint" style={{ marginTop: 6 }}>
          Кликните по карте или перетащите маркер, чтобы поставить точку.
        </p>
      )}
    </div>
  );
}
