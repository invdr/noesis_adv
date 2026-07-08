import type {
  NewsLabel,
  ReorderNewsLabelsInput,
  UpsertNewsLabelInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { toNewsLabelDto } from "./news-dto";

/** Список меток по порядку. По умолчанию — только живые (неархивные). */
export async function listNewsLabels(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<NewsLabel[]> {
  const rows = await rt.prisma.newsLabel.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toNewsLabelDto);
}

/** Создать метку (admin). slug — из имени, порядок — в конец. */
export async function createNewsLabel(
  rt: Runtime,
  input: UpsertNewsLabelInput,
): Promise<NewsLabel> {
  const slug = await uniqueSlug(
    input.name,
    async (s) => (await rt.prisma.newsLabel.count({ where: { slug: s } })) > 0,
    "label",
  );
  const last = await rt.prisma.newsLabel.findFirst({ orderBy: { order: "desc" } });
  const label = await rt.prisma.newsLabel.create({
    data: { name: input.name, slug, order: (last?.order ?? 0) + 1 },
  });
  return toNewsLabelDto(label);
}

/** Переименовать метку (admin). slug заморожен — меняется только имя. */
export async function updateNewsLabel(
  rt: Runtime,
  id: string,
  input: UpsertNewsLabelInput,
): Promise<NewsLabel> {
  await requireLabel(rt, id);
  const label = await rt.prisma.newsLabel.update({
    where: { id },
    data: { name: input.name },
  });
  return toNewsLabelDto(label);
}

/** Новый порядок меток (admin) — переданные id получают порядок по позиции. */
export async function reorderNewsLabels(
  rt: Runtime,
  input: ReorderNewsLabelsInput,
): Promise<NewsLabel[]> {
  await rt.prisma.$transaction(
    input.ids.map((id, i) =>
      rt.prisma.newsLabel.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listNewsLabels(rt, { includeArchived: true });
}

/** Архивировать метку (скрыть из выбора; новости с ней сохраняются). */
export async function archiveNewsLabel(rt: Runtime, id: string): Promise<NewsLabel> {
  await requireLabel(rt, id);
  const label = await rt.prisma.newsLabel.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toNewsLabelDto(label);
}

/** Восстановить метку из архива. */
export async function restoreNewsLabel(rt: Runtime, id: string): Promise<NewsLabel> {
  await requireLabel(rt, id);
  const label = await rt.prisma.newsLabel.update({
    where: { id },
    data: { archivedAt: null },
  });
  return toNewsLabelDto(label);
}

/**
 * Удалить метку навсегда (admin). Запрещено, если ею помечена хотя бы одна
 * новость (включая архивные/черновики) — иначе осиротим их; для таких — архив.
 */
export async function deleteNewsLabel(rt: Runtime, id: string): Promise<void> {
  await requireLabel(rt, id);
  const used = await rt.prisma.news.count({ where: { labelId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "label_in_use",
      `Метку используют новости (${used}). Сначала смените метку у них или используйте архив.`,
    );
  }
  await rt.prisma.newsLabel.delete({ where: { id } });
}

// --- внутреннее ---

async function requireLabel(rt: Runtime, id: string) {
  const label = await rt.prisma.newsLabel.findUnique({ where: { id } });
  if (!label) throw new HttpError(404, "not_found", "Метка не найдена");
  return label;
}
