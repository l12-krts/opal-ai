import { ThreadView } from "@/components/code/thread-view";

export default async function CodeThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ThreadView key={id} id={id} />;
}
