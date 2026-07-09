import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createDocumentSchema,
  MAX_UPLOAD_BYTES,
  updateDocumentSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import {
  addDocument,
  deleteDocument,
  listProjectDocuments,
  updateDocument,
} from "./document-service";

/**
 * Роуты документов внутри карточки конструкции. Монтируются на `/api/constructions`,
 * поэтому `:constructionId` задан прямо в путях (не в префиксе mount — так параметр доступен
 * независимо от версии Hono). Управление — manager+admin. Добавление —
 * multipart: `data` (JSON: вид, категория, для ссылки — url/подпись) + для файла
 * — `file`. Правка метаданных и удаление — точечные мгновенные операции.
 */
export function documentRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const limit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Файл слишком большой" } }, 413),
  });

  app.get("/:constructionId/documents", auth, async (c) =>
    c.json(await listProjectDocuments(rt, c.req.param("constructionId"))),
  );

  app.post("/:constructionId/documents", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = createDocumentSchema.parse(data);
    const doc = await addDocument(
      rt,
      c.req.param("constructionId"),
      input,
      files.get("file"),
      c.get("user").id,
    );
    return c.json(doc, 201);
  });

  app.patch("/:constructionId/documents/:id", auth, async (c) => {
    const input = updateDocumentSchema.parse(await c.req.json());
    const doc = await updateDocument(
      rt,
      c.req.param("constructionId"),
      c.req.param("id"),
      input,
    );
    return c.json(doc);
  });

  app.delete("/:constructionId/documents/:id", auth, async (c) => {
    await deleteDocument(rt, c.req.param("constructionId"), c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
