import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { responseSession } from "@/lib/supabase/response";
import {
  activeCompanyCookie,
  errorCode,
  memberships,
  selectCompany,
  verifiedUser,
} from "@/lib/supabase/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ operation: string }> },
) {
  const session = responseSession(request);
  const redirect = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });
  const { operation } = await params;
  if (
    request.headers.get("origin") !==
    request.nextUrl.protocol + "//" + request.headers.get("host")
  )
    return session.finish(new NextResponse("Origine refusée", { status: 403 }));
  if (!["connexion", "deconnexion", "entreprise"].includes(operation))
    return session.finish(new NextResponse(null, { status: 404 }));
  if (
    request.headers.get("content-type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    return session.finish(new NextResponse(null, { status: 415 }));
  const clearCompany = (response: NextResponse) => {
    response.cookies.delete(activeCompanyCookie);
    return session.finish(response);
  };
  try {
    const client = session.client();
    if (operation === "deconnexion") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return session.finish(redirect("/connexion?etat=UNAVAILABLE"));
      return clearCompany(redirect("/connexion"));
    }
    const form = await request.formData();
    if (operation === "connexion") {
      const email = z.email().max(320).safeParse(form.get("email"));
      const password = z
        .string()
        .min(1)
        .max(4096)
        .safeParse(form.get("password"));
      if (!email.success || !password.success)
        return session.finish(redirect("/connexion?etat=INVALID"));
      const { data, error } = await client.auth.signInWithPassword({
        email: email.data,
        password: password.data,
      });
      if (error || !data.session) {
        const state =
          error?.code === "invalid_credentials" ? "INVALID" : "UNAVAILABLE";
        return session.finish(redirect("/connexion?etat=" + state));
      }
      await verifiedUser(client);
      return clearCompany(redirect("/espace"));
    }
    const user = await verifiedUser(client);
    const candidate = z.uuid().safeParse(form.get("company_id"));
    if (!candidate.success)
      return session.finish(redirect("/espace?etat=FORBIDDEN"));
    const company = selectCompany(
      await memberships(client, user.id),
      candidate.data,
    );
    const response = redirect("/espace");
    response.cookies.set(activeCompanyCookie, company.company_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return session.finish(response);
  } catch (error) {
    const state = errorCode(error);
    return session.finish(
      redirect(
        state === "FORBIDDEN"
          ? "/espace?etat=FORBIDDEN"
          : "/connexion?etat=" + state,
      ),
    );
  }
}
