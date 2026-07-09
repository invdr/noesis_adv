import { api } from "../api/client";
import { DictionaryAdmin } from "../shared/DictionaryAdmin";

/** Справочник причин служебной занятости (admin). */
export function BookingServiceReasonsAdmin() {
  return (
    <DictionaryAdmin
      api={{
        queryKey: ["booking-service-reasons"],
        list: (includeArchived) => api.listBookingServiceReasons(includeArchived),
        create: (name) => api.createBookingServiceReason({ name }),
        rename: (id, name) => api.updateBookingServiceReason(id, { name }),
        reorder: (ids) => api.reorderBookingServiceReasons(ids),
        archive: (id) => api.archiveBookingServiceReason(id),
        restore: (id) => api.restoreBookingServiceReason(id),
        remove: (id) => api.deleteBookingServiceReason(id),
      }}
      title="Причины служебных броней"
      description="Служебные брони занимают конструкцию, но не входят в выручку."
      addPlaceholder="Новая причина"
    />
  );
}
