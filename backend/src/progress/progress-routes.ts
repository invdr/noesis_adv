import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  upsertProgressAlbumSchema,
  MAX_PROGRESS_PHOTOS_PER_REQUEST,
  PROGRESS_UPLOAD_MAX_BYTES,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { HttpError } from "../http/errors";
import { parseMultipart } from "../http/multipart";
import {
  addProgressPhotos,
  createProgressAlbum,
  deleteProgressAlbum,
  deleteProgressPhoto,
  listProjectProgress,
  updateProgressAlbum,
} from "./progress-service";


/**
 * Роуты фотоотчётов внутри карточки конструкции. Монтируются на `/api/constructions`
 * (`:constructionId` в путях — как у документов). Управление — manager+admin;
 * операции точечные мгновенные: альбом (период+комментарий) и фото отдельно.
 * Фото — multipart с полями `photo_0`, `photo_1`, …
 */
export function progressRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const photoLimit = bodyLimit({
    maxSize: PROGRESS_UPLOAD_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Файлы слишком большие" } }, 413),
  });

  app.get("/:constructionId/progress", auth, async (c) =>
    c.json(await listProjectProgress(rt, c.req.param("constructionId"))),
  );

  app.post("/:constructionId/progress", auth, async (c) => {
    const input = upsertProgressAlbumSchema.parse(await c.req.json().catch(() => ({})));
    const album = await createProgressAlbum(
      rt,
      c.req.param("constructionId"),
      input,
      c.get("user").id,
    );
    return c.json(album, 201);
  });

  app.patch("/:constructionId/progress/:albumId", auth, async (c) => {
    const input = upsertProgressAlbumSchema.parse(await c.req.json().catch(() => ({})));
    const album = await updateProgressAlbum(
      rt,
      c.req.param("constructionId"),
      c.req.param("albumId"),
      input,
    );
    return c.json(album);
  });

  app.delete("/:constructionId/progress/:albumId", auth, async (c) => {
    await deleteProgressAlbum(rt, c.req.param("constructionId"), c.req.param("albumId"));
    return c.body(null, 204);
  });

  app.post("/:constructionId/progress/:albumId/photos", auth, photoLimit, async (c) => {
    const { files } = await parseMultipart(c);
    if (files.size > MAX_PROGRESS_PHOTOS_PER_REQUEST) {
      throw new HttpError(
        422,
        "too_many_files",
        `Не больше ${MAX_PROGRESS_PHOTOS_PER_REQUEST} фото за один раз (выбрано ${files.size})`,
      );
    }
    const album = await addProgressPhotos(
      rt,
      c.req.param("constructionId"),
      c.req.param("albumId"),
      [...files.values()],
      c.get("user").id,
    );
    return c.json(album, 201);
  });

  app.delete("/:constructionId/progress/:albumId/photos/:photoId", auth, async (c) => {
    await deleteProgressPhoto(
      rt,
      c.req.param("constructionId"),
      c.req.param("albumId"),
      c.req.param("photoId"),
    );
    return c.body(null, 204);
  });

  return app;
}
