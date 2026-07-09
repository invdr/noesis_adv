import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Общий справочник категорий документов (admin). Порядок задаёт плитки на главной. */
export function DocumentCategoriesAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["document-categories"],
        list: (includeArchived) => api.listDocumentCategories(includeArchived),
        create: (name) => api.createDocumentCategory({ name }),
        rename: (id, name) => api.updateDocumentCategory(id, { name }),
        reorder: (ids) => api.reorderDocumentCategories(ids),
        archive: (id) => api.archiveDocumentCategory(id),
        restore: (id) => api.restoreDocumentCategory(id),
        remove: (id) => api.deleteDocumentCategory(id),
      }}
      title="Категории документов"
      description="Общий справочник категорий для всех конструкций (порядок задаёт раскладку на главной). Категорию нельзя удалить, пока в ней есть документы — используйте архив."
      addPlaceholder="Новая категория (напр. «Прайс-листы»)"
    />
  );
}
