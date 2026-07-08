import type { Developer, UpsertDeveloperInput } from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import { toDeveloperDto } from "./developer-dto";

/** include логотипа для DTO. */
const withLogo = { logo: true };

function nullableText(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null;
}

function developerDetailsData(input: UpsertDeveloperInput) {
  return {
    legalName: nullableText(input.legalName),
    inn: nullableText(input.inn),
    kpp: nullableText(input.kpp),
    ogrn: nullableText(input.ogrn),
    legalAddress: nullableText(input.legalAddress),
    postalAddress: nullableText(input.postalAddress),
    bankName: nullableText(input.bankName),
    bankBik: nullableText(input.bankBik),
    bankAccount: nullableText(input.bankAccount),
    correspondentAccount: nullableText(input.correspondentAccount),
    directorTitle: nullableText(input.directorTitle),
    directorFullName: nullableText(input.directorFullName),
    directorBasis: nullableText(input.directorBasis),
  };
}

/** Список застройщиков по порядку. По умолчанию — только живые (неархивные). */
export async function listDevelopers(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<Developer[]> {
  const rows = await rt.prisma.developer.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: withLogo,
  });
  return rows.map((d) => toDeveloperDto(d, { publicBase: rt.env.FILES_PUBLIC_BASE }));
}

/** Создать застройщика (admin). Логотип — необязательный файл `logo`. */
export async function createDeveloper(
  rt: Runtime,
  input: UpsertDeveloperInput,
  logo: File | undefined,
  userId: string,
): Promise<Developer> {
  const slug = await uniqueSlug(
    input.name,
    async (s) => (await rt.prisma.developer.count({ where: { slug: s } })) > 0,
    "developer",
  );
  const logoId = logo ? await uploadImage(rt, logo, userId) : null;
  try {
    const last = await rt.prisma.developer.findFirst({
      orderBy: { order: "desc" },
    });
    const dev = await rt.prisma.developer.create({
      data: {
        name: input.name,
        slug,
        logoId,
        order: (last?.order ?? 0) + 1,
        ...developerDetailsData(input),
      },
      include: withLogo,
    });
    return toDeveloperDto(dev, { publicBase: rt.env.FILES_PUBLIC_BASE });
  } catch (err) {
    if (logoId) await deleteAsset(rt, logoId).catch(() => {});
    throw err;
  }
}

/** Обновить застройщика (admin): имя и/или логотип (заменить/снять). */
export async function updateDeveloper(
  rt: Runtime,
  id: string,
  input: UpsertDeveloperInput,
  logo: File | undefined,
  userId: string,
): Promise<Developer> {
  const current = await requireDeveloper(rt, id);

  // Новый логотип грузим до записи; старый удаляем только после успеха.
  const newLogoId = logo ? await uploadImage(rt, logo, userId) : null;
  const shouldClearLogo = input.removeLogo === true || newLogoId !== null;
  try {
    const dev = await rt.prisma.developer.update({
      where: { id },
      data: {
        name: input.name,
        logoId: newLogoId ?? (input.removeLogo ? null : undefined),
        ...developerDetailsData(input),
      },
      include: withLogo,
    });
    // Старый логотип больше не нужен — стираем его файлы.
    if (shouldClearLogo && current.logoId) {
      await deleteAsset(rt, current.logoId).catch(() => {});
    }
    return toDeveloperDto(dev, { publicBase: rt.env.FILES_PUBLIC_BASE });
  } catch (err) {
    if (newLogoId) await deleteAsset(rt, newLogoId).catch(() => {});
    throw err;
  }
}

/** Архивировать застройщика (скрыть из выбора; ссылки из ЖК сохраняются). */
export async function archiveDeveloper(rt: Runtime, id: string): Promise<Developer> {
  await requireDeveloper(rt, id);
  const dev = await rt.prisma.developer.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: withLogo,
  });
  return toDeveloperDto(dev, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

/** Восстановить застройщика из архива. */
export async function restoreDeveloper(rt: Runtime, id: string): Promise<Developer> {
  await requireDeveloper(rt, id);
  const dev = await rt.prisma.developer.update({
    where: { id },
    data: { archivedAt: null },
    include: withLogo,
  });
  return toDeveloperDto(dev, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

/**
 * Удалить застройщика навсегда (admin). Запрещено, если на него ссылается хотя
 * бы один ЖК (включая архивные) — иначе осиротим карточки; для таких — архив.
 */
export async function deleteDeveloper(rt: Runtime, id: string): Promise<void> {
  const dev = await requireDeveloper(rt, id);
  const used = await rt.prisma.project.count({ where: { developerId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "developer_in_use",
      `На застройщика ссылаются ЖК (${used}). Сначала перепривяжите их или используйте архив.`,
    );
  }
  await rt.prisma.developer.delete({ where: { id } });
  if (dev.logoId) await deleteAsset(rt, dev.logoId).catch(() => {});
}

// --- внутреннее ---

async function requireDeveloper(rt: Runtime, id: string) {
  const dev = await rt.prisma.developer.findUnique({ where: { id } });
  if (!dev) throw new HttpError(404, "not_found", "Застройщик не найден");
  return dev;
}

/** Загрузить картинку через сервис файлов; документ как логотип не принимаем. */
async function uploadImage(rt: Runtime, file: File, userId: string): Promise<string> {
  const asset = await storeUpload(
    rt,
    { bytes: await fileBytes(file), originalName: file.name },
    { createdById: userId },
  );
  if (asset.kind !== "image") {
    await deleteAsset(rt, asset.id).catch(() => {});
    throw new HttpError(422, "expected_image", "Логотип должен быть изображением");
  }
  return asset.id;
}
