import type { Project } from "@noesis/contracts";
import { api } from "../api/client";

export async function listProjectOptions(): Promise<Project[]> {
  const pageSize = 100;
  const first = await api.listProjects({ page: 1, pageSize });
  const items = [...first.items];
  let page = 2;
  while (items.length < first.total) {
    const next = await api.listProjects({ page, pageSize });
    if (next.items.length === 0) break;
    items.push(...next.items);
    page += 1;
  }
  return items;
}
