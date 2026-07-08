import { Prisma } from "@prisma/client";
import {
  type CreateDocumentInput,
  type Document,
  type DocumentCategoryProjects,
  type DocumentGroup,
  type UpdateDocumentInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import { toAssetDto } from "../files/file-dto";
import {
  documentInclude,
  toDocumentCategoryDto,
  toDocumentDto,
  type DocumentRow,
} from "./document-dto";

/** Порядок документов: по категории, затем позиция, затем время добавления. */
const documentOrderBy: Prisma.DocumentOrderByWithRelationInput[] = [
  { category: { order: "asc" } },
  { position: "asc" },
  { createdAt: "asc" },
];

/** Документы одного ЖК для CRM (все категории, включая архивные). */
export async function listProjectDocuments(
  rt: Runtime,
  projectId: string,
): Promise<Document[]> {
  await requireProject(rt, projectId);
  const rows = await rt.prisma.document.findMany({
    where: { projectId },
    include: documentInclude,
    orderBy: documentOrderBy,
  });
  return rows.map((d) => dto(rt, d));
}

/**
 * Добавить документ в ЖК (отдельная мгновенная операция, не в снимке «Сохранить
 * ЖК»). Для `file` грузим файл через файловый сервис; при сбое записи —
 * подчищаем (ноль сирот). Для `link` — только запись.
 */
export async function addDocument(
  rt: Runtime,
  projectId: string,
  input: CreateDocumentInput,
  file: File | undefined,
  userId: string,
): Promise<Document> {
  await requireProject(rt, projectId);
  await requireLiveCategory(rt, input.categoryId);
  const position = await nextPosition(rt, projectId, input.categoryId);

  if (input.kind === "link") {
    const doc = await rt.prisma.document.create({
      data: {
        projectId,
        categoryId: input.categoryId,
        name: input.name,
        kind: "link",
        url: input.url,
        caption: input.caption ?? null,
        position,
        createdById: userId,
      },
      include: documentInclude,
    });
    return dto(rt, doc);
  }

  if (!file) throw new HttpError(422, "missing_file", "Не передан файл документа");
  const asset = await storeUpload(
    rt,
    { bytes: await fileBytes(file), originalName: file.name },
    { createdById: userId },
  );
  if (asset.kind !== "document") {
    await deleteAsset(rt, asset.id).catch(() => {});
    throw new HttpError(
      422,
      "expected_document",
      "В документы можно загружать только PDF и офисные файлы",
    );
  }
  try {
    const name = input.name?.trim() || stripExtension(file.name);
    const doc = await rt.prisma.document.create({
      data: {
        projectId,
        categoryId: input.categoryId,
        name,
        kind: "file",
        assetId: asset.id,
        position,
        createdById: userId,
      },
      include: documentInclude,
    });
    return dto(rt, doc);
  } catch (err) {
    await deleteAsset(rt, asset.id).catch(() => {});
    throw err;
  }
}

/** Правка метаданных документа (название, категория; для ссылки — url/подпись). */
export async function updateDocument(
  rt: Runtime,
  projectId: string,
  id: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const doc = await rt.prisma.document.findFirst({
    where: { id, projectId },
    include: documentInclude,
  });
  if (!doc) throw new HttpError(404, "not_found", "Документ не найден");
  if (input.categoryId) await requireLiveCategory(rt, input.categoryId);

  const data: Prisma.DocumentUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.categoryId !== undefined) {
    data.category = { connect: { id: input.categoryId } };
  }
  // url/подпись применимы только к ссылке.
  if (doc.kind === "link") {
    if (input.url !== undefined) data.url = input.url;
    if (input.caption !== undefined) data.caption = input.caption;
  }

  const updated = await rt.prisma.document.update({
    where: { id },
    data,
    include: documentInclude,
  });
  return dto(rt, updated);
}

/** Удалить документ из ЖК — сразу и навсегда (файл с диска чистит файловый сервис). */
export async function deleteDocument(
  rt: Runtime,
  projectId: string,
  id: string,
): Promise<void> {
  const doc = await rt.prisma.document.findFirst({ where: { id, projectId } });
  if (!doc) throw new HttpError(404, "not_found", "Документ не найден");
  await rt.prisma.document.delete({ where: { id } });
  if (doc.kind === "file" && doc.assetId) {
    await deleteAsset(rt, doc.assetId).catch((e) =>
      console.error(`[documents] не удалён файл ${doc.assetId}:`, e),
    );
  }
}

/**
 * Документы опубликованного ЖК по slug, сгруппированные по живым категориям (в
 * порядке справочника). «Скоро» и архив страницы не имеют → null (вызывающий
 * отдаёт 404). Пустые категории не попадают.
 */
export async function listPublicProjectDocuments(
  rt: Runtime,
  slug: string,
): Promise<DocumentGroup[] | null> {
  const project = await rt.prisma.project.findFirst({
    where: { slug, status: "published", comingSoon: false, archivedAt: null },
    select: { id: true },
  });
  if (!project) return null;

  const rows = await rt.prisma.document.findMany({
    where: { projectId: project.id, category: { archivedAt: null } },
    include: documentInclude,
    orderBy: documentOrderBy,
  });

  const groups = new Map<string, DocumentGroup>();
  for (const row of rows) {
    if (!row.category) continue;
    const key = row.category.id;
    if (!groups.has(key)) {
      groups.set(key, { category: toDocumentCategoryDto(row.category), documents: [] });
    }
    groups.get(key)!.documents.push(dto(rt, row));
  }
  return [...groups.values()];
}

/**
 * Карта «категория → ЖК» для блока документов на главной: живые категории по
 * порядку, в каждой — опубликованные ЖК (без «скоро»), у которых есть документы
 * этой категории. Пустые категории пропускаются.
 */
export async function listPublicDocumentCategories(
  rt: Runtime,
): Promise<DocumentCategoryProjects[]> {
  const cfg = { publicBase: rt.env.FILES_PUBLIC_BASE };
  const categories = await rt.prisma.documentCategory.findMany({
    where: { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  const result: DocumentCategoryProjects[] = [];
  for (const cat of categories) {
    const projects = await rt.prisma.project.findMany({
      where: {
        status: "published",
        comingSoon: false,
        archivedAt: null,
        documents: { some: { categoryId: cat.id } },
      },
      include: { cover: true },
      orderBy: { createdAt: "asc" },
    });
    if (projects.length === 0) continue; // пустые категории не показываем

    result.push({
      category: toDocumentCategoryDto(cat),
      projects: projects.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        address: p.address,
        cover: p.cover ? toAssetDto(p.cover, cfg) : undefined,
      })),
    });
  }
  return result;
}

// --- внутреннее ---

function dto(rt: Runtime, doc: DocumentRow): Document {
  return toDocumentDto(doc, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

async function requireProject(rt: Runtime, id: string): Promise<void> {
  const exists = await rt.prisma.project.count({ where: { id } });
  if (!exists) throw new HttpError(404, "not_found", "ЖК не найден");
}

/** Категория должна существовать и быть живой — в архивную добавлять нельзя. */
async function requireLiveCategory(rt: Runtime, id: string): Promise<void> {
  const cat = await rt.prisma.documentCategory.findUnique({ where: { id } });
  if (!cat) throw new HttpError(422, "invalid_category", "Категория не найдена");
  if (cat.archivedAt) {
    throw new HttpError(422, "category_archived", "Категория в архиве — выберите другую");
  }
}

/** Следующая позиция документа внутри категории конкретного ЖК. */
async function nextPosition(
  rt: Runtime,
  projectId: string,
  categoryId: string,
): Promise<number> {
  const last = await rt.prisma.document.findFirst({
    where: { projectId, categoryId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

/** Имя файла без расширения — дефолтное название документа-файла. */
function stripExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, "").trim() || base;
}
