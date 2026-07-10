import type {
  CreateDealDocumentInput,
  LeadDetail,
  SessionUser,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import { assertCanEdit, getLeadDetail } from "./lead-service";

/** Заявка существует и доступна пользователю на правку — иначе 404/403. */
async function requireEditableLead(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
): Promise<void> {
  const lead = await rt.prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assigneeId: true },
  });
  if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
  assertCanEdit(user, lead);
}

async function detailOrThrow(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
): Promise<LeadDetail> {
  const detail = await getLeadDetail(rt, user, leadId);
  if (!detail) throw new HttpError(404, "not_found", "Заявка не найдена");
  return detail;
}

/**
 * Прикрепить закрывающий документ к сделке (файл через файловый сервис; при сбое
 * записи чистим — ноль сирот). Появление документа снимает отметку «без
 * документов». Возвращает обновлённую карточку.
 */
export async function addDealDocument(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
  input: CreateDealDocumentInput,
  file: File | undefined,
): Promise<LeadDetail> {
  await requireEditableLead(rt, user, leadId);
  if (!file) throw new HttpError(422, "missing_file", "Не передан файл документа");

  const asset = await storeUpload(
    rt,
    { bytes: await fileBytes(file), originalName: file.name },
    { createdById: user.id },
  );
  // Закрывающие документы — PDF/офис или скан (изображение).
  if (asset.kind !== "document" && asset.kind !== "image") {
    await deleteAsset(rt, asset.id).catch(() => {});
    throw new HttpError(
      422,
      "expected_document",
      "Поддерживаются PDF, офисные файлы и изображения-сканы",
    );
  }

  try {
    const name = input.name?.trim() || stripExtension(file.name);
    await rt.prisma.dealDocument.create({
      data: { leadId, type: input.type, name, assetId: asset.id, createdById: user.id },
    });
    await rt.prisma.lead.update({
      where: { id: leadId },
      data: { dealNoDocuments: false },
    });
  } catch (err) {
    await deleteAsset(rt, asset.id).catch(() => {});
    throw err;
  }
  return detailOrThrow(rt, user, leadId);
}

/** Удалить документ сделки — сразу и навсегда (файл с диска чистит файловый сервис). */
export async function deleteDealDocument(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
  docId: string,
): Promise<LeadDetail> {
  await requireEditableLead(rt, user, leadId);
  const doc = await rt.prisma.dealDocument.findFirst({ where: { id: docId, leadId } });
  if (!doc) throw new HttpError(404, "not_found", "Документ не найден");
  await rt.prisma.dealDocument.delete({ where: { id: docId } });
  await deleteAsset(rt, doc.assetId).catch((e) =>
    console.error(`[deal] не удалён файл ${doc.assetId}:`, e),
  );
  return detailOrThrow(rt, user, leadId);
}

/** Переключить отметку «по сделке документов нет». */
export async function setDealNoDocuments(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
  noDocuments: boolean,
): Promise<LeadDetail> {
  await requireEditableLead(rt, user, leadId);
  await rt.prisma.lead.update({
    where: { id: leadId },
    data: { dealNoDocuments: noDocuments },
  });
  return detailOrThrow(rt, user, leadId);
}

/** Имя файла без расширения — дефолтное название документа. */
function stripExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, "").trim() || base;
}
