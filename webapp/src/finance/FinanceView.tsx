import { useState } from "react";
import "./finance.css";
import { FinanceSummaryTab } from "./FinanceSummaryTab";
import { FinanceIncomeTab } from "./FinanceIncomeTab";
import { FinanceExpensesTab } from "./FinanceExpensesTab";
import { FinanceParticipantsTab } from "./FinanceParticipantsTab";
import { FinanceDistributionsTab } from "./FinanceDistributionsTab";

type Tab = "summary" | "income" | "expenses" | "participants" | "distributions";

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Сводка" },
  { id: "income", label: "Поступления" },
  { id: "expenses", label: "Расходы" },
  { id: "participants", label: "Участники" },
  { id: "distributions", label: "Распределения" },
];

/** Раздел «Финансы» (admin, Этап 4.5). */
export function FinanceView() {
  const [tab, setTab] = useState<Tab>("summary");

  return (
    <div className="finance">
      <div className="fin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`fin-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && <FinanceSummaryTab />}
      {tab === "income" && <FinanceIncomeTab />}
      {tab === "expenses" && <FinanceExpensesTab />}
      {tab === "participants" && <FinanceParticipantsTab />}
      {tab === "distributions" && <FinanceDistributionsTab />}
    </div>
  );
}
