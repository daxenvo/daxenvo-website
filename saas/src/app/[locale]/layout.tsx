import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/dictionaries";
import { DemoProvider } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <DemoProvider><AppShell>{children}</AppShell></DemoProvider>;
}
