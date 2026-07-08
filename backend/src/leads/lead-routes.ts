import { Hono } from "hono";
import {
  assignLeadSchema,
  completeNextContactSchema,
  createLeadSchema,
  createManualLeadSchema,
  createNoteSchema,
  leadAgendaQuerySchema,
  listLeadsQuerySchema,
  setLeadReferrerSchema,
  updateLeadConstructionSchema,
  updateLeadSourceSchema,
  updateLeadStageSchema,
  updateNextContactSchema,
  updateNoteSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { clientIp } from "../http/request";
import { HttpError } from "../http/errors";
import {
  addNote,
  assignLead,
  completeNextContact,
  createLead,
  createManualLead,
  deleteNote,
  exportLeadsCsv,
  getAgenda,
  getLeadDetail,
  getLeadStats,
  listLeads,
  setLeadReferrer,
  updateLeadConstruction,
  updateLeadSource,
  updateLeadStage,
  updateNextContact,
  updateNote,
} from "./lead-service";

/** Роуты заявок. Хендлеры тонкие — логика в lead-service. */
export function leadRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);

  // Публично: создание заявки с лендинга. Honeypot-отсев отдаёт «успех».
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input = createLeadSchema.parse(body);
    const lead = await createLead(rt, input, { ip: clientIp(c) });
    if (!lead) return c.json({ ok: true }, 201);
    return c.json(lead, 201);
  });

  // CRM: ручной приём заявки (оффлайн — пришёл в офис / привёл риелтор).
  app.post("/manual", auth, async (c) => {
    const input = createManualLeadSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await createManualLead(rt, c.get("user"), input);
    return c.json(lead, 201);
  });

  // CRM: список заявок (видимость + фильтры + поиск + пагинация).
  app.get("/", auth, async (c) => {
    const query = listLeadsQuerySchema.parse(c.req.query());
    const result = await listLeads(rt, c.get("user"), query);
    return c.json(result);
  });

  // CRM: аналитика заявок.
  app.get("/stats", auth, async (c) => {
    return c.json(await getLeadStats(rt, c.get("user")));
  });

  // CRM: экспорт заявок в CSV с учётом фильтров и видимости.
  app.get("/export", auth, async (c) => {
    const query = listLeadsQuerySchema.parse(c.req.query());
    const csv = await exportLeadsCsv(rt, c.get("user"), query);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="leads.csv"');
    return c.body(csv);
  });

  // CRM: «Мой день» — повестка активных заявок с датой следующего контакта.
  // Объявлен ДО `/:id`, чтобы статический сегмент не перехватывался параметром.
  app.get("/agenda", auth, async (c) => {
    const query = leadAgendaQuerySchema.parse(c.req.query());
    return c.json(await getAgenda(rt, c.get("user"), query));
  });

  // CRM: редактирование заметки (автор — свою, admin — любую).
  app.patch("/notes/:noteId", auth, async (c) => {
    const input = updateNoteSchema.parse(await c.req.json().catch(() => ({})));
    const note = await updateNote(rt, c.get("user"), c.req.param("noteId"), input);
    return c.json(note);
  });

  // CRM: удаление заметки.
  app.delete("/notes/:noteId", auth, async (c) => {
    await deleteNote(rt, c.get("user"), c.req.param("noteId"));
    return c.body(null, 204);
  });

  // CRM: карточка заявки.
  app.get("/:id", auth, async (c) => {
    const lead = await getLeadDetail(rt, c.get("user"), c.req.param("id"));
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: перевод заявки на другой этап воронки.
  app.patch("/:id/stage", auth, async (c) => {
    const input = updateLeadStageSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await updateLeadStage(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: назначение ответственного / возврат в общую очередь.
  app.patch("/:id/assignee", auth, async (c) => {
    const input = assignLeadSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await assignLead(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: смена источника заявки вручную.
  app.patch("/:id/source", auth, async (c) => {
    const input = updateLeadSourceSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await updateLeadSource(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: смена/снятие конструкции сделки.
  app.patch("/:id/construction", auth, async (c) => {
    const input = updateLeadConstructionSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await updateLeadConstruction(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: назначить/снять реферера (риелтор/агентство).
  app.patch("/:id/referrer", auth, async (c) => {
    const input = setLeadReferrerSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await setLeadReferrer(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: дата следующего контакта.
  app.patch("/:id/next-contact", auth, async (c) => {
    const input = updateNextContactSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await updateNextContact(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });

  // CRM: итог назначенного контакта (состоялся/отменён) + снятие даты.
  app.post("/:id/next-contact/complete", auth, async (c) => {
    const input = completeNextContactSchema.parse(await c.req.json().catch(() => ({})));
    const lead = await completeNextContact(rt, c.get("user"), c.req.param("id"), input);
    if (!lead) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(lead);
  });


  // CRM: добавить заметку.
  app.post("/:id/notes", auth, async (c) => {
    const input = createNoteSchema.parse(await c.req.json().catch(() => ({})));
    const note = await addNote(rt, c.get("user"), c.req.param("id"), input);
    if (!note) throw new HttpError(404, "not_found", "Заявка не найдена");
    return c.json(note, 201);
  });

  return app;
}
