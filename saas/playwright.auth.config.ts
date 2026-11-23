import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const testWriter = "bc".repeat(32);

export default defineConfig({
  ...base,
  testDir: "./auth-tests",
  use: { ...base.use, baseURL: "http://127.0.0.1:3128" },
  webServer: [
    {
      command: "node auth-tests/provider.mjs",
      env: { QUALIFICATION_WRITER_TOKEN: testWriter },
      url: "http://127.0.0.1:3129/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run start -- --port 3128",
      url: "http://127.0.0.1:3128/connexion",
      reuseExistingServer: false,
      env: {
        QUALIFICATION_WRITER_TOKEN: testWriter,
        SUPABASE_URL: "http://127.0.0.1:3129",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture",
      },
    },
  ],
});
