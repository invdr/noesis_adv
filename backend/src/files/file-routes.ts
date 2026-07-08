import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_BYTES } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { HttpError } from "../http/errors";
import { deleteAsset, storeUpload } from "./file-service";

/**
 * Низкоуровневые роуты файлов. Продуктовый поток — загрузка вместе с сохранением
 * карточки ЖК/новости (решение №1, см. docs/files-storage.md); эти роуты —
 * прямая точка доступа к сервису и поверхность для тестов.
 *
 * Права: загрузка — любой авторизованный сотрудник CRM (manager+admin создают
 * контент). Прямое необратимое удаление по id — только admin: это обходная
 * destructive-точка мимо прав на сущность, рядовое удаление файла из карточки
 * идёт через сервис сущности (вызывает `deleteAsset`), а не через этот роут.
 */
export function fileRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Загрузка одного файла (multipart, поле `file`). Тип — по содержимому.
  // Тело ограничено сверху ещё до буферизации в память (защита единственного
  // инстанса VPS от OOM); точный лимит по типу проверяет уже `validateUpload`.
  app.post(
    "/",
    requirePasswordChanged(rt),
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "file_too_large",
              message: "Файл слишком большой",
            },
          },
          413,
        ),
    }),
    async (c) => {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        throw new HttpError(422, "no_file", "Файл не передан");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await storeUpload(
        rt,
        { bytes, originalName: file.name },
        { createdById: c.get("user").id },
      );
      return c.json(asset, 201);
    },
  );

  // Удалить файл (оригинал + производные с диска и запись из БД). Необратимо.
  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteAsset(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
