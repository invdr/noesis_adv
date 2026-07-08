// Производные значения «обвязки» из настроек (Веха 4.3): один источник для всех
// страниц/компонентов лендинга. Переиспользует хелперы контракта.
import {
  deriveSecondaryContact,
  formatPhoneRu,
  phoneHref,
  type ResolvedSiteSettings,
  type SecondaryContactKind,
} from "@gsk-tower/contracts";

export interface Chrome {
  /** Полный набор настроек (дефолты + переопределения). */
  s: ResolvedSiteSettings;
  /** Телефон для показа: `+7 (XXX) XXX-XX-XX`. */
  phoneDisplay: string;
  /** Телефон-ссылка: `tel:+7XXXXXXXXXX`. */
  phoneHref: string;
  /** Второй контакт (кнопка вместо «Написать на почту»): ссылка + подпись. */
  secondary: { kind: SecondaryContactKind; href: string; label: string };
  /** ID счётчика Яндекс.Метрики (пусто = выключена). */
  metrikaId: string;
}

export function buildChrome(s: ResolvedSiteSettings): Chrome {
  return {
    s,
    phoneDisplay: formatPhoneRu(s.phonePrimary),
    phoneHref: phoneHref(s.phonePrimary),
    secondary: deriveSecondaryContact(s),
    metrikaId: s.metrikaCounterId,
  };
}
