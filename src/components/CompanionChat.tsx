"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendCompanionMessage, startDailyCompanionChat } from "@/lib/actions";

interface Message {
  sender: "member" | "companion";
  text: string;
  riskFlag?: boolean;
}

export default function CompanionChat({
  initialMessages,
  greeting,
  contextType,
  doneHref,
  doneLabel,
  autoStartDaily,
}: {
  initialMessages: Message[];
  greeting: string;
  /** Conversation purpose, e.g. "onboarding" — shapes how the companion behaves. */
  contextType?: string;
  /** When set, shows a button to leave the chat and continue (used in onboarding). */
  doneHref?: string;
  doneLabel?: string;
  /** Open (or resume) today's post-check-in chat with the companion speaking first. */
  autoStartDaily?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.length > 0
      ? initialMessages
      : autoStartDaily
        ? []
        : [{ sender: "companion", text: greeting }]
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showRiskBanner, setShowRiskBanner] = useState(false);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!autoStartDaily || autoStarted.current) return;
    autoStarted.current = true;
    startTransition(async () => {
      const res = await startDailyCompanionChat();
      setConversationId(res.conversationId);
      setMessages(res.messages.map((m) => ({ sender: m.sender, text: m.text, riskFlag: m.riskFlag })));
      if (res.messages.some((m) => m.riskFlag)) setShowRiskBanner(true);
    });
  }, [autoStartDaily]);

  const send = () => {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setMessages((m) => [...m, { sender: "member", text }]);
    startTransition(async () => {
      const res = await sendCompanionMessage(conversationId, text, contextType);
      setConversationId(res.conversationId);
      setMessages((m) => [...m, { sender: "companion", text: res.reply, riskFlag: res.riskFlag }]);
      if (res.riskFlag) setShowRiskBanner(true);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  };

  return (
    <div className="flex flex-col">
      {showRiskBanner && (
        <div className="mb-4 rounded-3xl border border-support/50 bg-support/10 p-5">
          <p className="font-semibold text-support-deep">Support beyond this chat</p>
          <p className="mt-1 text-sm text-ground/90">
            Your companion can&apos;t provide crisis care. Please use the crisis page now — it has
            one step at a time, and your care team has been notified.
          </p>
          <a
            href="/crisis?from=companion"
            className="mt-3 inline-block rounded-full bg-support px-6 py-2.5 font-semibold text-white transition-colors hover:bg-support-deep"
          >
            Open crisis support
          </a>
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.sender === "member" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-3xl px-5 py-3 leading-relaxed ${
                m.sender === "member"
                  ? "bg-sage/40 text-ground"
                  : m.riskFlag
                    ? "border border-support/40 bg-support/10 text-ground"
                    : "border border-ground/10 bg-linen text-ground shadow-soft"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="rounded-3xl border border-ground/10 bg-linen px-5 py-3 text-olive shadow-soft">
              …
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Whatever feels true right now…"
          aria-label="Message your companion"
          className="flex-1 rounded-full border border-ground/15 bg-linen px-5 py-3 focus:border-sage focus:outline-none"
        />
        <button
          onClick={send}
          disabled={pending || input.trim().length === 0}
          className="rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {doneHref && (
        <a
          href={doneHref}
          className="mt-4 block rounded-full border border-ground/20 px-6 py-3 text-center text-ground/80 transition-colors hover:bg-moss"
        >
          {doneLabel ?? "Continue"}
        </a>
      )}
      <p className="mt-3 text-center text-xs text-olive">
        Your companion is supportive software, not a therapist or emergency care. In crisis,
        call or text 988 or call 911.
      </p>
    </div>
  );
}
