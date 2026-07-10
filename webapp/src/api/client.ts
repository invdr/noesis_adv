import type {
  AdminUser,
  AnalyticsResponse,
  ArchiveStageInput,
  AssignLeadInput,
  Booking,
  BookingBrand,
  BookingRemindersResponse,
  BookingServiceReason,
  ChangePasswordRequest,
  Contact,
  ContactDetail,
  CompleteNextContactInput,
  ContactType,
  InventoryAnalyticsQuery,
  InventoryAnalyticsResponse,
  ListContactsQuery,
  UpsertContactInput,
  SetLeadReferrerInput,
  PartnerAnalyticsResponse,
  PartnerAnalyticsQuery,
  CreatedUserResponse,
  CreateUserInput,
  CreateDocumentInput,
  CreateDealDocumentInput,
  CreateManualLeadInput,
  UpsertContactTypeInput,
  UpsertBookingBrandInput,
  UpsertBookingInput,
  UpsertBookingServiceReasonInput,
  ResetPasswordResponse,
  UpdateUserInput,
  CreateFunnelInput,
  CreateNoteInput,
  CreateStageInput,
  Developer,
  Funnel,
  Document,
  DocumentCategory,
  Lead,
  LeadAgendaResponse,
  LeadSourceOption,
  UpsertLeadSourceInput,
  LeadDetail,
  LeadNote,
  LoginRequest,
  News,
  NewsLabel,
  ProgressAlbum,
  Construction,
  SessionUser,
  SiteBuildStatus,
  SiteSettingsOverrides,
  Stage,
  UpdateSiteSettingsInput,
  UpdateDocumentInput,
  UpdateFunnelInput,
  UpdateLeadSourceInput,
  UpdateLeadConstructionInput,
  UpdateLeadStageInput,
  UpdateNextContactInput,
  UpdateNoteInput,
  UpdateStageInput,
  UpsertDeveloperInput,
  UpsertDocumentCategoryInput,
  UpsertNewsInput,
  UpsertProgressAlbumInput,
  UpsertNewsLabelInput,
  UpsertConstructionInput,
} from "@noesis/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** HTTP-ошибка с кодом ответа — чтобы фронт отличал 401 от прочих. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Машинный код из тела ошибки (например, `confirm_terminal`). */
    public code?: string,
    /** Ошибки полей формы: { field: "сообщение" }. */
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Бросает ApiError из неуспешного ответа (с кодом и ошибками полей). */
async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `Ошибка запроса (${res.status})`;
  // Ответ не от бэкенда (nginx и т. п.) — тело не JSON; самый частый случай —
  // 413 при слишком большой загрузке. Даём человеку понятное сообщение.
  if (res.status === 413) {
    message = "Файлы слишком большие — сервер отклонил загрузку (413)";
  }
  let code: string | undefined;
  let fields: Record<string, string> | undefined;
  try {
    const data = await res.json();
    if (data?.error?.message) message = data.error.message;
    if (data?.error?.code) code = data.error.code;
    if (data?.error?.fields) fields = data.error.fields;
  } catch {
    /* не-JSON тело (страница ошибки прокси) — оставляем общее сообщение */
  }
  throw new ApiError(res.status, message, code, fields);
}

/** Централизованный клиент: базовый URL, cookie-сессия, разбор ошибок. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Сессия в httpOnly-cookie — шлём её на каждый запрос.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  await ensureOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart-запрос (данные + файлы). Content-Type выставляет браузер сам. */
async function requestMultipart<T>(
  path: string,
  method: string,
  form: FormData,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    body: form,
  });
  await ensureOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** FormData сохранения конструкции: JSON-данные + новые фото `image_0`, `image_1`, … */
function projectForm(data: UpsertConstructionInput, files: File[]): FormData {
  const form = new FormData();
  form.append("data", JSON.stringify(data));
  files.forEach((file, i) => form.append(`image_${i}`, file));
  return form;
}

export interface PaginatedLeads {
  items: Lead[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LeadStats {
  total: number;
  byStage: Record<string, number>;
  bySource: Record<string, number>;
}

export interface PaginatedProjects {
  items: Construction[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginatedBookings {
  items: Booking[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BookingListParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  status?: string;
  kind?: string;
  constructionId?: string;
  constructionSideId?: string;
  search?: string;
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  includeArchived?: boolean;
}

export interface PaginatedNews {
  items: News[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NewsListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  labelId?: string;
  search?: string;
  includeArchived?: boolean;
}

export const api = {
  // --- Аутентификация ---
  login(input: LoginRequest) {
    return request<SessionUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  me() {
    return request<SessionUser>("/api/auth/me");
  },
  changePassword(input: ChangePasswordRequest) {
    return request<SessionUser>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // --- Пользователи (admin) ---
  listUsers() {
    return request<AdminUser[]>("/api/users");
  },
  createUser(input: CreateUserInput) {
    return request<CreatedUserResponse>("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateUser(id: string, input: UpdateUserInput) {
    return request<AdminUser>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  blockUser(id: string) {
    return request<AdminUser>(`/api/users/${id}/block`, { method: "POST" });
  },
  unblockUser(id: string) {
    return request<AdminUser>(`/api/users/${id}/unblock`, { method: "POST" });
  },
  resetUserPassword(id: string) {
    return request<ResetPasswordResponse>(`/api/users/${id}/reset-password`, {
      method: "POST",
    });
  },

  // --- Аналитика заявок (admin) ---
  getAnalytics(params: { from?: string; to?: string; source?: string } = {}) {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.source) q.set("source", params.source);
    const qs = q.toString();
    return request<AnalyticsResponse>(`/api/analytics${qs ? `?${qs}` : ""}`);
  },

  // --- Типы контакта (справочник) ---
  listContactTypes(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<ContactType[]>(`/api/contact-types${qs}`);
  },
  createContactType(input: UpsertContactTypeInput) {
    return request<ContactType>("/api/contact-types", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateContactType(id: string, input: UpsertContactTypeInput) {
    return request<ContactType>(`/api/contact-types/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderContactTypes(ids: string[]) {
    return request<ContactType[]>("/api/contact-types/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveContactType(id: string) {
    return request<ContactType>(`/api/contact-types/${id}/archive`, { method: "POST" });
  },
  restoreContactType(id: string) {
    return request<ContactType>(`/api/contact-types/${id}/restore`, { method: "POST" });
  },
  deleteContactType(id: string) {
    return request<void>(`/api/contact-types/${id}`, { method: "DELETE" });
  },

  // --- Источники заявок (справочник) ---
  listSources(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<LeadSourceOption[]>(`/api/sources${qs}`);
  },
  createSource(input: UpsertLeadSourceInput) {
    return request<LeadSourceOption>("/api/sources", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateSource(id: string, input: UpsertLeadSourceInput) {
    return request<LeadSourceOption>(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderSources(ids: string[]) {
    return request<LeadSourceOption[]>("/api/sources/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveSource(id: string) {
    return request<LeadSourceOption>(`/api/sources/${id}/archive`, { method: "POST" });
  },
  restoreSource(id: string) {
    return request<LeadSourceOption>(`/api/sources/${id}/restore`, { method: "POST" });
  },
  deleteSource(id: string) {
    return request<void>(`/api/sources/${id}`, { method: "DELETE" });
  },

  // --- Воронки ---
  listFunnels() {
    return request<Funnel[]>("/api/funnels");
  },
  createFunnel(input: CreateFunnelInput) {
    return request<Funnel>("/api/funnels", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateFunnel(id: string, input: UpdateFunnelInput) {
    return request<Funnel>(`/api/funnels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderFunnels(ids: string[]) {
    return request<Funnel[]>("/api/funnels/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveFunnel(id: string) {
    return request<Funnel>(`/api/funnels/${id}`, { method: "DELETE" });
  },

  // --- Этапы воронки ---
  listStages(includeArchived = false, funnelId?: string) {
    const q = new URLSearchParams();
    if (includeArchived) q.set("includeArchived", "true");
    if (funnelId) q.set("funnelId", funnelId);
    const qs = q.toString();
    return request<Stage[]>(`/api/stages${qs ? `?${qs}` : ""}`);
  },
  createStage(input: CreateStageInput) {
    return request<Stage>("/api/stages", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateStage(id: string, input: UpdateStageInput) {
    return request<Stage>(`/api/stages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderStages(ids: string[]) {
    return request<Stage[]>("/api/stages/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveStage(id: string, input: ArchiveStageInput) {
    return request<Stage>(`/api/stages/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    });
  },

  // --- Заявки ---
  listLeads(params: LeadListParams = {}) {
    return request<PaginatedLeads>(`/api/leads${leadQuery(params)}`);
  },
  getAgenda(scope?: "mine" | "all") {
    return request<LeadAgendaResponse>(`/api/leads/agenda${scope ? `?scope=${scope}` : ""}`);
  },
  createManualLead(input: CreateManualLeadInput) {
    return request<Lead>("/api/leads/manual", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getLead(id: string) {
    return request<LeadDetail>(`/api/leads/${id}`);
  },
  // --- Сделка: закрывающие документы + отметка «без документов» ---
  addDealDocument(leadId: string, input: CreateDealDocumentInput, file: File) {
    const form = new FormData();
    form.append("data", JSON.stringify(input));
    form.append("file", file);
    return requestMultipart<LeadDetail>(`/api/leads/${leadId}/documents`, "POST", form);
  },
  deleteDealDocument(leadId: string, docId: string) {
    return request<LeadDetail>(`/api/leads/${leadId}/documents/${docId}`, {
      method: "DELETE",
    });
  },
  setDealNoDocuments(leadId: string, noDocuments: boolean) {
    return request<LeadDetail>(`/api/leads/${leadId}/deal`, {
      method: "PATCH",
      body: JSON.stringify({ noDocuments }),
    });
  },
  stats() {
    return request<LeadStats>("/api/leads/stats");
  },

  // --- Контакты (клиенты/риелторы/агентства) ---
  getContact(id: string) {
    return request<ContactDetail>(`/api/contacts/${id}`);
  },
  listContacts(params: ListContactsQuery = {}) {
    const q = new URLSearchParams();
    if (params.kind) q.set("kind", params.kind);
    if (params.search) q.set("search", params.search);
    if (params.includeArchived) q.set("includeArchived", "true");
    const qs = q.toString();
    return request<Contact[]>(`/api/contacts${qs ? `?${qs}` : ""}`);
  },
  createContact(input: UpsertContactInput) {
    return request<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateContact(id: string, input: UpsertContactInput) {
    return request<Contact>(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archiveContact(id: string) {
    return request<Contact>(`/api/contacts/${id}/archive`, { method: "POST" });
  },
  restoreContact(id: string) {
    return request<Contact>(`/api/contacts/${id}/restore`, { method: "POST" });
  },
  deleteContact(id: string) {
    return request<void>(`/api/contacts/${id}`, { method: "DELETE" });
  },
  setLeadReferrer(id: string, input: SetLeadReferrerInput) {
    return request<Lead>(`/api/leads/${id}/referrer`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  // --- Брони ---
  listBookings(params: BookingListParams = {}) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") q.set(key, String(value));
    }
    const qs = q.toString();
    return request<PaginatedBookings>(`/api/bookings${qs ? `?${qs}` : ""}`);
  },
  getBooking(id: string) {
    return request<Booking>(`/api/bookings/${id}`);
  },
  createBooking(input: UpsertBookingInput) {
    return request<Booking>("/api/bookings", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateBooking(id: string, input: UpsertBookingInput) {
    return request<Booking>(`/api/bookings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  cancelBooking(id: string) {
    return request<Booking>(`/api/bookings/${id}/cancel`, { method: "POST" });
  },
  getBookingReminders(scope?: "mine" | "all") {
    return request<BookingRemindersResponse>(
      `/api/bookings/reminders${scope ? `?scope=${scope}` : ""}`,
    );
  },

  inventoryAnalytics(params: InventoryAnalyticsQuery) {
    const q = new URLSearchParams();
    q.set("from", params.from);
    q.set("to", params.to);
    return request<InventoryAnalyticsResponse>(`/api/inventory-analytics?${q.toString()}`);
  },

  partnerAnalytics(params: PartnerAnalyticsQuery = {}) {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.kind) q.set("kind", params.kind);
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return request<PartnerAnalyticsResponse>(`/api/partner-analytics${qs ? `?${qs}` : ""}`);
  },
  updateLeadStage(id: string, input: UpdateLeadStageInput) {
    return request<Lead>(`/api/leads/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  assignLead(id: string, input: AssignLeadInput) {
    return request<Lead>(`/api/leads/${id}/assignee`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  completeNextContact(id: string, input: CompleteNextContactInput) {
    return request<Lead>(`/api/leads/${id}/next-contact/complete`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateNextContact(id: string, input: UpdateNextContactInput) {
    return request<Lead>(`/api/leads/${id}/next-contact`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  updateLeadSource(id: string, input: UpdateLeadSourceInput) {
    return request<Lead>(`/api/leads/${id}/source`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  updateLeadProject(id: string, input: UpdateLeadConstructionInput) {
    return request<Lead>(`/api/leads/${id}/construction`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  addNote(id: string, input: CreateNoteInput) {
    return request<LeadNote>(`/api/leads/${id}/notes`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateNote(noteId: string, input: UpdateNoteInput) {
    return request<LeadNote>(`/api/leads/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  deleteNote(noteId: string) {
    return request<void>(`/api/leads/notes/${noteId}`, { method: "DELETE" });
  },
  // --- Застройщики ---
  listDevelopers(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<Developer[]>(`/api/developers${qs}`);
  },
  saveDeveloper(input: UpsertDeveloperInput, logo: File | undefined, id?: string) {
    const form = new FormData();
    form.append("data", JSON.stringify(input));
    if (logo) form.append("logo", logo);
    return requestMultipart<Developer>(
      id ? `/api/developers/${id}` : "/api/developers",
      id ? "PATCH" : "POST",
      form,
    );
  },
  archiveDeveloper(id: string) {
    return request<Developer>(`/api/developers/${id}/archive`, { method: "POST" });
  },
  restoreDeveloper(id: string) {
    return request<Developer>(`/api/developers/${id}/restore`, { method: "POST" });
  },
  deleteDeveloper(id: string) {
    return request<void>(`/api/developers/${id}`, { method: "DELETE" });
  },

  // --- Рекламные конструкции ---
  listProjects(params: ProjectListParams = {}) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") q.set(key, String(value));
    }
    const qs = q.toString();
    return request<PaginatedProjects>(`/api/constructions${qs ? `?${qs}` : ""}`);
  },
  getProject(id: string) {
    return request<Construction>(`/api/constructions/${id}`);
  },
  saveProject(input: UpsertConstructionInput, files: File[], id?: string) {
    return requestMultipart<Construction>(
      id ? `/api/constructions/${id}` : "/api/constructions",
      id ? "PATCH" : "POST",
      projectForm(input, files),
    );
  },
  archiveProject(id: string) {
    return request<Construction>(`/api/constructions/${id}/archive`, { method: "POST" });
  },
  restoreProject(id: string) {
    return request<Construction>(`/api/constructions/${id}/restore`, { method: "POST" });
  },
  deleteProject(id: string) {
    return request<void>(`/api/constructions/${id}`, { method: "DELETE" });
  },

  // --- Бренды размещений (справочник) ---
  listBookingBrands(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<BookingBrand[]>(`/api/booking-brands${qs}`);
  },
  createBookingBrand(input: UpsertBookingBrandInput) {
    return request<BookingBrand>("/api/booking-brands", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateBookingBrand(id: string, input: UpsertBookingBrandInput) {
    return request<BookingBrand>(`/api/booking-brands/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderBookingBrands(ids: string[]) {
    return request<BookingBrand[]>("/api/booking-brands/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveBookingBrand(id: string) {
    return request<BookingBrand>(`/api/booking-brands/${id}/archive`, { method: "POST" });
  },
  restoreBookingBrand(id: string) {
    return request<BookingBrand>(`/api/booking-brands/${id}/restore`, { method: "POST" });
  },
  deleteBookingBrand(id: string) {
    return request<void>(`/api/booking-brands/${id}`, { method: "DELETE" });
  },

  // --- Причины служебных броней (справочник) ---
  listBookingServiceReasons(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<BookingServiceReason[]>(`/api/booking-service-reasons${qs}`);
  },
  createBookingServiceReason(input: UpsertBookingServiceReasonInput) {
    return request<BookingServiceReason>("/api/booking-service-reasons", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateBookingServiceReason(id: string, input: UpsertBookingServiceReasonInput) {
    return request<BookingServiceReason>(`/api/booking-service-reasons/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderBookingServiceReasons(ids: string[]) {
    return request<BookingServiceReason[]>("/api/booking-service-reasons/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveBookingServiceReason(id: string) {
    return request<BookingServiceReason>(`/api/booking-service-reasons/${id}/archive`, { method: "POST" });
  },
  restoreBookingServiceReason(id: string) {
    return request<BookingServiceReason>(`/api/booking-service-reasons/${id}/restore`, { method: "POST" });
  },
  deleteBookingServiceReason(id: string) {
    return request<void>(`/api/booking-service-reasons/${id}`, { method: "DELETE" });
  },

  // --- Новости ---
  listNews(params: NewsListParams = {}) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") q.set(key, String(value));
    }
    const qs = q.toString();
    return request<PaginatedNews>(`/api/news${qs ? `?${qs}` : ""}`);
  },
  getNews(id: string) {
    return request<News>(`/api/news/${id}`);
  },
  saveNews(input: UpsertNewsInput, cover: File | undefined, id?: string) {
    const form = new FormData();
    form.append("data", JSON.stringify(input));
    if (cover) form.append("cover", cover);
    return requestMultipart<News>(
      id ? `/api/news/${id}` : "/api/news",
      id ? "PATCH" : "POST",
      form,
    );
  },
  archiveNews(id: string) {
    return request<News>(`/api/news/${id}/archive`, { method: "POST" });
  },
  restoreNews(id: string) {
    return request<News>(`/api/news/${id}/restore`, { method: "POST" });
  },
  deleteNews(id: string) {
    return request<void>(`/api/news/${id}`, { method: "DELETE" });
  },

  // --- Метки новостей (справочник) ---
  listNewsLabels(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<NewsLabel[]>(`/api/news-labels${qs}`);
  },
  createNewsLabel(input: UpsertNewsLabelInput) {
    return request<NewsLabel>("/api/news-labels", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateNewsLabel(id: string, input: UpsertNewsLabelInput) {
    return request<NewsLabel>(`/api/news-labels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderNewsLabels(ids: string[]) {
    return request<NewsLabel[]>("/api/news-labels/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveNewsLabel(id: string) {
    return request<NewsLabel>(`/api/news-labels/${id}/archive`, { method: "POST" });
  },
  restoreNewsLabel(id: string) {
    return request<NewsLabel>(`/api/news-labels/${id}/restore`, { method: "POST" });
  },
  deleteNewsLabel(id: string) {
    return request<void>(`/api/news-labels/${id}`, { method: "DELETE" });
  },

  // --- Категории документов (общий справочник) ---
  listDocumentCategories(includeArchived = false) {
    const qs = includeArchived ? "?includeArchived=true" : "";
    return request<DocumentCategory[]>(`/api/document-categories${qs}`);
  },
  createDocumentCategory(input: UpsertDocumentCategoryInput) {
    return request<DocumentCategory>("/api/document-categories", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateDocumentCategory(id: string, input: UpsertDocumentCategoryInput) {
    return request<DocumentCategory>(`/api/document-categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reorderDocumentCategories(ids: string[]) {
    return request<DocumentCategory[]>("/api/document-categories/reorder", {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    });
  },
  archiveDocumentCategory(id: string) {
    return request<DocumentCategory>(`/api/document-categories/${id}/archive`, {
      method: "POST",
    });
  },
  restoreDocumentCategory(id: string) {
    return request<DocumentCategory>(`/api/document-categories/${id}/restore`, {
      method: "POST",
    });
  },
  deleteDocumentCategory(id: string) {
    return request<void>(`/api/document-categories/${id}`, { method: "DELETE" });
  },

  // --- Документы по конструкции (точечные операции в карточке) ---
  listProjectDocuments(projectId: string) {
    return request<Document[]>(`/api/constructions/${projectId}/documents`);
  },
  addDocument(projectId: string, input: CreateDocumentInput, file?: File) {
    const form = new FormData();
    form.append("data", JSON.stringify(input));
    if (file) form.append("file", file);
    return requestMultipart<Document>(
      `/api/constructions/${projectId}/documents`,
      "POST",
      form,
    );
  },
  updateDocument(projectId: string, id: string, input: UpdateDocumentInput) {
    return request<Document>(`/api/constructions/${projectId}/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  deleteDocument(projectId: string, id: string) {
    return request<void>(`/api/constructions/${projectId}/documents/${id}`, {
      method: "DELETE",
    });
  },

  // --- Фотоотчёты по конструкции (точечные операции в карточке) ---
  listProjectProgress(projectId: string) {
    return request<ProgressAlbum[]>(`/api/constructions/${projectId}/progress`);
  },
  createProgressAlbum(projectId: string, input: UpsertProgressAlbumInput) {
    return request<ProgressAlbum>(`/api/constructions/${projectId}/progress`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateProgressAlbum(projectId: string, id: string, input: UpsertProgressAlbumInput) {
    return request<ProgressAlbum>(`/api/constructions/${projectId}/progress/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  deleteProgressAlbum(projectId: string, id: string) {
    return request<void>(`/api/constructions/${projectId}/progress/${id}`, {
      method: "DELETE",
    });
  },
  addProgressPhotos(projectId: string, albumId: string, files: File[]) {
    const form = new FormData();
    files.forEach((file, i) => form.append(`photo_${i}`, file));
    return requestMultipart<ProgressAlbum>(
      `/api/constructions/${projectId}/progress/${albumId}/photos`,
      "POST",
      form,
    );
  },
  deleteProgressPhoto(projectId: string, albumId: string, photoId: string) {
    return request<void>(
      `/api/constructions/${projectId}/progress/${albumId}/photos/${photoId}`,
      { method: "DELETE" },
    );
  },

  // --- Статус публикации лендинга ---
  getSiteBuild() {
    return request<SiteBuildStatus>("/api/site-build");
  },
  requestSitePublish() {
    return request<SiteBuildStatus>("/api/site-build/request", { method: "POST" });
  },

  // --- Настройки «обвязки» сайта (Веха 4.3, admin) ---
  getSiteSettings() {
    return request<{ settings: SiteSettingsOverrides; updatedAt: string }>(
      "/api/site-settings",
    );
  },
  updateSiteSettings(input: UpdateSiteSettingsInput) {
    return request<{ settings: SiteSettingsOverrides; updatedAt: string }>(
      "/api/site-settings",
      { method: "PUT", body: JSON.stringify(input) },
    );
  },

  /** Скачивает CSV заявок (с учётом фильтров) и инициирует загрузку файла. */
  async exportLeads(params: LeadListParams = {}) {
    const res = await fetch(`${API_URL}/api/leads/export${leadQuery(params)}`, {
      credentials: "include",
    });
    if (!res.ok) throw new ApiError(res.status, `Ошибка экспорта (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  },
};

export interface LeadListParams {
  page?: number;
  pageSize?: number;
  stageId?: string;
  funnelId?: string;
  source?: string;
  constructionId?: string;
  assigneeId?: string;
  from?: string;
  to?: string;
  search?: string;
}

function leadQuery(params: LeadListParams): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") q.set(key, String(value));
  }
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}
