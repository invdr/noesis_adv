import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");

describe("deployment wiring for booking reminders", () => {
  test("передаёт секрет cron и токен Telegram в backend для Docker и no-docker", async () => {
    const [noDockerDeploy, dockerCompose] = await Promise.all([
      readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8"),
      readFile(resolve(root, "infra/docker-compose.prod.yml"), "utf8"),
    ]);

    expect(noDockerDeploy).toContain("REMINDER_CRON_TOKEN=${REMINDER_CRON_TOKEN:-}");
    expect(dockerCompose).toContain("REMINDER_CRON_TOKEN: ${REMINDER_CRON_TOKEN:-}");
    expect(dockerCompose).toContain("TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}");
  });
});
