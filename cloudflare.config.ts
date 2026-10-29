import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "aoqi-update-mirrors",
    "compatibilityDate": "2026-10-29",
    "domains": ["update-cf.howe.wang"],
    "observability": {
      "enabled": false
    }
  }
});
