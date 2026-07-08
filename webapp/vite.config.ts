import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/crm/" — CRM обслуживается на этом подпути за nginx (см. infra/nginx).
export default defineConfig({
  base: "/crm/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Вендоры — в отдельные стабильные чанки: реже меняются, лучше кешируются
        // и не раздувают основной бандл (вместе с lazy-разделами это убирает
        // предупреждение vite о чанке >500 КБ). Делим по пути в node_modules —
        // надёжнее списка имён при isolated-линковке Bun (реальные пути в .bun/).
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@tanstack")) return "query";
          if (id.includes("@dnd-kit")) return "dnd";
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          return "vendor";
        },
      },
    },
  },
});
