/**
 * Списки финансов запрашивают максимум страницы контракта (100 записей) и
 * пагинации пока не имеют: всё, что дальше сотой записи, просто не видно.
 * Сводные цифры считает сервер по всему периоду, поэтому расхождение ничем
 * себя не выдаёт — админ видит корректный итог и неполный список. Пока
 * пагинации нет, сообщаем об этом явно.
 */
export function TruncatedNotice({
  shown,
  total,
}: {
  shown: number | undefined;
  total: number | undefined;
}) {
  if (shown == null || total == null || total <= shown) return null;
  return (
    <p className="hint" style={{ marginBottom: "0.75rem" }}>
      Показаны {shown} из {total} записей — сузьте период, чтобы увидеть остальные.
    </p>
  );
}
