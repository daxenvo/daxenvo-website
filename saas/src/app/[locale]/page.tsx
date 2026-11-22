import { redirect, notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/dictionaries";
export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}/tableau-de-bord`);
}
