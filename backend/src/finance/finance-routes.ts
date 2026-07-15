import { Hono } from "hono";
import {
  financeSummaryQuerySchema,
  listFinanceDistributionsQuerySchema,
  listFinanceExpenseQuerySchema,
  listFinanceIncomeQuerySchema,
  listFinancePayoutsQuerySchema,
  monthSchema,
  reorderFinanceExpenseCategoriesSchema,
  upsertFinanceExpenseCategorySchema,
  upsertFinanceExpenseSchema,
  upsertFinanceIncomeSchema,
  upsertFinanceParticipantSchema,
  upsertFinancePayoutSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requireRole } from "../http/auth";
import {
  archiveExpenseCategory,
  archiveParticipant,
  createExpenseCategory,
  createParticipant,
  deleteExpenseCategory,
  deleteParticipant,
  getParticipant,
  listExpenseCategories,
  listParticipants,
  reorderExpenseCategories,
  restoreExpenseCategory,
  restoreParticipant,
  updateExpenseCategory,
  updateParticipant,
} from "./finance-dictionaries-service";
import {
  createExpense,
  createIncome,
  createPayout,
  deleteExpense,
  deleteIncome,
  deletePayout,
  listExpenses,
  listIncome,
  listPayouts,
  updateExpense,
  updateIncome,
  updatePayout,
} from "./finance-records-service";
import {
  closeDistribution,
  currentMonth,
  getDistribution,
  getSummary,
  listDistributions,
  reopenDistribution,
} from "./finance-distribution-service";

function includeArchived(c: { req: { query: (k: string) => string | undefined } }): boolean {
  const raw = c.req.query("includeArchived");
  return raw === "true" || raw === "1";
}

export function financeRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole(rt, "admin");

  // --- Статьи расходов ---
  app.get("/categories", admin, async (c) =>
    c.json(await listExpenseCategories(rt, { includeArchived: includeArchived(c) })),
  );
  app.post("/categories", admin, async (c) => {
    const input = upsertFinanceExpenseCategorySchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createExpenseCategory(rt, input), 201);
  });
  app.patch("/categories/reorder", admin, async (c) => {
    const input = reorderFinanceExpenseCategoriesSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderExpenseCategories(rt, input));
  });
  app.patch("/categories/:id", admin, async (c) => {
    const input = upsertFinanceExpenseCategorySchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateExpenseCategory(rt, c.req.param("id"), input));
  });
  app.post("/categories/:id/archive", admin, async (c) =>
    c.json(await archiveExpenseCategory(rt, c.req.param("id"))),
  );
  app.post("/categories/:id/restore", admin, async (c) =>
    c.json(await restoreExpenseCategory(rt, c.req.param("id"))),
  );
  app.delete("/categories/:id", admin, async (c) => {
    await deleteExpenseCategory(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Участники ---
  app.get("/participants", admin, async (c) =>
    c.json(await listParticipants(rt, { includeArchived: includeArchived(c) })),
  );
  app.post("/participants", admin, async (c) => {
    const input = upsertFinanceParticipantSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createParticipant(rt, input), 201);
  });
  app.get("/participants/:id", admin, async (c) =>
    c.json(await getParticipant(rt, c.req.param("id"))),
  );
  app.patch("/participants/:id", admin, async (c) => {
    const input = upsertFinanceParticipantSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateParticipant(rt, c.req.param("id"), input));
  });
  app.post("/participants/:id/archive", admin, async (c) =>
    c.json(await archiveParticipant(rt, c.req.param("id"))),
  );
  app.post("/participants/:id/restore", admin, async (c) =>
    c.json(await restoreParticipant(rt, c.req.param("id"))),
  );
  app.delete("/participants/:id", admin, async (c) => {
    await deleteParticipant(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Поступления ---
  app.get("/income", admin, async (c) => {
    const query = listFinanceIncomeQuerySchema.parse(c.req.query());
    return c.json(await listIncome(rt, query));
  });
  app.post("/income", admin, async (c) => {
    const input = upsertFinanceIncomeSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createIncome(rt, c.get("user"), input), 201);
  });
  app.patch("/income/:id", admin, async (c) => {
    const input = upsertFinanceIncomeSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateIncome(rt, c.req.param("id"), input));
  });
  app.delete("/income/:id", admin, async (c) => {
    await deleteIncome(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Расходы ---
  app.get("/expenses", admin, async (c) => {
    const query = listFinanceExpenseQuerySchema.parse(c.req.query());
    return c.json(await listExpenses(rt, query));
  });
  app.post("/expenses", admin, async (c) => {
    const input = upsertFinanceExpenseSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createExpense(rt, c.get("user"), input), 201);
  });
  app.patch("/expenses/:id", admin, async (c) => {
    const input = upsertFinanceExpenseSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateExpense(rt, c.req.param("id"), input));
  });
  app.delete("/expenses/:id", admin, async (c) => {
    await deleteExpense(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Выплаты ---
  app.get("/payouts", admin, async (c) => {
    const query = listFinancePayoutsQuerySchema.parse(c.req.query());
    return c.json(await listPayouts(rt, query));
  });
  app.post("/payouts", admin, async (c) => {
    const input = upsertFinancePayoutSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createPayout(rt, c.get("user"), input), 201);
  });
  app.patch("/payouts/:id", admin, async (c) => {
    const input = upsertFinancePayoutSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updatePayout(rt, c.req.param("id"), input));
  });
  app.delete("/payouts/:id", admin, async (c) => {
    await deletePayout(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Сводка ---
  app.get("/summary", admin, async (c) => {
    const { from, to } = financeSummaryQuerySchema.parse(defaultRange(c.req.query()));
    return c.json(await getSummary(rt, from, to));
  });

  // --- Распределения ---
  app.get("/distributions", admin, async (c) => {
    const parsed = listFinanceDistributionsQuerySchema.parse(c.req.query());
    const to = parsed.to ?? currentMonth();
    const from = parsed.from ?? backMonths(to, 11);
    return c.json(await listDistributions(rt, from, to));
  });
  app.get("/distributions/:month", admin, async (c) =>
    c.json(await getDistribution(rt, monthSchema.parse(c.req.param("month")))),
  );
  app.post("/distributions/:month/close", admin, async (c) =>
    c.json(await closeDistribution(rt, c.get("user"), monthSchema.parse(c.req.param("month")))),
  );
  app.post("/distributions/:month/reopen", admin, async (c) =>
    c.json(await reopenDistribution(rt, monthSchema.parse(c.req.param("month")))),
  );

  return app;
}

/** Дефолт периода сводки — текущий месяц, если не задан. */
function defaultRange(q: Record<string, string>): Record<string, string> {
  const to = q.to ?? currentMonth();
  const from = q.from ?? backMonths(to, 5);
  return { ...q, from, to };
}

/** Месяц на `n` месяцев назад от `month` (ГГГГ-ММ). */
function backMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const zero = (y! * 12 + (m! - 1)) - n;
  const year = Math.floor(zero / 12);
  const mm = (zero % 12) + 1;
  return `${year}-${String(mm).padStart(2, "0")}`;
}
