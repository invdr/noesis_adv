import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser, SessionUser, UserRole } from "@noesis/contracts";
import { api } from "../api/client";
import { copyToClipboard } from "../ui/clipboard";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
};

const USERS_KEY = ["users"];

/**
 * Управление учётками (admin). Создание с генерируемым паролем (показ разово),
 * смена роли/email, блокировка/разблокировка, сброс пароля. Действия над
 * собственной учёткой ограничены (роль/блокировка/сброс недоступны).
 */
export function UsersView({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => api.listUsers(),
    retry: false,
  });

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("manager");
  const [error, setError] = useState("");
  // Сгенерированный пароль для показа админу один раз.
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const onError = (e: unknown) => setError((e as Error).message);
  const clearError = () => setError("");

  const create = useMutation({
    mutationFn: () =>
      api.createUser({
        email: newEmail.trim(),
        name: newName.trim() || undefined,
        role: newRole,
      }),
    onSuccess: (res) => {
      setSecret({ email: res.user.email, password: res.password });
      setNewEmail("");
      setNewName("");
      setNewRole("manager");
      clearError();
      refresh();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: (v: { id: string; input: Parameters<typeof api.updateUser>[1] }) =>
      api.updateUser(v.id, v.input),
    onSuccess: () => {
      clearError();
      refresh();
    },
    onError,
  });

  const block = useMutation({
    mutationFn: (id: string) => api.blockUser(id),
    onSuccess: () => {
      clearError();
      refresh();
    },
    onError,
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api.unblockUser(id),
    onSuccess: () => {
      clearError();
      refresh();
    },
    onError,
  });

  const reset = useMutation({
    mutationFn: (id: string) => api.resetUserPassword(id),
    onSuccess: (res, id) => {
      const u = users.data?.find((x) => x.id === id);
      setSecret({ email: u?.email ?? "", password: res.password });
      clearError();
      refresh();
    },
    onError,
  });

  const changeRole = (u: AdminUser, role: UserRole) => {
    if (role === u.role) return;
    if (role === "admin" && u.activeLeadCount > 0) {
      if (
        !window.confirm(
          `Повышение в администраторы вернёт ${u.activeLeadCount} активных заявок в общую очередь. Продолжить?`,
        )
      ) {
        return;
      }
    }
    update.mutate({ id: u.id, input: { role } });
  };

  const doBlock = (u: AdminUser) => {
    const warn =
      u.activeLeadCount > 0
        ? ` ${u.activeLeadCount} активных заявок вернутся в общую очередь.`
        : "";
    if (
      window.confirm(
        `Заблокировать ${u.email}? Его сессии будут прекращены, вход станет невозможен.${warn}`,
      )
    ) {
      block.mutate(u.id);
    }
  };

  const doReset = (u: AdminUser) => {
    if (
      window.confirm(
        `Сбросить пароль для ${u.email}? Будет сгенерирован новый пароль, а текущие сессии пользователя прекращены.`,
      )
    ) {
      reset.mutate(u.id);
    }
  };

  if (users.isLoading) return <p className="hint">Загрузка…</p>;
  if (users.error) {
    return <p className="alert alert-error">{(users.error as Error).message}</p>;
  }

  const list = users.data ?? [];

  return (
    <section>
      <p className="hint">
        Учётные записи CRM. Пароль создаётся системой и показывается один раз — передайте
        его сотруднику; при первом входе он сменит пароль. Удаления нет — только
        блокировка. Последнего активного администратора нельзя заблокировать или
        разжаловать. Telegram chat id — для личных уведомлений о назначении заявки:
        менеджер сам пишет боту (иначе бот не сможет ему написать), id узнаётся через
        @userinfobot.
      </p>

      {secret && (
        <div className="alert alert-ok" role="status" style={{ padding: "0.85rem 1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Пароль для {secret.email} (показывается один раз):
          </div>
          <code style={{ fontSize: 15, userSelect: "all" }}>{secret.password}</code>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn-sm" onClick={() => void copyToClipboard(secret.password)}>
              Скопировать
            </button>
            <button className="btn-sm" onClick={() => setSecret(null)}>
              Скрыть
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>Email</th>
              <th style={{ width: 190 }}>Имя (ФИО)</th>
              <th style={{ width: 150 }}>Telegram chat id</th>
              <th style={{ width: 160 }}>Роль</th>
              <th style={{ width: 120 }}>Статус</th>
              <th style={{ width: 110 }}>Активных заявок</th>
              <th style={{ width: 230 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const isSelf = u.id === user.id;
              return (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {isSelf && <span className="subtle"> (вы)</span>}
                    {u.mustChangePassword && (
                      <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                        сменит пароль
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      defaultValue={u.name ?? ""}
                      placeholder="ФИО"
                      aria-label={`Имя пользователя ${u.email}`}
                      disabled={update.isPending}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name !== (u.name ?? "")) {
                          update.mutate({ id: u.id, input: { name } });
                        }
                      }}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={u.telegramChatId ?? ""}
                      placeholder="chat id"
                      aria-label={`Telegram chat id для ${u.email}`}
                      disabled={update.isPending}
                      onBlur={(e) => {
                        const chat = e.target.value.trim();
                        if (chat !== (u.telegramChatId ?? "")) {
                          update.mutate({ id: u.id, input: { telegramChatId: chat } });
                        }
                      }}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td>
                    <select
                      value={u.role}
                      disabled={isSelf || update.isPending}
                      onChange={(e) => changeRole(u, e.target.value as UserRole)}
                    >
                      {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {u.isActive ? (
                      <span className="badge badge-success">активен</span>
                    ) : (
                      <span className="badge badge-danger">заблокирован</span>
                    )}
                  </td>
                  <td className="tnum">{u.activeLeadCount}</td>
                  <td>
                    <span className="row wrap" style={{ gap: 6 }}>
                      {u.isActive ? (
                        <button className="btn-sm" disabled={isSelf} onClick={() => doBlock(u)}>
                          Заблокировать
                        </button>
                      ) : (
                        <button className="btn-sm" onClick={() => unblock.mutate(u.id)}>
                          Разблокировать
                        </button>
                      )}
                      <button className="btn-sm" disabled={isSelf} onClick={() => doReset(u)}>
                        Сбросить пароль
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newEmail.trim()) create.mutate();
        }}
        className="toolbar"
        style={{ marginTop: "1rem" }}
      >
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="Email нового пользователя"
          style={{ minWidth: 240 }}
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="ФИО (необязательно)"
          style={{ minWidth: 200 }}
        />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          Создать
        </button>
      </form>
    </section>
  );
}
