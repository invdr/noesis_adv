import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Справочник типов следующего контакта (admin). */
export function ContactTypesAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["contact-types"],
        list: (includeArchived) => api.listContactTypes(includeArchived),
        create: (name) => api.createContactType({ name }),
        rename: (id, name) => api.updateContactType(id, { name }),
        reorder: (ids) => api.reorderContactTypes(ids),
        archive: (id) => api.archiveContactType(id),
        restore: (id) => api.restoreContactType(id),
        remove: (id) => api.deleteContactType(id),
      }}
      title="Типы контакта"
      description="Варианты следующего контакта по заявке (звонок, сообщение, встреча…). Тип нельзя удалить, пока на него ссылаются заявки — используйте архив."
      addPlaceholder="Новый тип (напр. «Видеозвонок»)"
    />
  );
}
