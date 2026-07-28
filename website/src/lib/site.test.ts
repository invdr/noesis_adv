import { describe, expect, test } from "bun:test";
import { isIndexableOrigin } from "./site";

/**
 * Правило индексации: robots.txt открывает сайт только на настоящем домене.
 * Регрессия тут не видна глазами — сайт просто уходит из поиска целиком,
 * поэтому фиксируем обе стороны правила.
 */
describe("isIndexableOrigin", () => {
  test("настоящий домен — индексируем", () => {
    expect(isIndexableOrigin("https://noesis.catlg.ru")).toBe(true);
    expect(isIndexableOrigin("https://noesis-grozny.ru")).toBe(true);
  });

  test("голый IP и localhost — не индексируем", () => {
    expect(isIndexableOrigin("http://168.222.140.78")).toBe(false);
    expect(isIndexableOrigin("http://77.222.32.54")).toBe(false);
    expect(isIndexableOrigin("http://localhost:4321")).toBe(false);
  });

  test("пустая или битая строка — не индексируем (безопасный дефолт)", () => {
    expect(isIndexableOrigin("")).toBe(false);
    expect(isIndexableOrigin("не-url")).toBe(false);
  });
});
