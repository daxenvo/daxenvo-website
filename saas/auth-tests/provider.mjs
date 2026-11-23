// Double HTTP réservé aux tests Playwright, lancé sur la boucle locale.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { businessReply } from "./business-provider.mjs";

const accounts = new Map(
  ["alice", "bob", "isolated", "offline"].map((name) => [
    name,
    { id: randomUUID(), email: name + "@example.invalid" },
  ]),
);
const alpha = "20000000-0000-4000-8000-000000000001";
const beta = "20000000-0000-4000-8000-000000000002";
const sessions = new Map();
function issue(user) {
  const access_token = randomUUID();
  const refresh_token = randomUUID();
  const session = {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    user,
  };
  sessions.set(access_token, session);
  return session;
}
createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const reply = (status, value) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/health") return reply(200, {});
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = body ? JSON.parse(body) : {};
  if (url.pathname === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "password") {
      const user = [...accounts.values()].find(
        (account) => account.email === input.email,
      );
      if (user && input.password === "test-only")
        return reply(200, issue(user));
      return reply(400, {
        error_code: "invalid_credentials",
        msg: "Invalid credentials",
      });
    }
    const old = [...sessions.values()].find(
      (s) => s.refresh_token === input.refresh_token,
    );
    if (!old)
      return reply(400, {
        error_code: "refresh_token_not_found",
        msg: "Expired",
      });
    sessions.delete(old.access_token);
    return reply(200, issue(old.user));
  }
  const session = sessions.get(
    request.headers.authorization?.replace(/^Bearer /, ""),
  );
  if (!session)
    return reply(401, { error_code: "bad_jwt", msg: "Unknown session" });
  if (url.pathname === "/auth/v1/user") return reply(200, session.user);
  if (url.pathname === "/auth/v1/logout") {
    sessions.delete(session.access_token);
    return reply(204, null);
  }
  if (
    url.pathname === "/rest/v1/company_memberships" &&
    url.searchParams.get("user_id") === "eq." + session.user.id
  ) {
    const member = (company_id, name, role) => ({
      company_id,
      role,
      companies: { name },
    });
    switch (session.user.email.split("@")[0]) {
      case "offline":
        return reply(403, { code: "42501", message: "Unavailable" });
      case "isolated":
        return reply(200, []);
      case "alice":
        return reply(200, [
          member(alpha, "Entreprise Alpha", "admin"),
          member(beta, "Entreprise Beta", "owner"),
        ]);
      case "bob":
        return reply(200, [member(beta, "Entreprise Beta", "member")]);
    }
  }
  if (url.pathname.startsWith("/rest/v1/")) return businessReply(request, url, input, reply, session.user.id);
  return reply(404, {});
}).listen(3129, "127.0.0.1");
