import { UnlockForm } from "./unlock-form";

export const metadata = { title: "Unlock" };

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <UnlockForm next={next ?? "/"} />
    </main>
  );
}
