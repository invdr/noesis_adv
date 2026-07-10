import { afterEach, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { sendTelegramMessage } from "../src/notifications/telegram";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sendTelegramMessage ограничивает сетевой запрос сигналом отмены", async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    signal = init.signal ?? undefined;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const rt = {
    env: { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "chat" },
  } as unknown as Runtime;

  await expect(sendTelegramMessage(rt, "test")).resolves.toBe(true);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
});
