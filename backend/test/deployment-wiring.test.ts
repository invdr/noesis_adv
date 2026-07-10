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

  test("кодирует реквизиты PostgreSQL перед записью DATABASE_URL без Docker", async () => {
    const noDockerDeploy = await readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8");

    expect(noDockerDeploy).toContain("urlencode()");
    expect(noDockerDeploy).toContain("encodeURIComponent(process.argv[1])");
    expect(noDockerDeploy).toContain('database_password="$(urlencode "$POSTGRES_PASSWORD")"');
    expect(noDockerDeploy).toContain(
      'postgresql://$database_user:$database_password@127.0.0.1:5432/$database_name?schema=public',
    );
  });

  test("документирует отдельные cron URL для Docker и no-docker", async () => {
    const deploymentGuide = await readFile(resolve(root, "docs/DEPLOYMENT_VPS.md"), "utf8");

    expect(deploymentGuide).toContain("http://127.0.0.1:3000/api/internal/bookings/reminders/notify");
    expect(deploymentGuide).toContain("NOESIS_BACKEND_PORT");
    expect(deploymentGuide).toContain("http://127.0.0.1:3001/api/internal/bookings/reminders/notify");
  });
});
