import { redirect } from "next/navigation";

// Connectors moved to Customization.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const connected = typeof sp.connected === "string" ? `?connected=${encodeURIComponent(sp.connected)}` : "";
  redirect(`/customization/connectors${connected}`);
}
