import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserRole } from "@noesis/contracts";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/auth-service";
import type { Runtime } from "../src/runtime";

const TOKEN = "deal-route-test-token";
const ORIGIN = "http://localhost:5173";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function runtimeWith(
  role: UserRole,
  opts: {
    leadAssigneeId?: string | null;
    leadExists?: boolean;
    docExists?: boolean;
    filesDir?: string;
    documentAsset?: Record<string, unknown>;
  } = {},
): Runtime {
  const {
    leadAssigneeId = null,
    leadExists = true,
    docExists = false,
    filesDir,
    documentAsset,
  } = opts;
  return {
    env: {
      CORS_ORIGINS: [ORIGIN],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
      FILES_PUBLIC_BASE: "/files",
      FILES_DIR: filesDir,
    },
    prisma: {
      session: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          where.tokenHash === tokenHash(TOKEN)
            ? {
                id: `session-${role}`,
                userId: `user-${role}`,
                expiresAt: new Date(Date.now() + 60_000),
                lastSeenAt: new Date(),
                user: {
                  id: `user-${role}`,
                  email: `${role}@example.com`,
                  name: null,
                  role,
                  mustChangePassword: false,
                  isActive: true,
                },
              }
            : null,
        update: async () => ({}),
      },
      lead: {
        findUnique: async () =>
          leadExists ? { id: "lead1", assigneeId: leadAssigneeId } : null,
      },
      dealDocument: {
        findFirst: async () =>
          docExists
            ? { id: "doc1", leadId: "lead1", assetId: "a1", asset: documentAsset }
            : null,
      },
    },
  } as unknown as Runtime;
}

function auth(): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${TOKEN}`, Origin: ORIGIN };
}

describe("dealRoutes", () => {
  test("PATCH /:id/deal без noDocuments — 422 (валидация)", async () => {
    const app = createApp(runtimeWith("admin"));
    const res = await app.request("/api/leads/lead1/deal", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("POST /:id/documents без файла — 422 missing_file", async () => {
    const app = createApp(runtimeWith("admin"));
    const form = new FormData();
    form.append("data", JSON.stringify({ type: "contract" }));
    const res = await app.request("/api/leads/lead1/documents", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("missing_file");
  });

  test("POST /:id/documents на чужой заявке — 403", async () => {
    const app = createApp(runtimeWith("manager", { leadAssigneeId: "someone-else" }));
    const form = new FormData();
    form.append("data", JSON.stringify({ type: "contract" }));
    const res = await app.request("/api/leads/lead1/documents", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    expect(res.status).toBe(403);
  });

  test("DELETE несуществующего документа — 404", async () => {
    const app = createApp(runtimeWith("admin", { docExists: false }));
    const res = await app.request("/api/leads/lead1/documents/missing", {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });

  test("GET /:id/documents/:docId/download без сессии — 401", async () => {
    const app = createApp(runtimeWith("admin"));
    const res = await app.request("/api/leads/lead1/documents/doc1/download", {
      headers: { Origin: ORIGIN },
    });
    expect(res.status).toBe(401);
  });

  test("GET /:id/documents/:docId/download на чужой заявке — 403", async () => {
    const app = createApp(runtimeWith("manager", { leadAssigneeId: "someone-else" }));
    const res = await app.request("/api/leads/lead1/documents/doc1/download", {
      headers: auth(),
    });
    expect(res.status).toBe(403);
  });

  test("GET /:id/documents/:docId/download отдаёт файл только через закрытый маршрут", async () => {
    const filesDir = await mkdtemp(join(tmpdir(), "deal-download-"));
    try {
      await mkdir(join(filesDir, "deals", "ab"), { recursive: true });
      await writeFile(join(filesDir, "deals", "ab", "contract.pdf"), "private document");
      const app = createApp(
        runtimeWith("admin", {
          docExists: true,
          filesDir,
          documentAsset: {
            id: "a1",
            storageKey: "deals/ab/contract.pdf",
            mimeType: "application/pdf",
            originalName: "contract.pdf",
          },
        }),
      );

      const res = await app.request("/api/leads/lead1/documents/doc1/download", {
        headers: auth(),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("private document");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("content-disposition")).toContain("attachment");
    } finally {
      await rm(filesDir, { recursive: true, force: true });
    }
  });

  test("без сессии — 401", async () => {
    const app = createApp(runtimeWith("admin"));
    const res = await app.request("/api/leads/lead1/deal", {
      method: "PATCH",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ noDocuments: true }),
    });
    expect(res.status).toBe(401);
  });
});
