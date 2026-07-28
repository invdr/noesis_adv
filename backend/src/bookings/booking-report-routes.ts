import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  BOOKING_REPORT_UPLOAD_MAX_BYTES,
  MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST,
  upsertBookingReportSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { HttpError } from "../http/errors";
import { parseMultipart } from "../http/multipart";
import { readAssetBytes } from "../files/file-service";
import {
  addBookingReportPhotos,
  createBookingReport,
  deleteBookingReport,
  deleteBookingReportPhoto,
  getBookingReportPhotoAsset,
  listBookingReports,
  updateBookingReport,
} from "./booking-report-service";

/** Closed monthly placement reports for a booking. */
export function bookingReportRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const photoLimit = bodyLimit({
    maxSize: BOOKING_REPORT_UPLOAD_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Файлы слишком большие" } }, 413),
  });

  app.get("/:id/reports", auth, async (c) =>
    c.json(await listBookingReports(rt, c.req.param("id"))),
  );

  app.post("/:id/reports", auth, async (c) => {
    const input = upsertBookingReportSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createBookingReport(rt, c.get("user"), c.req.param("id"), input), 201);
  });

  app.patch("/:id/reports/:reportId", auth, async (c) => {
    const input = upsertBookingReportSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateBookingReport(rt, c.req.param("id"), c.req.param("reportId"), input));
  });

  app.delete("/:id/reports/:reportId", auth, async (c) => {
    await deleteBookingReport(rt, c.req.param("id"), c.req.param("reportId"));
    return c.body(null, 204);
  });

  app.post("/:id/reports/:reportId/photos", auth, photoLimit, async (c) => {
    const { files } = await parseMultipart(c);
    if (files.size > MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST) {
      throw new HttpError(
        422,
        "too_many_files",
        `Не больше ${MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST} фотографий за один раз`,
      );
    }
    return c.json(
      await addBookingReportPhotos(
        rt,
        c.get("user"),
        c.req.param("id"),
        c.req.param("reportId"),
        [...files.values()],
      ),
      201,
    );
  });

  app.get("/:id/reports/:reportId/photos/:photoId/download", auth, async (c) => {
    const asset = await getBookingReportPhotoAsset(
      rt,
      c.req.param("id"),
      c.req.param("reportId"),
      c.req.param("photoId"),
    );
    c.header("Content-Type", asset.mimeType);
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(await readAssetBytes(rt, asset));
  });

  app.delete("/:id/reports/:reportId/photos/:photoId", auth, async (c) => {
    await deleteBookingReportPhoto(
      rt,
      c.req.param("id"),
      c.req.param("reportId"),
      c.req.param("photoId"),
    );
    return c.body(null, 204);
  });

  return app;
}
