import type {
  DocumentCategory,
  ReorderDocumentCategoriesInput,
  UpsertDocumentCategoryInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { toDocumentCategoryDto } from "./document-dto";

/** Список категорий по порядку. По умолчанию — только живые (неархивные). */
export async function listDocumentCategories(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<DocumentCategory[]> {
  const rows = await rt.prisma.documentCategory.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDocumentCategoryDto);
}

/** Создать категорию (admin). slug — из имени, порядок — в конец. */
export async function createDocumentCategory(
  rt: Runtime,
  input: UpsertDocumentCategoryInput,
): Promise<DocumentCategory> {
  const slug = await uniqueSlug(
    input.name,
    async (s) => (await rt.prisma.documentCategory.count({ where: { slug: s } })) > 0,
    "category",
  );
  const last = await rt.prisma.documentCategory.findFirst({
    orderBy: { order: "desc" },
  });
  const cat = await rt.prisma.documentCategory.create({
    data: { name: input.name, slug, order: (last?.order ?? 0) + 1 },
  });
  return toDocumentCategoryDto(cat);
}

/** Переименовать категорию (admin). slug заморожен — меняется только имя. */
export async function updateDocumentCategory(
  rt: Runtime,
  id: string,
  input: UpsertDocumentCategoryInput,
): Promise<DocumentCategory> {
  await requireCategory(rt, id);
  const cat = await rt.prisma.documentCategory.update({
    where: { id },
    data: { name: input.name },
  });
  return toDocumentCategoryDto(cat);
}

/** Новый порядок категорий (admin) — задаёт порядок плиток на главной. */
export async function reorderDocumentCategories(
  rt: Runtime,
  input: ReorderDocumentCategoriesInput,
): Promise<DocumentCategory[]> {
  await rt.prisma.$transaction(
    input.ids.map((id, i) =>
      rt.prisma.documentCategory.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listDocumentCategories(rt, { includeArchived: true });
}

/** Архивировать категорию (скрыть из выбора и с главной; документы целы). */
export async function archiveDocumentCategory(
  rt: Runtime,
  id: string,
): Promise<DocumentCategory> {
  await requireCategory(rt, id);
  const cat = await rt.prisma.documentCategory.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toDocumentCategoryDto(cat);
}

/** Восстановить категорию из архива. */
export async function restoreDocumentCategory(
  rt: Runtime,
  id: string,
): Promise<DocumentCategory> {
  await requireCategory(rt, id);
  const cat = await rt.prisma.documentCategory.update({
    where: { id },
    data: { archivedAt: null },
  });
  return toDocumentCategoryDto(cat);
}

/**
 * Удалить категорию навсегда (admin). Запрещено, если в ней есть документы
 * (включая ЖК в архиве) — иначе осиротим их; для таких — архив.
 */
export async function deleteDocumentCategory(rt: Runtime, id: string): Promise<void> {
  await requireCategory(rt, id);
  const used = await rt.prisma.document.count({ where: { categoryId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "category_in_use",
      `В категории есть документы (${used}). Сначала перенесите их или используйте архив.`,
    );
  }
  await rt.prisma.documentCategory.delete({ where: { id } });
}

// --- внутреннее ---

async function requireCategory(rt: Runtime, id: string) {
  const cat = await rt.prisma.documentCategory.findUnique({ where: { id } });
  if (!cat) throw new HttpError(404, "not_found", "Категория не найдена");
  return cat;
}
