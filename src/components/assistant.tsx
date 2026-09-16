"use client";
// Assistant state shared by the chat dock, sidebar and command palette:
// chat (with retrieval over your notes), photo OCR auto-sorting, voice recording
// -> summarized note, hands-free voice mode, and an offline outbox.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, resizeImage } from "@/lib/client";
import { markFiled } from "@/lib/highlight";
import { semanticNotes } from "@/lib/search";
import { useStore } from "@/lib/store";
import type { AIAction, ChatMessage, NoteSource, Tab } from "@/lib/types";
import { useToast } from "./ui";

export type UIMessage = ChatMessage & {
  id: string;
  filed?: string[];
  imageUrl?: string;
  error?: boolean;
  queued?: boolean;
  splitTxId?: string; // receipt just filed -> offer "split this bill"
};
export type VoiceState = "off" | "listening" | "thinking" | "speaking";

type Ctx = {
  messages: UIMessage[];
  busy: string | null; // label of the running job
  recording: boolean;
  liveTranscript: string;
  voice: VoiceState;
  queued: number;
  send(text: string): Promise<string | null>;
  scan(file: Blob, source?: NoteSource): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): void;
  toggleVoice(): void;
  clear(): void;
};

const AssistantCtx = createContext<Ctx | null>(null);
export const useAssistant = () => useContext(AssistantCtx)!;

const tabFor = (actions: AIAction[]): Tab | null => {
  const a = actions[0];
  if (!a) return null;
  if (a.type === "add_transaction" || a.type === "set_budget" || a.type === "split_transaction") return "finance";
  if (a.type === "create_todo" || a.type === "complete_todo") return "todo";
  if (a.type === "create_note") return "notes";
  return null;
};

// Minimal typing for the Web Speech API (not in TS DOM lib everywhere).
type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: (e: { error?: string }) => void; onend: () => void; start(): void; stop(): void; abort(): void;
};
const getSpeechRecognition = () => {
  const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return W.SpeechRecognition ?? W.webkitSpeechRecognition;
};

const OUTBOX = "four-notes:outbox";
const readOutbox = (): string[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"); } catch { return []; } };
const writeOutbox = (xs: string[]) => { try { localStorage.setItem(OUTBOX, JSON.stringify(xs)); } catch { /* ignore */ } };
const rid = () => Math.random().toString(36).slice(2);

export function AssistantProvider({ children, onFiled }: { children: ReactNode; onFiled: (tab: Tab) => void }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const toast = useToast();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLive] = useState("");
  const [voice, setVoice] = useState<VoiceState>("off");
  const [queued, setQueued] = useState(0);
  const recRef = useRef<{ media: MediaRecorder; speech: SpeechRec | null; chunks: Blob[]; finalText: string } | null>(null);

  const push = (m: Omit<UIMessage, "id">) => setMessages((xs) => [...xs, { ...m, id: rid() }]);

  const handleResult = useCallback(
    (reply: string, actions: AIAction[], extra?: { imageDataUrl?: string; source?: NoteSource }) => {
      const { filed, transactionIds, created } = storeRef.current.applyActions(actions, extra);
      markFiled(created.map((c) => c.id));
      const isCapture = extra?.source === "ocr" || extra?.source === "share";
      push({ role: "assistant", content: reply, filed, splitTxId: isCapture ? transactionIds[0] : undefined });
      if (filed.length) toast(filed.join("\n"));
      const tab = tabFor(actions);
      if (tab && extra?.source !== "chat") onFiled(tab);
    },
    [toast, onFiled],
  );

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    push({ role: "assistant", content: `⚠️ ${msg}`, error: true });
    toast(msg, "error");
  }, [toast]);

  const send = useCallback(async (text: string): Promise<string | null> => {
    if (!navigator.onLine) {
      push({ role: "user", content: text, queued: true });
      const box = [...readOutbox(), text];
      writeOutbox(box);
      setQueued(box.length);
      toast("You're offline. The message is queued and will be sent when you reconnect.");
      return null;
    }
    const userMsg: UIMessage = { id: rid(), role: "user", content: text };
    const history = [...messagesRef.current.filter((m) => !m.error && !m.queued), userMsg].map(({ role, content }) => ({ role, content }));
    setMessages((xs) => [...xs, userMsg]);
    setBusy("Thinking…");
    try {
      // Retrieval: send the full text of the notes most related to the question.
      const relevant = await semanticNotes(storeRef.current.notes, text, 4).catch(() => []);
      const context = storeRef.current.buildContext(relevant.filter((r) => r.score > 0.2).map((r) => r.note));
      const res = await api.chat(history, context);
      handleResult(res.reply, res.actions, { source: "chat" });
      return res.reply;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  }, [handleResult, fail, toast]);
  const sendRef = useRef(send);
  sendRef.current = send;

  // Offline outbox: flush when the connection comes back (and on startup).
  useEffect(() => {
    if (!store.ready) return;
    setQueued(readOutbox().length);
    const flush = async () => {
      const items = readOutbox();
      if (!items.length || !navigator.onLine) return;
      writeOutbox([]);
      setQueued(0);
      setMessages((xs) => xs.filter((m) => !m.queued));
      for (const t of items) await sendRef.current(t);
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [store.ready]);

  const scan = useCallback(async (file: Blob, source: NoteSource = "ocr") => {
    setBusy("Reading image…");
    try {
      const { blob, dataUrl, thumb } = await resizeImage(file);
      push({ role: "user", content: source === "share" ? "📤 Shared an image" : "📷 Scanned an image", imageUrl: dataUrl });
      const res = await api.captureImage(blob, storeRef.current.buildContext());
      handleResult(res.reply, res.actions, { imageDataUrl: thumb, source });
    } catch (e) { fail(e); } finally { setBusy(null); }
  }, [handleResult, fail]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const state = { media, speech: null as SpeechRec | null, chunks: [] as Blob[], finalText: "" };
      media.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);

      // Live transcription in the browser (fallback when no server STT is set).
      const SR = getSpeechRecognition();
      if (SR) {
        const speech = new SR();
        speech.lang = "en-US";
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) state.finalText += r[0].transcript + " ";
            else interim += r[0].transcript;
          }
          setLive(state.finalText + interim);
        };
        speech.onerror = () => {};
        speech.onend = () => {};
        speech.start();
        state.speech = speech;
      }

      media.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audio = new Blob(state.chunks, { type: media.mimeType || "audio/webm" });
        setBusy("Summarizing recording…");
        push({ role: "user", content: `🎙️ Recording${state.finalText ? `: “${state.finalText.trim().slice(0, 120)}…”` : ""}` });
        try {
          const res = await api.captureAudio(audio, state.finalText.trim(), storeRef.current.buildContext());
          handleResult(res.reply, res.actions, { source: "recording" });
        } catch (e) { fail(e); } finally { setBusy(null); setLive(""); }
      };

      media.start(1000);
      recRef.current = state;
      setRecording(true);
    } catch (e) {
      fail(new Error("Microphone not available: " + (e instanceof Error ? e.message : e)));
    }
  }, [handleResult, fail]);

  const stopRecording = useCallback(() => {
    const s = recRef.current;
    if (!s) return;
    s.speech?.stop();
    // Give speech recognition a moment to deliver its last final result.
    setTimeout(() => s.media.stop(), 400);
    recRef.current = null;
    setRecording(false);
  }, []);

  // ---- Voice mode: listen -> send -> speak reply -> listen again ------------------
  const voiceRef = useRef<{ on: boolean; rec: SpeechRec | null }>({ on: false, rec: null });

  const stopVoice = useCallback(() => {
    voiceRef.current.on = false;
    voiceRef.current.rec?.abort();
    voiceRef.current.rec = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setVoice("off");
    setLive("");
  }, []);

  const listenRef = useRef<() => void>(() => {});
  listenRef.current = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      stopVoice();
      fail(new Error("Voice mode needs speech recognition, available in Chrome, Edge and Safari."));
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    let fatal = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setLive(finalText + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        fatal = true;
        stopVoice();
        fail(new Error("Microphone permission is needed for voice mode."));
      }
    };
    rec.onend = async () => {
      voiceRef.current.rec = null;
      if (!voiceRef.current.on || fatal) return;
      const text = finalText.trim();
      setLive("");
      if (!text) return listenRef.current();
      if (/^(stop|berhenti|selesai|exit|keluar|cukup)[.!]?$/i.test(text)) return stopVoice();
      setVoice("thinking");
      const reply = await sendRef.current(text);
      if (!voiceRef.current.on) return;
      if (reply && storeRef.current.settings.voiceReplies && "speechSynthesis" in window) {
        setVoice("speaking");
        const u = new SpeechSynthesisUtterance(reply.replace(/\s*\(demo mode[^)]*\)/i, "").replace(/[*_#`]/g, "").slice(0, 700));
        u.lang = "en-US";
        u.onend = u.onerror = () => { if (voiceRef.current.on) listenRef.current(); };
        speechSynthesis.speak(u);
      } else {
        listenRef.current();
      }
    };
    voiceRef.current.rec = rec;
    setVoice("listening");
    rec.start();
  };

  const toggleVoice = useCallback(() => {
    if (voiceRef.current.on) return stopVoice();
    if (recRef.current) return toast("Stop the recording first.", "error");
    voiceRef.current.on = true;
    toast("🎧 Voice mode on. Speak naturally; say “stop” to end.");
    listenRef.current();
  }, [stopVoice, toast]);

  useEffect(() => () => { voiceRef.current.on = false; voiceRef.current.rec?.abort(); }, []);

  return (
    <AssistantCtx.Provider
      value={{
        messages, busy, recording, liveTranscript, voice, queued,
        send, scan, startRecording, stopRecording, toggleVoice,
        clear: () => setMessages((xs) => xs.filter((m) => m.queued)),
      }}
    >
      {children}
    </AssistantCtx.Provider>
  );
}
