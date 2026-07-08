import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Справочник меток новостей (admin). */
export function NewsLabelsAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["news-labels"],
        list: (includeArchived) => api.listNewsLabels(includeArchived),
        create: (name) => api.createNewsLabel({ name }),
        rename: (id, name) => api.updateNewsLabel(id, { name }),
        reorder: (ids) => api.reorderNewsLabels(ids),
        archive: (id) => api.archiveNewsLabel(id),
        restore: (id) => api.restoreNewsLabel(id),
        remove: (id) => api.deleteNewsLabel(id),
      }}
      title="Метки новостей"
      description="Управляемый справочник меток для карточек новостей. Метку нельзя удалить, пока ею помечены новости — используйте архив."
      addPlaceholder="Новая метка (напр. «Акция»)"
    />
  );
}
