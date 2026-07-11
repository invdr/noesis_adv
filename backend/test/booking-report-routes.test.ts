import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/auth-service";
import type { Runtime } from "../src/runtime";

const TOKEN = "booking-report-route-test-token";
const ORIGIN = "http://localhost:5173";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function runtimeWith(filesDir?: string): Runtime {
  const asset = {
    id: "a1",
    storageKey: "booking-reports/ab/photo.jpg",
    mimeType: "image/jpeg",
    originalName: "photo.jpg",
  };
  const prisma = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash(TOKEN)
          ? {
              id: "session-1",
              userId: "u1",
              expiresAt: new Date(Date.now() + 60_000),
              lastSeenAt: new Date(),
              user: {
                id: "u1",
                email: "manager@example.com",
                name: null,
                role: "manager",
                mustChangePassword: false,
                isActive: true,
              },
            }
          : null,
      update: async () => ({}),
    },
    booking: {
      findUnique: async () => ({
        id: "b1",
        status: "onAir",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      }),
    },
    bookingReport: {
      findFirst: async () => ({ id: "r1", year: 2026, month: 6 }),
    },
    bookingReportPhoto: {
      findFirst: async ({ include }: { include?: unknown }) =>
        include ? { id: "p1", reportId: "r1", assetId: "a1", asset } : null,
    },
  };
  return {
    env: {
      CORS_ORIGINS: [ORIGIN],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
      FILES_PUBLIC_BASE: "/files",
      FILES_DIR: filesDir,
    },
    prisma,
  } as unknown as Runtime;
}

function auth(): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${TOKEN}`, Origin: ORIGIN };
}

describe("booking report photo download", () => {
  const path = "/api/bookings/b1/reports/r1/photos/p1/download";

  test("без сессии возвращает 401", async () => {
    const res = await createApp(runtimeWith()).request(path, { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });

  test("отдаёт фотографию только закрытым маршрутом и запрещает кеш", async () => {
    const filesDir = await mkdtemp(join(tmpdir(), "booking-report-download-"));
    try {
      await mkdir(join(filesDir, "booking-reports", "ab"), { recursive: true });
      await writeFile(join(filesDir, "booking-reports", "ab", "photo.jpg"), "private photo");
      const res = await createApp(runtimeWith(filesDir)).request(path, { headers: auth() });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("private photo");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("content-type")).toContain("image/jpeg");
    } finally {
      await rm(filesDir, { recursive: true, force: true });
    }
  });
});
