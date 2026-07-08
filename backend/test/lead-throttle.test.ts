import { describe, expect, test } from "bun:test";
import { slidingLimiter } from "../src/http/rate-limit";

describe("slidingLimiter", () => {
  test("пропускает до max включительно, затем отказывает", () => {
    const limiter = slidingLimiter(3, 60_000);
    expect(limiter.tryConsume("k")).toBe(true); // 1
    expect(limiter.tryConsume("k")).toBe(true); // 2
    expect(limiter.tryConsume("k")).toBe(true); // 3
    expect(limiter.tryConsume("k")).toBe(false); // 4 — превышение
  });

  test("ключи независимы", () => {
    const limiter = slidingLimiter(1, 60_000);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("b")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
  });

  test("окно сбрасывается по истечении", () => {
    const limiter = slidingLimiter(1, 5);
    expect(limiter.tryConsume("k")).toBe(true);
    expect(limiter.tryConsume("k")).toBe(false);
    const until = Date.now() + 20;
    while (Date.now() < until) {
      /* подождать выхода за окно (5 мс) */
    }
    expect(limiter.tryConsume("k")).toBe(true);
  });
});
