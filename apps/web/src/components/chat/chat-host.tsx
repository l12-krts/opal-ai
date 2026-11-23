"use client";

import { Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nanoid } from "nanoid";
import { ChatView } from "./chat-view";

function Host() {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const routeId = /^\/c\/([A-Za-z0-9_-]+)$/.exec(pathname)?.[1];
  // Agents have one thread each, in the Agents tab. Old links like /?agent=<id> go there.
  const agentId = sp.get("agent");
  useEffect(() => {
    if (agentId && /^[A-Za-z0-9_-]{8,40}$/.test(agentId)) router.replace(`/agents/${agentId}`);
  }, [agentId, router]);
  const mode = sp.get("mode") === "study" ? "study" : "chat";
  const q = sp.get("q")?.slice(0, 4000) ?? undefined;
  const draftKey = `${sp.get("new") ?? ""}|${mode}`;
  const draft = useRef<{ key: string; id: string; sent?: boolean } | null>(null);

  // Once a draft was sent its URL is /c/<id>. After leaving that URL it is a saved chat like any
  // other: coming back must load it, not show it as an empty draft.
  if (draft.current) {
    if (routeId === draft.current.id) draft.current.sent = true;
    else if (draft.current.sent) draft.current = null;
  }
  if (!routeId && (!draft.current || draft.current.key !== draftKey)) {
    draft.current = { key: draftKey, id: nanoid() };
  }
  // After the first message a draft's URL becomes /c/<draft id>; same id keeps the same instance.
  const id = routeId ?? draft.current!.id;
  const isDraft = draft.current?.id === id;

  if (agentId) return null;
  return <ChatView key={id} id={id} isNew={isDraft} initialMode={mode} autoPrompt={isDraft ? q : undefined} />;
}

const subscribe = () => () => {};

export function ChatHost() {
  // Client-only: drafts get random ids, so a server render could never match.
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return null;
  return (
    <Suspense fallback={null}>
      <Host />
    </Suspense>
  );
}
