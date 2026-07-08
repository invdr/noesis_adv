import { HttpError } from "../http/errors";
import { slidingLimiter } from "../http/rate-limit";

/**
 * Анти-спам приёма заявок. По решению продукта — мягко к общему IP:
 * - основной лимит по паре «IP + телефон» (один человек/номер не флудит, при
 *   этом разные люди за одним NAT друг другу не мешают);
 * - высокий потолок по одному IP как страховка от бота, который шлёт с одного
 *   адреса много разных выдуманных номеров (honeypot ловит лишь примитивных).
 */
const PER_IP_PHONE = slidingLimiter(5, 10 * 60 * 1000);
const PER_IP_CEILING = slidingLimiter(20, 10 * 60 * 1000);

/** Бросает 429, если для пары IP+телефон или для IP превышен лимит. */
export function assertLeadAllowed(ip: string, phone: string): void {
  const okPair = PER_IP_PHONE.tryConsume(`${ip}|${phone}`);
  const okIp = PER_IP_CEILING.tryConsume(ip);
  if (!okPair || !okIp) {
    throw new HttpError(
      429,
      "too_many_requests",
      "Слишком много заявок. Пожалуйста, повторите попытку чуть позже.",
    );
  }
}
