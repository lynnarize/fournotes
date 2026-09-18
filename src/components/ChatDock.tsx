"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBackDismiss } from "@/lib/backstack";
import { markFiled } from "@/lib/highlight";
import { showChange } from "@/lib/nav";
import type { ChangeLink } from "@/lib/store";
import { useAssistant } from "./assistant";
import ScanPicker from "./ScanPicker";
import SplitEditor from "./SplitEditor";
import { Icon, Modal, TypingDots } from "./ui";

const SUGGESTIONS = [
  "Remind me to pay rent of 2.5M every month on the 5th at 9am",
  "Spent 45k on lunch at Warteg, split with Andi",
  "Set my food budget to 1.5M a month",
  "Where did I write about the Bali trip?",
  "What did I spend most on this month?",
];

/** Free models often reply in Markdown: show **bold** as bold instead of asterisks. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold">{p}</strong> : p))}</>;
}

const VOICE_LABEL = { off: "", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" } as const;

// Every control in the input row is the same 40px square so icons line up with
// the text box (which is also 40px tall for a single line).
const ICON_BTN = "grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40";
const GHOST = `${ICON_BTN} fn-press text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]`;
const MAX_INPUT_HEIGHT = 160;

export default function ChatDock() {
  const { messages, busy, recording, liveTranscript, voice, queued, send, scan, startRecording, stopRecording, toggleVoice, clear } = useAssistant();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [splitTx, setSplitTx] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useBackDismiss(open, () => setOpen(false));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length) setOpen(true);
  }, [messages.length]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  // Phones get a shorter placeholder so it never wraps inside the box.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Grow the text box with its content, up to a limit, then scroll inside it.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Empty: stay one line. (Chrome counts a wrapping placeholder in scrollHeight.)
    if (!text) {
      el.style.height = "";
      el.style.overflowY = "hidden";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [text, narrow]);

  // "/" anywhere outside a text field focuses the chat box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Jump to what the assistant changed: close the panel so the item isn't hidden behind it.
  const jump = (link: ChangeLink, all: ChangeLink[] = []) => {
    if (!link) return;
    markFiled(all.filter((l): l is NonNullable<ChangeLink> => Boolean(l)).map((l) => l.id));
    setOpen(false);
    inputRef.current?.blur();
    showChange(link);
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    send(t);
  };

  return (
    <div className="no-print pointer-events-none sticky bottom-0 z-20 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 sm:px-4">
      <div className="pointer-events-auto mx-auto max-w-4xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow)]">
        {/* Always mounted so it can expand and collapse smoothly; inert while closed. */}
        <div className="fn-collapse" data-open={open} inert={!open} aria-hidden={!open}>
          <div>
            <div className="border-b border-[var(--line)]">
              <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-[var(--muted)]">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon name="sparkle" size={16} className="text-[var(--accent)]" /> Assistant
                  {queued > 0 && <span className="chip ml-1"><Icon name="wifiOff" size={11} />{queued} queued</span>}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm sm:hidden ${voice !== "off" ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--hover)]"}`}
                    onClick={toggleVoice}
                    disabled={recording}
                  >
                    <Icon name="wave" size={16} /> {voice !== "off" ? "End voice" : "Voice"}
                  </button>
                  {messages.length > 0 && <button className="h-8 rounded-lg px-2.5 text-sm hover:bg-[var(--hover)]" onClick={clear}>Clear</button>}
                  <button className="fn-press grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--hover)] sm:h-8 sm:w-8" onClick={() => setOpen(false)} aria-label="Collapse chat">
                    <Icon name="x" size={16} />
                  </button>
                </span>
              </div>
              <div ref={listRef} className="scroll-thin max-h-[min(55vh,560px)] space-y-3 overflow-y-auto px-4 pb-4" aria-live="polite">
                {messages.length === 0 && (
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--line)] px-3.5 py-1.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`fn-rise flex ${m.role === "user" ? "justify-end" : ""}`}>
                    <div
                      className={`max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
                        m.role === "user" ? "bg-[var(--hover)]" : m.error ? "text-[var(--danger)]" : ""
                      } ${m.queued ? "opacity-60" : ""}`}
                    >
                      {m.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt="" className="mb-2 max-h-48 rounded-md" />
                      )}
                      {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                      {m.queued && <div className="mt-1 text-xs text-[var(--muted)]">Waiting for connection…</div>}
                      {m.filed && m.filed.length > 0 && (() => {
                        const links = m.links ?? [];
                        const targets = links.filter(Boolean);
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {m.filed.map((f, i) =>
                              links[i] ? (
                                <button
                                  key={i}
                                  className="chip fn-pop fn-press min-h-8 cursor-pointer hover:bg-[var(--hover)] hover:text-[var(--text)]"
                                  style={{ animationDelay: `${i * 70}ms` }}
                                  onClick={() => jump(links[i])}
                                  title="Show this"
                                >
                                  {f}
                                </button>
                              ) : (
                                <span key={i} className="chip fn-pop min-h-8" style={{ animationDelay: `${i * 70}ms` }}>{f}</span>
                              ),
                            )}
                            {targets.length > 0 && (
                              <button
                                className="fn-pop fn-nudge fn-press flex min-h-8 items-center gap-1 rounded-full bg-[var(--accent)] px-3 text-xs font-medium text-white"
                                style={{ animationDelay: `${m.filed.length * 70 + 80}ms` }}
                                onClick={() => jump(targets[0], targets)}
                              >
                                {targets.length === 1 ? "Show" : `Show changes (${targets.length})`}
                                <Icon name="arrowRight" size={13} />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      {m.splitTxId && (
                        <button className="fn-pop fn-press mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm hover:bg-[var(--hover)]" onClick={() => setSplitTx(m.splitTxId!)}>
                          <Icon name="users" size={14} /> Split this bill with someone?
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <TypingDots label={busy} />}
              </div>
            </div>
          </div>
        </div>

        {(recording || voice !== "off") && (
          <div className="fn-rise flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 text-sm text-[var(--muted)]">
            <span className={`shrink-0 font-medium ${recording ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
              {recording ? "● Recording" : `🎧 ${VOICE_LABEL[voice]}`}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {liveTranscript || (recording ? "Listening… tap stop when you're done." : voice === "listening" ? "Say something, or “stop” to end." : "")}
            </span>
            {voice !== "off" && <button className="h-8 shrink-0 rounded-lg px-2.5 hover:bg-[var(--hover)]" onClick={toggleVoice}>End</button>}
          </div>
        )}

        <div className="flex items-end gap-1.5 p-2.5">
          <ScanPicker onFile={scan}>
            {(pick) => (
              <button className={GHOST} title="Scan a receipt, note or e-wallet screenshot" aria-label="Scan" onClick={pick} disabled={!!busy}>
                <Icon name="scan" size={20} />
              </button>
            )}
          </ScanPicker>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onFocus={() => setOpen(true)}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
              if (img) { e.preventDefault(); scan(img); }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={narrow ? "Ask or add anything…" : "Ask, add a task, log spending, or paste an app notification…"}
            aria-label="Message the assistant"
            className="input-plain block h-10 min-h-10 min-w-0 flex-1 resize-none overflow-hidden py-[9px] text-[15px] leading-[22px]"
          />
          <button
            className={`${voice !== "off" ? `${ICON_BTN} recording bg-[var(--accent)] text-white` : GHOST} hidden sm:grid`}
            title={voice !== "off" ? "End voice mode" : "Voice mode (hands-free)"}
            aria-label={voice !== "off" ? "End voice mode" : "Voice mode"}
            onClick={toggleVoice}
            disabled={recording}
          >
            <Icon name="wave" size={20} />
          </button>
          <button
            className={recording ? `${ICON_BTN} fn-press recording bg-[var(--danger)] text-white` : GHOST}
            title={recording ? "Stop and summarize" : "Record voice note"}
            aria-label={recording ? "Stop recording" : "Record voice note"}
            onClick={recording ? stopRecording : startRecording}
            disabled={(!!busy && !recording) || voice !== "off"}
          >
            <Icon name={recording ? "stop" : "mic"} size={20} />
          </button>
          <button
            className={`${ICON_BTN} fn-press bg-[var(--text)] text-[var(--bg)] disabled:opacity-30`}
            onClick={submit}
            disabled={!text.trim() || !!busy}
            aria-label="Send"
          >
            <Icon name="send" size={20} />
          </button>
        </div>
      </div>

      <div className="pointer-events-auto">
        <Modal open={!!splitTx} onClose={() => setSplitTx(null)} title="Split bill">
          <div className="p-4">{splitTx && <SplitEditor txId={splitTx} />}</div>
        </Modal>
      </div>
    </div>
  );
}
