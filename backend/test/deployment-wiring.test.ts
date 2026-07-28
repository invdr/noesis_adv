import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");

describe("deployment wiring for booking reminders", () => {
  test("закрывает прямую раздачу фотоотчётов брони и поднимает лимит только для их загрузки", async () => {
    const [dockerNginx, noDockerNginx] = await Promise.all([
      readFile(resolve(root, "infra/nginx/default.conf"), "utf8"),
      readFile(resolve(root, "infra/nginx/no-docker.conf.template"), "utf8"),
    ]);

    for (const nginx of [dockerNginx, noDockerNginx]) {
      expect(nginx).toContain("location ^~ /files/booking-reports/ {");
      expect(nginx).toContain("location ~ ^/api/bookings/[^/]+/reports/[^/]+/photos$");
      expect(nginx).toContain("client_max_body_size 102m;");
    }
  });

  test("передаёт секрет cron и токен Telegram в backend для Docker и no-docker", async () => {
    const [noDockerDeploy, dockerCompose] = await Promise.all([
      readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8"),
      readFile(resolve(root, "infra/docker-compose.prod.yml"), "utf8"),
    ]);

    expect(noDockerDeploy).toContain("REMINDER_CRON_TOKEN=${REMINDER_CRON_TOKEN:-}");
    expect(dockerCompose).toContain("REMINDER_CRON_TOKEN: ${REMINDER_CRON_TOKEN:-}");
    expect(dockerCompose).toContain("TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}");
  });

  test("кодирует реквизиты PostgreSQL перед записью DATABASE_URL с Docker и без него", async () => {
    const [noDockerDeploy, dockerCompose, dockerEntrypoint] = await Promise.all([
      readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8"),
      readFile(resolve(root, "infra/docker-compose.prod.yml"), "utf8"),
      readFile(resolve(root, "infra/docker-backend-entrypoint.sh"), "utf8"),
    ]);

    expect(noDockerDeploy).toContain("urlencode()");
    expect(noDockerDeploy).toContain("encodeURIComponent(process.argv[1])");
    expect(noDockerDeploy).toContain('database_password="$(urlencode "$POSTGRES_PASSWORD")"');
    expect(noDockerDeploy).toContain(
      'postgresql://$database_user:$database_password@127.0.0.1:5432/$database_name?schema=public',
    );
    expect(dockerCompose).not.toContain("DATABASE_URL: postgresql://");
    expect(dockerEntrypoint).toContain("encodeURIComponent(process.argv[1])");
    expect(noDockerDeploy).toContain(
      "process.stdout.write(encodeURIComponent(process.argv[1]))' -- \"$1\"",
    );
    expect(dockerEntrypoint).toContain(
      "console.log(encodeURIComponent(process.argv[1]))' -- \"$1\"",
    );
    expect(dockerEntrypoint).toContain(
      'postgresql://$database_user:$database_password@postgres:5432/$database_name?schema=public',
    );
  });

  test("документирует отдельные cron URL для Docker и no-docker", async () => {
    const deploymentGuide = await readFile(resolve(root, "docs/DEPLOYMENT_VPS.md"), "utf8");

    expect(deploymentGuide).toContain("http://127.0.0.1:3000/api/internal/bookings/reminders/notify");
    expect(deploymentGuide).toContain("NOESIS_BACKEND_PORT");
    expect(deploymentGuide).toContain("http://127.0.0.1:3001/api/internal/bookings/reminders/notify");
  });

  test("инструкция no-docker запускает требующий root деплой через sudo", async () => {
    const [deploymentGuide, readme] = await Promise.all([
      readFile(resolve(root, "docs/DEPLOYMENT_VPS.md"), "utf8"),
      readFile(resolve(root, "README.md"), "utf8"),
    ]);

    expect(deploymentGuide).toContain("sudo bash infra/deploy-no-docker.sh");
    expect(readme).toContain("sudo bash infra/deploy-no-docker.sh");
  });
});

describe("CRM публикуется атомарно, как и лендинг", () => {
  /**
   * Vite чистит выходной каталог перед сборкой. Пока nginx раздавал
   * webapp/dist напрямую, в этом окне document root был полупустым, а падение
   * сборки после очистки оставляло CRM нерабочей без отката. Проверяем связку
   * «сборка в релиз → симлинк current → nginx смотрит на current».
   */
  test("no-docker деплой собирает CRM через build-webapp.sh, а nginx смотрит на current", async () => {
    const [deploy, buildWebapp, nginx] = await Promise.all([
      readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8"),
      readFile(resolve(root, "infra/build-webapp.sh"), "utf8"),
      readFile(resolve(root, "infra/nginx/no-docker.conf.template"), "utf8"),
    ]);

    expect(deploy).toContain('bash "$ROOT/infra/build-webapp.sh"');
    expect(buildWebapp).toContain('ln -sfn "releases/$ts" "$WEB/current"');
    expect(nginx).toContain("alias {{NOESIS_DEPLOY_DIR}}/webapp/web/current/;");
    expect(nginx).not.toContain("webapp/dist");
  });

  test("сборка CRM не публикует пустой релиз", async () => {
    const buildWebapp = await readFile(resolve(root, "infra/build-webapp.sh"), "utf8");

    expect(buildWebapp).toContain('if [ ! -s "$DIST/index.html" ]');
    expect(buildWebapp).toContain('ls -A "$DIST/assets"');
  });
});

describe("бэкап нацелен на действующий прод (no-docker)", () => {
  /**
   * Скрипт бэкапа был написан под Docker-стек, которого на проде нет: он
   * падал на первой же проверке, то есть резервных копий не существовало.
   * Проверяем статически, что и скрипт, и runbook работают с тем стеком,
   * который реально запущен, — регрессия иначе снова бесшумная.
   */
  test("backup.sh читает no-docker.env и ходит в host PostgreSQL, а не в docker compose", async () => {
    const backup = await readFile(resolve(root, "infra/backup.sh"), "utf8");

    expect(backup).not.toContain("docker compose");
    expect(backup).toContain("infra/no-docker.env");
    expect(backup).toContain("as_postgres pg_dump");
    // Каталог файлов архивируем напрямую — тома контейнера backend нет.
    expect(backup).toContain('tar -C "$FILES_DIR" -czf');
    expect(backup).toContain("NOESIS_FILES_DIR");
  });

  test("runbook восстановления описывает systemd и psql без docker compose", async () => {
    const runbook = await readFile(resolve(root, "docs/backup-restore.md"), "utf8");

    expect(runbook).not.toContain("docker compose");
    expect(runbook).toContain("systemctl stop noesis-backend");
    expect(runbook).toContain("sudo -u postgres psql -v ON_ERROR_STOP=1");
    expect(runbook).toContain("infra/no-docker.env");
  });
});

describe("публичные заголовки и гейт публикации сайта", () => {
  test("nginx закрывает CRM от встраивания и включает HTTP/2", async () => {
    const nginx = await readFile(
      resolve(root, "infra/nginx/no-docker.conf.template"),
      "utf8",
    );

    expect(nginx).toContain("http2 on;");
    expect(nginx).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    expect(nginx).toContain(
      "add_header Content-Security-Policy \"frame-ancestors 'self'\" always;",
    );
    expect(nginx).toContain('add_header Strict-Transport-Security');
    // add_header в location заменяет весь набор с server-уровня, поэтому в
    // /files/ заголовки обязаны быть повторены явно.
    const filesBlock = nginx.slice(
      nginx.indexOf("location /files/ {"),
      nginx.indexOf("location /crm/ {"),
    );
    expect(filesBlock).toContain('add_header X-Content-Type-Options "nosniff" always;');
  });

  test("гейт публикации не пропускает де-индексированный сайт", async () => {
    const build = await readFile(resolve(root, "infra/build-website.sh"), "utf8");

    // Потеря SITE_URL закрывала сайт через robots.txt, и это молча публиковалось.
    expect(build).toContain('grep -q "^Disallow: /$" "$DIST/robots.txt"');
  });

  test("зависимости прода ставятся строго по lockfile", async () => {
    const [deploy, noDockerDeploy] = await Promise.all([
      readFile(resolve(root, "infra/deploy.sh"), "utf8"),
      readFile(resolve(root, "infra/deploy-no-docker.sh"), "utf8"),
    ]);

    for (const script of [deploy, noDockerDeploy]) {
      // Тихий откат на `|| bun install` резолвил версии, которых не видел гейт.
      expect(script).not.toContain("--frozen-lockfile || ");
      expect(script).toContain('if [ "${ALLOW_LOCKFILE_DRIFT:-}" = "1" ]; then');
    }
  });
});
