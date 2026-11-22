import { notFound } from "next/navigation";
import { isLocale, isSection, getDictionary } from "@/lib/i18n/dictionaries";
import { WorkspaceScreen } from "@/components/workspace-screen";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; section: string }>;
}) {
  const { locale, section } = await params;
  if (!isLocale(locale) || !isSection(section)) return {};
  return { title: getDictionary(locale).navigation[section] };
}
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; section: string }>;
}) {
  const { locale, section } = await params;
  if (!isLocale(locale) || !isSection(section)) notFound();
  return <WorkspaceScreen section={section} />;
}
