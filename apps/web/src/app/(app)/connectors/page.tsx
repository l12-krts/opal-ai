import { redirect } from "next/navigation";

// Kept for old links and for sign-ins that started before connectors moved into Settings.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const connected = typeof sp.connected === "string" ? `?connected=${encodeURIComponent(sp.connected)}` : "";
  redirect(`/customization/connectors${connected}`);
}
