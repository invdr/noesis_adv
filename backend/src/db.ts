import { PrismaClient } from "@prisma/client";

let client: PrismaClient | null = null;

/** Singleton Prisma-клиента. */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}
