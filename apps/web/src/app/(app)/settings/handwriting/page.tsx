"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Button, Segment, SegmentedControl, Skeleton, TextAreaField, TextField, cn, toast } from "krts.ui";
import { IconCheck, IconPlus, IconPrinter, IconTrash, IconUpload } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import { PAGE_COUNT } from "@/lib/handwriting/template";
import { HandwritingView } from "@/components/handwriting-view";
import { Confirm, IconButton } from "@/components/ui";
import { Group, Row, SettingsPage } from "@/components/settings-ui";

type Profile = { id: string; name: string; glyphCount: number };

const SAMPLE = `# Φωτοσύνθεση

Η **φωτοσύνθεση** μετατρέπει το φως σε χημική ενέργεια.

- Γίνεται στους χλωροπλάστες
- Χρειάζεται νερό, CO2 και φως

| Είσοδος | Έξοδος |
| --- | --- |
| CO2 + H2O | Γλυκόζη + O2 |

\`\`\`chart
{"type":"bar","title":"Ρυθμός ανά ώρα","labels":["9:00","12:00","15:00","18:00"],"values":[4,9,7,2]}
\`\`\``;

export default function HandwritingSettingsPage() {
  const { data, mutate, isLoading } = useSWR<{ profiles: Profile[] }>("/api/handwriting/profiles", fetcher);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const profiles = data?.profiles ?? [];
  const active = profiles.find((p) => p.id === selected) ?? profiles[0];

  async function create() {
    if (!newName.trim()) return;
    try {
      const { profile } = await apiFetch<{ profile: Profile }>("/api/handwriting/profiles", { method: "POST", json: { name: newName.trim() } });
      setNewName("");
      await mutate();
      setSelected(profile.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <SettingsPage title="Handwriting" info="Teach Opal your handwriting once. Any chat or agent can then write notes, tables and charts in it." wide>
      <div className="grid gap-7 lg:grid-cols-2">
        <Group title="Profiles">
          {isLoading && (
            <div className="p-3">
              <Skeleton className="h-9" />
            </div>
          )}
          {profiles.map((p) => {
            const on = active?.id === p.id;
            return (
              <div key={p.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => setSelected(p.id)}
                  aria-pressed={on}
                  className="pressable min-w-0 flex-1 text-left hover:bg-surface/60"
                >
                  <Row
                    icon={<IconCheck size={16} stroke={2} className={cn("transition-opacity", on ? "opacity-100" : "opacity-0")} />}
                    label={p.name}
                    sub={`${p.glyphCount} letters`}
                  />
                </button>
                <div className="pr-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <IconButton label={`Delete ${p.name}`} onPress={() => setDeleting(p)}>
                    <IconTrash size={15} stroke={1.5} />
                  </IconButton>
                </div>
              </div>
            );
          })}
          <form
            className="flex items-center gap-2 px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField size="sm" aria-label="New profile name" placeholder="New profile" value={newName} onChange={setNewName} className="flex-1" />
            <Button size="sm" type="submit" variant="secondary" isIconOnly aria-label="Add profile" isDisabled={!newName.trim()}>
              <IconPlus size={15} stroke={1.75} />
            </Button>
          </form>
        </Group>

        {active && <Setup profile={active} onChanged={() => mutate()} />}
      </div>

      <Playground profileId={active && active.glyphCount > 20 ? active.id : null} />

      <Confirm
        isOpen={Boolean(deleting)}
        onOpenChange={(o: boolean) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "profile"}?`}
        description="Its letters are deleted too."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await apiFetch(`/api/handwriting/profiles/${deleting.id}`, { method: "DELETE" });
          if (selected === deleting.id) setSelected(null);
          setDeleting(null);
          await mutate();
        }}
      />
    </SettingsPage>
  );
}

function Setup({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  return (
    <Group title={`Set up ${profile.name}`}>
      <Row label="1. Print" info={`${PAGE_COUNT} pages with every Greek and Latin letter, digit and symbol. Print at 100% on A4.`}>
        {Array.from({ length: PAGE_COUNT }, (_, i) => (
          <a
            key={i}
            href={`/api/handwriting/template?page=${i + 1}`}
            target="_blank"
            rel="noopener"
            aria-label={`Print page ${i + 1}`}
            className="pressable inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] hover:bg-surface-hover"
          >
            <IconPrinter size={14} stroke={1.5} />
            {i + 1}
          </a>
        ))}
      </Row>
      <Row label="2. Upload" info="Dark pen, one character per box on the dotted line. Photograph from above in good light with all four corner squares in frame.">
        {Array.from({ length: PAGE_COUNT }, (_, i) => (
          <PageUpload key={i} profileId={profile.id} page={i + 1} onDone={onChanged} />
        ))}
      </Row>
    </Group>
  );
}

const MAX_EDGE = 4000;

/**
 * Phone photos are often 10+ MB and 50+ MP, far more than the sheet needs. Scale them down to
 * a 4000 px long edge (as a JPEG) before upload. The browser applies the photo's EXIF rotation
 * while decoding. Anything it can't decode is sent as is and the server explains the problem.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 8 * 1024 * 1024) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    return out ?? file;
  } catch {
    return file;
  }
}

function PageUpload({ profileId, page, onDone }: { profileId: string; page: number; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          const fd = new FormData();
          fd.append("image", await shrinkPhoto(file));
          try {
            const r = await apiFetch<{ found: number; missing: string[]; markers: string }>(`/api/handwriting/profiles/${profileId}/pages/${page}`, { method: "POST", body: fd });
            toast.success(`Page ${page}: ${r.found} letters`, {
              description: [
                r.missing.length ? `Missing ${r.missing.slice(0, 10).join(" ")}${r.missing.length > 10 ? "…" : ""}` : "",
                r.markers === "edges" ? "Corner squares not found; used the photo's edges." : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined,
            });
            onDone();
          } catch (err) {
            toast.error(`Page ${page}`, { description: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        size="xs"
        variant="secondary"
        isPending={busy}
        aria-label={`Upload page ${page}`}
        startContent={<IconUpload size={14} stroke={1.5} />}
        onPress={() => input.current?.click()}
      >
        {page}
      </Button>
    </>
  );
}

function Playground({ profileId }: { profileId: string | null }) {
  const [text, setText] = useState(SAMPLE);
  const [rendered, setRendered] = useState(SAMPLE);
  const [paper, setPaper] = useState<"lined" | "grid" | "blank">("lined");
  const [ink, setInk] = useState<"blue" | "black" | "darkblue">("blue");

  return (
    <Group
      title="Try it"
      info={`${profileId ? "Uses your handwriting." : "No finished profile yet, so a stand-in hand is used."} Markdown, tables and chart blocks work.`}
      bare
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <TextAreaField aria-label="Text to write" rows={15} value={text} onChange={setText} className="font-mono text-[13px]" />
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm" selectedKeys={[paper]} onSelectionChange={(k) => setPaper([...k][0] as typeof paper)} aria-label="Paper">
              <Segment id="lined">Lined</Segment>
              <Segment id="grid">Grid</Segment>
              <Segment id="blank">Blank</Segment>
            </SegmentedControl>
            <SegmentedControl size="sm" selectedKeys={[ink]} onSelectionChange={(k) => setInk([...k][0] as typeof ink)} aria-label="Ink">
              <Segment id="blue">Blue</Segment>
              <Segment id="darkblue">Navy</Segment>
              <Segment id="black">Black</Segment>
            </SegmentedControl>
            <Button size="sm" variant="primary" className="ml-auto" onPress={() => setRendered(text)}>
              Write it
            </Button>
          </div>
        </div>
        <HandwritingView markdown={rendered} profileId={profileId} paper={paper} ink={ink} title="Opal handwriting" />
      </div>
    </Group>
  );
}
