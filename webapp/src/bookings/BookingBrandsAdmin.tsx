import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Справочник брендов/рекламодателей на макетах (admin). */
export function BookingBrandsAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["booking-brands"],
        list: (includeArchived) => api.listBookingBrands(includeArchived),
        create: (name) => api.createBookingBrand({ name }),
        rename: (id, name) => api.updateBookingBrand(id, { name }),
        reorder: (ids) => api.reorderBookingBrands(ids),
        archive: (id) => api.archiveBookingBrand(id),
        restore: (id) => api.restoreBookingBrand(id),
        remove: (id) => api.deleteBookingBrand(id),
      }}
      title="Бренды"
      description="Что размещаем на конструкции. Бренд может отличаться от клиента-плательщика."
      addPlaceholder="Новый бренд"
    />
  );
}
