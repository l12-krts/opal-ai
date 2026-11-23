"use client";
// Voice: speak a message and Opal sends it when you stop. Uses the browser's speech recognition
// for the words and the microphone level for the waveform. Hidden where the browser has no
// speech recognition; dictation into the box is left to the OS keyboard.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "krts.ui";
import { t } from "@/lib/i18n";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

const SILENCE_MS = 2200;
const NO_SPEECH_MS = 9000;

export type VoiceState = "idle" | "listening";

type Session = {
  rec: Recognition;
  stream?: MediaStream;
  ctx?: AudioContext;
  cancelled: boolean;
  text: string;
  timer?: ReturnType<typeof setTimeout>;
};

export function useVoice(onFinal: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => Boolean(recognitionCtor()) && Boolean(navigator.mediaDevices?.getUserMedia), () => false);
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const analyser = useRef<AnalyserNode | null>(null);
  const session = useRef<Session | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const teardown = useCallback(() => {
    const s = session.current;
    if (!s) return;
    clearTimeout(s.timer);
    s.stream?.getTracks().forEach((tr) => tr.stop());
    void s.ctx?.close().catch(() => {});
    analyser.current = null;
    session.current = null;
    setState("idle");
    setTranscript("");
  }, []);

  const finish = useCallback(() => {
    session.current?.rec.stop();
  }, []);

  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.cancelled = true;
    s.rec.abort();
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor || session.current) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    const s: Session = { rec, cancelled: false, text: "" };
    session.current = s;
    setState("listening");

    const arm = (ms: number) => {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => rec.stop(), ms);
    };

    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      s.text = `${finalText}${interim}`.replace(/\s+/g, " ").trim();
      setTranscript(s.text);
      arm(SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        s.cancelled = true;
        toast.error(t("composer.voiceBlocked"), { description: t("composer.voiceBlockedHint") });
      }
    };
    rec.onend = () => {
      const text = s.text;
      const cancelled = s.cancelled;
      teardown();
      if (cancelled) return;
      if (text) onFinalRef.current(text);
      else toast(t("composer.voiceNothing"));
    };

    try {
      rec.start();
    } catch {
      teardown();
      return;
    }
    arm(NO_SPEECH_MS);

    // Microphone level for the waveform. If it fails, recognition still works without bars.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (session.current !== s) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(node);
      s.stream = stream;
      s.ctx = ctx;
      analyser.current = node;
    } catch {
      // ignore: bars stay at rest
    }
  }, [teardown]);

  useEffect(() => cancel, [cancel]);

  return { supported, state, transcript, analyser, start, finish, cancel };
}
