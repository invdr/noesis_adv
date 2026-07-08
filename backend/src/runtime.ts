import { getEnv, type Env } from "./env";
import { getPrisma } from "./db";
import type { PrismaClient } from "@prisma/client";

export interface Runtime {
  env: Env;
  prisma: PrismaClient;
}

/**
 * Общая инициализация для API/worker/cron-входов: валидация окружения и
 * создание Prisma-клиента.
 */
export function createRuntime(): Runtime {
  const env = getEnv();
  const prisma = getPrisma();
  return { env, prisma };
}
