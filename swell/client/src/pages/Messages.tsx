import { useEffect, useState, useRef } from "react";
import { api, type ConversationListItem, type ConversationThreadView } from "../lib/api";

interface Props {
  me: any;
  selectedLeadForMessage?: number | null;
  onClearSelection?: () => void;
}

export function Messages({ me, selectedLeadForMessage, onClearSelection }: Props) {
  const [conversations, setConversations] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [threadData, setThreadData] = useState<ConversationThreadView | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const [newMessageModal, setNewMessageModal] = useState(false);
  const [newMessageTab, setNewMessageTab] = useState<"search" | "new">("search");
  const [preselectedLeadId, setPreselectedLeadId] = useState<number | null>(selectedLeadForMessage || null);

  async function refresh() {
    try {
      const convs = await api.listMessages();
      setConversations(convs);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (selectedLeadForMessage) {
      setNewMessageModal(true);
      setNewMessageTab("search");
      onClearSelection?.();
    }
  }, [selectedLeadForMessage, onClearSelection]);

  // Auto-refresh active thread every 5 seconds
  useEffect(() => {
    if (!selectedConvId) return;
    const t = setInterval(() => {
      api
        .getThread(selectedConvId)
        .then(setThreadData)
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(t);
  }, [selectedConvId]);

  async function openThread(convId: number) {
    setSelectedConvId(convId);
    setThreadData(null);
    setThreadLoading(true);
    try {
      const thread = await api.getThread(convId);
      setThreadData(thread);
    } catch (err) {
      console.error(err);
    } finally {
      setThreadLoading(false);
    }
  }

  function closeThread() {
    setSelectedConvId(null);
    setThreadData(null);
  }

  function startNewMessage(leadId?: number) {
    setNewMessageModal(true);
    setNewMessageTab("search");
    if (leadId) {
      setPreselectedLeadId(leadId);
    }
  }

  const filtered = (() => {
    if (!conversations) return null;
    let out = conversations;
    if (statusFilter !== "all") out = out.filter((c) => c.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter(
        (c) =>
          (c.leadName?.toLowerCase() || "").includes(q) ||
          (c.leadPhone?.toLowerCase() || "").includes(q)
      );
    }
    return out;
  })();

  const brand = me.tenant.brandColor;

  return (
    <div className="relative z-10 min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,10,0.78)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-black font-bold text-base"
              style={{ background: brand, boxShadow: `0 8px 24px -10px ${brand}80` }}
            >
              💬
            </div>
            <div className="min-w-0">
              <h1 className="font-[family-name:var(--font-display)] font-bold text-base sm:text-lg truncate">
                Messages
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[var(--color-text-soft)] uppercase tracking-widest">
                Lead Command · <span style={{ color: brand }}>Swell</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => startNewMessage()}
            className="px-3 py-1.5 rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center gap-2 shrink-0"
            style={{ background: brand, color: "black" }}
          >
            ✏️ New
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-5 sm:space-y-7">
        {/* Filters */}
        <section className="surface p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            className="input flex-1"
            placeholder="Search name or phone…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            {(["all", "active", "handoff", "closed_won", "closed_lost", "stopped"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide border transition-colors ${
                  statusFilter === s
                    ? "bg-[var(--color-gold)] text-black border-[var(--color-gold)]"
                    : "bg-transparent text-[var(--color-text-soft)] border-[var(--color-border-strong)] hover:bg-[var(--color-bg-soft)]"
                }`}
                style={statusFilter === s ? { background: brand, borderColor: brand } : undefined}
              >
                {s === "active" ? "active" : s === "handoff" ? "handoff" : s === "closed_won" ? "✓ won" : s === "closed_lost" ? "✗ lost" : s === "stopped" ? "stopped" : "all"}
              </button>
            ))}
          </div>
        </section>

        {/* Conversation list */}
        <section>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Conversations · newest first
            </h2>
            {filtered && (
              <span className="text-xs text-[var(--color-text-faint)]">
                {filtered.length} shown
              </span>
            )}
          </div>

          {error && (
            <div className="surface p-4 text-sm text-red-400">{error}</div>
          )}

          {!error && loading && !conversations && (
            <div className="surface p-8 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
            </div>
          )}

          {!error && filtered && filtered.length === 0 && (
            <div className="surface p-10 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                No conversations yet — SMS exchanges will appear here.
              </p>
            </div>
          )}

          {!error && filtered && filtered.length > 0 && (
            <ul className="space-y-2">
              {filtered.map((c) => {
                const isUnread = c.lastMessagePreview ? false : true;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => openThread(c.id)}
                      className={`tap surface w-full text-left p-3 sm:p-4 hover:border-[var(--color-border-strong)] transition-colors ${
                        selectedConvId === c.id ? "border-l-2" : ""
                      }`}
                      style={selectedConvId === c.id ? { borderLeftColor: brand } : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate text-sm sm:text-base">
                              {c.leadName || "Unknown"}
                            </p>
                            <span className={`pill pill-${conversationStatusPill(c.status)}`}>
                              {c.status}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-[var(--color-text-muted)] mt-1 truncate">
                            {c.leadPhone || "—"}
                          </p>
                          {c.lastMessagePreview && (
                            <p className="text-xs text-[var(--color-text-faint)] mt-0.5 truncate">
                              {c.lastMessagePreview}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-[var(--color-text-faint)] tabular-nums">
                            {formatRelativeTime(c.lastMessageAt || c.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {/* Thread modal */}
      {selectedConvId && (
        <ThreadModal
          open={true}
          threadData={threadData}
          loading={threadLoading}
          onClose={closeThread}
          brand={brand}
          onRefresh={() => {
            api
              .getThread(selectedConvId)
              .then(setThreadData)
              .catch(() => {});
          }}
        />
      )}

      {/* New Message Modal */}
      {newMessageModal && (
        <NewMessageModal
          open={true}
          onClose={() => {
            setNewMessageModal(false);
            setPreselectedLeadId(null);
          }}
          brand={brand}
          preselectedLeadId={preselectedLeadId}
          onMessageSent={(convId) => {
            setNewMessageModal(false);
            setPreselectedLeadId(null);
            openThread(convId);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ThreadModal({
  open,
  threadData,
  loading,
  onClose,
  brand,
  onRefresh,
}: {
  open: boolean;
  threadData: ConversationThreadView | null;
  loading: boolean;
  onClose: () => void;
  brand: string;
  onRefresh: () => void;
}) {
  const [sendLoading, setSendLoading] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [resumingAi, setResumingAi] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threadData?.messages]);

  if (!open) return null;

  async function handleSend() {
    if (!messageBody.trim() || !threadData) return;
    setSendLoading(true);
    try {
      await api.sendMessage(threadData.id, messageBody);
      setMessageBody("");
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Failed to send message");
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Modal */}
      <div
        className="fixed inset-0 sm:inset-4 z-50 flex flex-col rounded-none sm:rounded-2xl bg-[var(--color-bg-soft)] border border-[var(--color-border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-[rgba(17,24,39,0.85)] border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between gap-3 rounded-t-2xl">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-display)] font-bold text-lg truncate">
              {loading && !threadData ? "Loading…" : threadData?.leadName || "Unknown"}
            </h3>
            {threadData && (
              <>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {threadData.leadPhone || "—"}
                </p>
                <span className={`pill pill-${conversationStatusPill(threadData.status)} mt-1`}>
                  {threadData.status}
                </span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && !threadData && (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
            </div>
          )}

          {threadData && threadData.messages.length === 0 && (
            <div className="text-center text-sm text-[var(--color-text-muted)]">
              No messages yet.
            </div>
          )}

          {threadData &&
            threadData.messages.map((m) => {
              const isRep = m.role === "rep";
              const isUser = m.role === "user";
              const isAssistant = m.role === "assistant";
              return (
                <div
                  key={m.id}
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                    isUser
                      ? "ml-auto bg-[rgba(251,191,36,0.08)] border border-[rgba(251,191,36,0.2)] text-[var(--color-text)] rounded-br-md"
                      : isRep
                      ? "mr-auto bg-blue-900/20 border border-blue-700/40 text-[var(--color-text)] rounded-bl-md"
                      : "mr-auto bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text)] rounded-bl-md"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                      {isUser ? "👤 Customer" : isRep ? "👤 Rep" : "🤖 Hayden"}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">
                      {new Date(m.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {m.error && (
                    <p className="text-[10px] text-red-400 mt-1 italic">
                      send error: {m.error}
                    </p>
                  )}
                </div>
              );
            })}
          <div ref={messagesEndRef} />
        </div>

        {/* Send box */}
        {threadData && (
          <div className="sticky bottom-0 border-t border-[var(--color-border)] bg-[rgba(17,24,39,0.85)] px-5 py-4 rounded-b-2xl space-y-3">
            {/* Handoff banner + Resume AI toggle */}
            {threadData.status === "handoff" && (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-amber-900/20 border border-amber-700/40">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">🤖 Hayden Paused</p>
                  <p className="text-[10px] text-[var(--color-text-faint)] mt-0.5 truncate">
                    {threadData.handoffReason ? `Reason: ${threadData.handoffReason}` : "Conversation handed off to rep"}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setResumingAi(true);
                    try {
                      await api.resumeAi(threadData.id);
                      onRefresh();
                    } catch (err) {
                      console.error(err);
                      alert("Failed to resume AI");
                    } finally {
                      setResumingAi(false);
                    }
                  }}
                  disabled={resumingAi}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-black transition-opacity disabled:opacity-50"
                  style={{ background: brand }}
                >
                  {resumingAi ? "…" : "▶ Resume AI"}
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Type message…"
                className="input flex-1 resize-none max-h-24"
                rows={1}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    handleSend();
                  }
                }}
              />
              <button
                onClick={handleSend}
                disabled={!messageBody.trim() || sendLoading}
                className="px-4 py-2 rounded-lg font-semibold uppercase tracking-wide text-xs text-black transition-opacity disabled:opacity-50"
                style={{ background: !messageBody.trim() ? "#9ca3af" : brand }}
              >
                {sendLoading ? "…" : "Send"}
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-text-faint)] text-center">
              Sending as rep · Cmd+Enter to send
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function NewMessageModal({
  open,
  onClose,
  brand,
  onMessageSent,
  preselectedLeadId,
}: {
  open: boolean;
  onClose: () => void;
  brand: string;
  onMessageSent: (convId: number) => void;
  preselectedLeadId?: number | null;
}) {
  const [tab, setTab] = useState<"search" | "new">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ id: number; full_name: string | null; phone: string | null; email: string | null }> | null
  >(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(preselectedLeadId || null);

  useEffect(() => {
    if (preselectedLeadId && !selectedLeadId) {
      setSelectedLeadId(preselectedLeadId);
    }
  }, [preselectedLeadId, selectedLeadId]);
  const [messageBody, setMessageBody] = useState("");

  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  const [sending, setSending] = useState(false);

  if (!open) return null;

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await api.searchLeads(q);
      setSearchResults(results);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSend() {
    if (!messageBody.trim()) return;
    setSending(true);
    try {
      if (tab === "search") {
        if (!selectedLeadId) {
          alert("Please select a lead");
          return;
        }
        const res = await api.startNewMessage({ leadId: selectedLeadId, body: messageBody });
        onMessageSent(res.conversationId);
      } else {
        if (!newPhone.trim()) {
          alert("Please enter a phone number");
          return;
        }
        const res = await api.startNewMessage({ phone: newPhone, body: messageBody });
        onMessageSent(res.conversationId);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div
        className="fixed inset-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-full sm:max-w-md bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-none sm:rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 backdrop-blur-md bg-[rgba(17,24,39,0.85)] border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between rounded-t-2xl">
          <h3 className="font-[family-name:var(--font-display)] font-bold text-lg">New Message</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            onClick={() => {
              setTab("search");
              if (!preselectedLeadId) {
                setSelectedLeadId(null);
              }
            }}
            className={`flex-1 px-4 py-3 font-semibold uppercase tracking-wide text-xs border-b-2 transition-colors ${
              tab === "search"
                ? "text-white border-[var(--color-gold)]"
                : "text-[var(--color-text-soft)] border-transparent hover:bg-[var(--color-bg-card)]"
            }`}
            style={tab === "search" ? { borderBottomColor: brand } : undefined}
          >
            Search Leads
          </button>
          <button
            onClick={() => setTab("new")}
            className={`flex-1 px-4 py-3 font-semibold uppercase tracking-wide text-xs border-b-2 transition-colors ${
              tab === "new"
                ? "text-white border-[var(--color-gold)]"
                : "text-[var(--color-text-soft)] border-transparent hover:bg-[var(--color-bg-card)]"
            }`}
            style={tab === "new" ? { borderBottomColor: brand } : undefined}
          >
            New Number
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "search" && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Search name, phone, email…"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="input w-full"
              />
              {searchResults === null && searchQuery.length < 2 && (
                <p className="text-xs text-[var(--color-text-faint)] text-center py-6">
                  Type at least 2 characters to search
                </p>
              )}
              {searchResults && searchResults.length === 0 && (
                <p className="text-xs text-[var(--color-text-faint)] text-center py-6">
                  No leads found
                </p>
              )}
              {searchResults && searchResults.length > 0 && (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {searchResults.map((lead) => (
                    <li key={lead.id}>
                      <button
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedLeadId === lead.id
                            ? "bg-[var(--color-gold)]/10 border-[var(--color-gold)]/50"
                            : "bg-[var(--color-bg-card)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                        }`}
                      >
                        <p className="font-semibold text-sm">{lead.full_name || "Unknown"}</p>
                        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                          {[lead.phone, lead.email].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "new" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">
                  Name (optional)
                </label>
                <input
                  type="text"
                  placeholder="Customer name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5">
              Message
            </label>
            <textarea
              placeholder="Type your message…"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className="input w-full resize-none"
              rows={4}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-[var(--color-border)] bg-[rgba(17,24,39,0.85)] px-5 py-4 flex gap-3 rounded-b-2xl">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg font-semibold uppercase tracking-wide text-xs text-[var(--color-text-soft)] border border-[var(--color-border)] hover:bg-[var(--color-bg-card)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={
              !messageBody.trim() ||
              sending ||
              (tab === "search" && !selectedLeadId) ||
              (tab === "new" && !newPhone.trim())
            }
            className="flex-1 px-4 py-2 rounded-lg font-semibold uppercase tracking-wide text-xs text-black transition-opacity disabled:opacity-50"
            style={{ background: brand }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}

function conversationStatusPill(status: string): string {
  switch (status) {
    case "active":
      return "contacted";
    case "handoff":
      return "quoted";
    case "closed_won":
      return "sold";
    case "closed_lost":
    case "stopped":
      return "lost";
    default:
      return "new";
  }
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
