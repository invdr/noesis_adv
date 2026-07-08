import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/**
 * Справочник источников заявок (admin). Веб-источники сайта заблокированы
 * полностью (их id шлют формы лендинга); «Оффлайн»/«Прочее» можно только
 * переименовать; добавленные админом — полный цикл.
 */
export function SourcesAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["sources"],
        list: (includeArchived) => api.listSources(includeArchived),
        create: (name) => api.createSource({ name }),
        rename: (id, name) => api.updateSource(id, { name }),
        reorder: (ids) => api.reorderSources(ids),
        archive: (id) => api.archiveSource(id),
        restore: (id) => api.restoreSource(id),
        remove: (id) => api.deleteSource(id),
      }}
      lockOf={(s) => (s.isWeb ? "full" : s.isSystem ? "lifecycle" : undefined)}
      title="Источники заявок"
      description="Каналы поступления заявок. Источники «с сайта» системные — их идентификаторы зашиты в формы лендинга; «Оффлайн» и «Прочее» можно переименовать. Новые источники доступны в ручном приёме и при уточнении канала в карточке; удалить используемый источник нельзя — используйте архив."
      addPlaceholder="Новый источник (напр. «Авито»)"
    />
  );
}
