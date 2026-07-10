import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createDealDocumentSchema,
  MAX_UPLOAD_BYTES,
  updateDealSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import {
  addDealDocument,
  deleteDealDocument,
  setDealNoDocuments,
} from "./deal-service";

/**
 * Роуты вкладки «Сделка» на заявке (Этап 4). Монтируются на `/api/leads`, поэтому
 * `:id` задан прямо в путях. Прикрепление документа — multipart (`data` JSON:
 * тип/название + файл `file`). Все ручки возвращают обновлённую карточку заявки.
 */
export function dealRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const limit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Файл слишком большой" } }, 413),
  });

  app.post("/:id/documents", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = createDealDocumentSchema.parse(data);
    const detail = await addDealDocument(
      rt,
      c.get("user"),
      c.req.param("id"),
      input,
      files.get("file"),
    );
    return c.json(detail, 201);
  });

  app.delete("/:id/documents/:docId", auth, async (c) => {
    const detail = await deleteDealDocument(
      rt,
      c.get("user"),
      c.req.param("id"),
      c.req.param("docId"),
    );
    return c.json(detail);
  });

  app.patch("/:id/deal", auth, async (c) => {
    const input = updateDealSchema.parse(await c.req.json().catch(() => ({})));
    const detail = await setDealNoDocuments(
      rt,
      c.get("user"),
      c.req.param("id"),
      input.noDocuments,
    );
    return c.json(detail);
  });

  return app;
}
