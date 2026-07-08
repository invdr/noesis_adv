import { describe, expect, test } from "bun:test";
import { stageSchema } from "@noesis/contracts";
import { toStageDto } from "../src/stages/stage-dto";

describe("toStageDto", () => {
  const base = {
    id: "stage_new",
    name: "Новая",
    funnelId: "funnel_default",
    order: 1,
    kind: "in_progress" as const,
    color: "blue",
    isEntry: true,
    createdAt: new Date("2026-06-25T10:00:00.000Z"),
    updatedAt: new Date("2026-06-25T10:00:00.000Z"),
  };

  test("маппит живой этап в валидный DTO контракта", () => {
    const dto = toStageDto({ ...base, archivedAt: null });
    expect(() => stageSchema.parse(dto)).not.toThrow();
    expect(dto.isArchived).toBe(false);
    expect(dto.createdAt).toBe("2026-06-25T10:00:00.000Z");
  });

  test("archivedAt !== null → isArchived = true", () => {
    const dto = toStageDto({ ...base, archivedAt: new Date() });
    expect(dto.isArchived).toBe(true);
  });
});
