import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Справочник статей расходов (admin, Этап 4.5). */
export function FinanceCategoriesAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["finance-categories"],
        list: (includeArchived) => api.listFinanceCategories(includeArchived),
        create: (name) => api.createFinanceCategory({ name }),
        rename: (id, name) => api.updateFinanceCategory(id, { name }),
        reorder: (ids) => api.reorderFinanceCategories(ids),
        archive: (id) => api.archiveFinanceCategory(id),
        restore: (id) => api.restoreFinanceCategory(id),
        remove: (id) => api.deleteFinanceCategory(id),
      }}
      title="Статьи расходов"
      description="Монтаж, демонтаж, электропитание и т. п. Используются в записях расходов."
      addPlaceholder="Новая статья"
    />
  );
}
