// Only the server-provisioned login can open the accounting connection.
export function ledgerConnection(dsn: string, projectUrl: string | undefined, poolerHost: string | undefined) {
  try {
    const api = new URL(projectUrl ?? "");
    const ref = /^([a-z0-9]{20})\.supabase\.co$/.exec(api.hostname)?.[1];
    const db = new URL(dsn);
    if (!ref || api.protocol !== "https:" || !["postgresql:", "postgres:"].includes(db.protocol) ||
        !db.password || db.pathname !== "/postgres" || db.search || db.hash ||
        (db.port && db.port !== "5432")) return null;

    const role = "daxenvo_ai_runtime";
    const direct = db.hostname === `db.${ref}.supabase.co` && db.username === role;
    const pooled = db.hostname === poolerHost && /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname) &&
      db.username === `${role}.${ref}`;
    if (!direct && !pooled) return null;
    return {host: db.hostname, port: 5432, database: "postgres", username: db.username,
      password: decodeURIComponent(db.password), ssl: {rejectUnauthorized: true, servername: db.hostname}};
  } catch { return null; }
}
