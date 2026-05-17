import { useEffect, useState } from "react";
import type { LeadDetail } from "../lib/api";


interface Props {
  open: boolean;
  lead: LeadDetail | null;
  loading: boolean;
  brandColor: string;
  onClose: () => void;
  onPatch: (patch: { status?: string; notes?: string; full_name?: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string; home_sqft?: number | null; window_count?: number | null }) => void;
}

const STATUSES = ["new", "contacted", "quoted", "sold", "lost"] as const;

export function LeadDrawer({ open, lead, loading, brandColor, onClose, onPatch }: Props) {
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);
  const [aiPaused, setAiPaused] = useState(lead?.conversation?.aiPaused ?? false);
  const [togglingAi, setTogglingAi] = useState(false);

  useEffect(() => {
    setAiPaused(lead?.conversation?.aiPaused ?? false);
  }, [lead?.conversation?.aiPaused]);

  useEffect(() => {
    setNotesDraft(lead?.notes ?? "");
    setEditingField(null);
  }, [lead?.id, lead?.notes]);

  // Lock background scroll when drawer is open on mobile
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const fullAddress = lead
    ? [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ")
    : "";

  async function saveNotes() {
    if (!lead) return;
    setSavingNotes(true);
    try {
      onPatch({ notes: notesDraft });
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Drawer — flex column so header is always fully visible, content scrolls */}
      <aside
        className="fixed top-[57px] sm:top-[69px] bottom-0 right-0 z-50 w-full sm:w-[460px] max-w-full
                   bg-[var(--color-bg-soft)] border-l border-[var(--color-border)]
                   shadow-[0_0_60px_-15px_rgba(0,0,0,0.8)]
                   flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — pinned, never scrolls */}
        <div className="shrink-0 backdrop-blur-md bg-[rgba(17,24,39,0.92)] border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-display)] font-bold text-lg truncate">
              {loading && !lead ? "Loading…" : lead?.fullName || "Unknown"}
            </h3>
            {lead && (
              <span className={`pill pill-${lead.status} mt-1`}>{lead.status}</span>
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

        {loading && !lead && (
          <div className="p-8 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
          </div>
        )}

        {lead && (
          <div className="px-5 py-5 space-y-6">
            {/* Status setter */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                Status
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => onPatch({ status: s })}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide border transition-colors ${
                      lead.status === s
                        ? "text-black"
                        : "text-[var(--color-text-soft)] border-[var(--color-border-strong)] hover:bg-white/5"
                    }`}
                    style={
                      lead.status === s
                        ? { background: brandColor, borderColor: brandColor }
                        : undefined
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </section>

            {/* Contact — all fields inline-editable */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                Contact
              </p>
              <div className="surface-soft divide-y divide-white/5">
                <EditableRow label="Name"    field="full_name" value={lead.fullName}  type="text"  editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="Phone"   field="phone"     value={lead.phone}     type="tel"   editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="Email"   field="email"     value={lead.email}     type="email" editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="Address" field="address"   value={lead.address}   type="text"  editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="City"    field="city"      value={lead.city}      type="text"  editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="State"   field="state"     value={lead.state}     type="text"  editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                <EditableRow label="ZIP"     field="zip"       value={lead.zip}       type="text"  editingField={editingField} editingValue={editingValue} savingField={savingField} brandColor={brandColor} setEditingField={setEditingField} setEditingValue={setEditingValue} onSave={async (f,v) => { setSavingField(f); await onPatch({ [f]: v }); setSavingField(null); setEditingField(null); }} />
                {lead.metaFormId && <Row label="Form ID" value={<code className="text-xs">{lead.metaFormId}</code>} />}
                {lead.metaAdId   && <Row label="Ad ID"   value={<code className="text-xs">{lead.metaAdId}</code>} />}
              </div>

              {/* Zillow quick-link — shows when we have an address */}
              {(lead.address || lead.city) && (() => {
                const q = encodeURIComponent([lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(' '));
                return (
                  <a
                    href={`https://www.zillow.com/homes/${q}_rb/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-border-strong)] bg-[var(--color-bg)] text-sm font-semibold text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors"
                  >
                    <span className="text-base">🏠</span>
                    <span>View on Zillow</span>
                    <span className="ml-auto text-[10px] text-[var(--color-text-faint)] font-mono truncate max-w-[180px]">{[lead.address, lead.city].filter(Boolean).join(', ')}</span>
                    <svg className="w-3 h-3 text-[var(--color-text-faint)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                );
              })()}
            </section>

            {/* Property details — sqft & windows for quoting */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Property</p>
              <div className="surface-soft divide-y divide-white/5">
                <NumericEditableRow
                  label="Home Sqft" field="home_sqft" value={lead.homeSqft}
                  placeholder="e.g. 2400" suffix=" sq ft"
                  onSave={async (f, v) => onPatch({ [f]: v })}
                />
                <NumericEditableRow
                  label="Windows" field="window_count" value={lead.windowCount}
                  placeholder="e.g. 18" suffix=" windows"
                  onSave={async (f, v) => onPatch({ [f]: v })}
                />
              </div>
              {(lead.homeSqft || lead.windowCount) && (
                <p className="mt-2 text-[10px] text-[var(--color-text-faint)]">
                  {lead.homeSqft ? `${lead.homeSqft.toLocaleString()} sq ft` : ""}
                  {lead.homeSqft && lead.windowCount ? " · " : ""}
                  {lead.windowCount ? `${lead.windowCount} windows` : ""}
                  {" · "}
                  <span className="text-[var(--color-gold)]">+5 pts to lead score when filled</span>
                </p>
              )}
            </section>

            {/* Notes */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                Notes
              </p>
              <textarea
                className="input min-h-[88px] resize-none"
                placeholder="Add a note (visible to you only)…"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes || notesDraft === (lead.notes ?? "")}
                  className="btn-gold text-sm"
                  style={{ background: brandColor }}
                >
                  {savingNotes ? "Saving…" : "Save Notes"}
                </button>
              </div>
            </section>

            {/* Hayden conversation transcript */}
            {lead.conversation && lead.conversation.messages.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                    Hayden · SMS Transcript
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`pill pill-${conversationStatusPill(lead.conversation.status)}`}>
                      {lead.conversation.status.replace(/_/g, " ")}
                    </span>
                    {/* AI on/off toggle */}
                    <button
                      disabled={togglingAi}
                      onClick={async () => {
                        if (!lead.conversation) return;
                        setTogglingAi(true);
                        try {
                          const res = await fetch(`/api/messages/${lead.conversation.id}/ai-toggle`, { method: "PATCH", credentials: "include" });
                          if (res.ok) setAiPaused((p) => !p);
                        } finally {
                          setTogglingAi(false);
                        }
                      }}
                      title={aiPaused ? "AI is OFF — click to turn on" : "AI is ON — click to pause"}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        togglingAi ? "opacity-50 cursor-wait" : "cursor-pointer"
                      } ${
                        aiPaused ? "bg-red-500/70" : "bg-green-500/70"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                          aiPaused ? "translate-x-1" : "translate-x-4.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {lead.conversation.messages
                    .filter((m) => m.role === "assistant" || m.role === "user")
                    .map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-[88%] px-3 py-2 rounded-2xl text-sm ${
                          m.role === "assistant"
                            ? "ml-auto bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text)] rounded-tr-md"
                            : "mr-auto bg-[rgba(251,191,36,0.08)] border border-[rgba(251,191,36,0.2)] text-[var(--color-text)] rounded-tl-md"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-0.5">
                          <span
                            className="text-[10px] font-bold uppercase tracking-widest opacity-70"
                            style={
                              m.role === "user"
                                ? { color: brandColor }
                                : undefined
                            }
                          >
                            {m.role === "assistant" ? "Hayden" : "Customer"}
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
                    ))}
                </div>
                <p className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-widest text-center mt-2">
                  {lead.conversation.totalMessages} msgs
                  {lead.conversation.handoffReason ? ` · ${lead.conversation.handoffReason}` : ""}
                </p>
              </section>
            )}

            {/* Activity timeline */}
            <section>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
                Activity
              </p>
              {lead.activity.length === 0 ? (
                <div className="surface-soft p-3 text-xs text-[var(--color-text-muted)] italic">
                  Nothing logged yet.
                </div>
              ) : (
                <ul className="space-y-2">
                  {lead.activity.map((a) => {
                    const isCallEvent = [
                      "call_completed",
                      "call_no-answer",
                      "call_voicemail",
                      "call_failed",
                      "call_in-progress",
                    ].includes(a.type);

                    const metadata =
                      typeof a.metadata === "string"
                        ? (() => {
                            try {
                              return JSON.parse(a.metadata);
                            } catch {
                              return a.metadata;
                            }
                          })()
                        : a.metadata || {};

                    const statusColor =
                      a.type === "call_completed"
                        ? "bg-green-900/30 text-green-400"
                        : a.type === "call_no-answer"
                        ? "bg-gray-700/30 text-gray-400"
                        : a.type === "call_voicemail"
                        ? "bg-yellow-900/30 text-yellow-400"
                        : a.type === "call_failed"
                        ? "bg-red-900/30 text-red-400"
                        : a.type === "call_in-progress"
                        ? "bg-blue-900/30 text-blue-400"
                        : "bg-white/5 text-[var(--color-text-soft)]";

                    return (
                      <li key={a.id} className="surface-soft px-3 py-2 text-xs">
                        {isCallEvent ? (
                          <div className="space-y-2">
                            {/* Call header */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-lg">📞</span>
                                {a.direction && (
                                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-white/10 rounded-full">
                                    {a.direction === "inbound" ? "📥 Inbound" : "📤 Outbound"}
                                  </span>
                                )}
                                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${statusColor}`}>
                                  {a.type.replace("call_", "").replace("-", " ")}
                                </span>
                              </div>
                              <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0">
                                {new Date(a.createdAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            {/* Duration if available */}
                            {metadata.duration_seconds !== undefined && (
                              <div className="text-[var(--color-text-muted)]">
                                ⏱️ Duration:{" "}
                                {metadata.duration_seconds
                                  ? `${Math.floor(metadata.duration_seconds / 60)}m ${metadata.duration_seconds % 60}s`
                                  : "—"}
                              </div>
                            )}

                            {/* Summary text (truncated at ~150 chars) */}
                            {a.body && (
                              <p className="text-[var(--color-text-muted)] line-clamp-3">
                                {a.body.length > 150 ? a.body.substring(0, 150) + "…" : a.body}
                              </p>
                            )}

                            {/* Enriched data if available */}
                            {Object.keys(metadata).length > 0 && (
                              <div className="text-[var(--color-text-faint)] space-y-1 pt-1 border-t border-white/5">
                                {metadata.service && (
                                  <div className="text-[10px]">
                                    <span className="font-semibold">Service:</span> {metadata.service}
                                  </div>
                                )}
                                {metadata.address && (
                                  <div className="text-[10px]">
                                    <span className="font-semibold">Address:</span> {metadata.address}
                                  </div>
                                )}
                                {metadata.sqft && (
                                  <div className="text-[10px]">
                                    <span className="font-semibold">Sqft:</span> {metadata.sqft}
                                  </div>
                                )}
                                {metadata.quoted_price && (
                                  <div className="text-[10px]">
                                    <span className="font-semibold">Quote:</span> ${metadata.quoted_price}
                                  </div>
                                )}
                                {metadata.booking_intent === true && (
                                  <div className="text-[10px] text-green-400">
                                    ✅ Booking intent detected
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Recording link if available */}
                            {metadata.recording_url && (
                              <div className="pt-1">
                                <a
                                  href={metadata.recording_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[var(--color-gold)] hover:underline text-[10px] font-semibold"
                                >
                                  ▶ Play recording
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-semibold text-[var(--color-text)]">{prettyType(a.type)}</span>
                              <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">
                                {new Date(a.createdAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            {a.body && (
                              <p className="text-[var(--color-text-muted)] mt-1 whitespace-pre-wrap break-words">
                                {a.body}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-widest text-center pt-2">
              Lead #{lead.id} · received {new Date(lead.createdAt).toLocaleString()}
            </div>
          </div>
        )}
        </div>{/* end scrollable body */}
      </aside>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 px-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">
        {label}
      </span>
      <span className="text-sm text-right break-words">{value}</span>
    </div>
  );
}

function EditableRow({
  label, field, value, type, editingField, editingValue, savingField,
  brandColor, setEditingField, setEditingValue, onSave,
}: {
  label: string; field: string; value: string | null | undefined; type: string;
  editingField: string | null; editingValue: string; savingField: string | null;
  brandColor: string;
  setEditingField: (f: string | null) => void;
  setEditingValue: (v: string) => void;
  onSave: (field: string, value: string) => Promise<void>;
}) {
  const isEditing = editingField === field;
  const isSaving = savingField === field;

  if (isEditing) {
    return (
      <div className="px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">{label}</p>
        <div className="flex gap-2">
          <input
            type={type}
            value={editingValue}
            onChange={e => setEditingValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") onSave(field, editingValue);
              if (e.key === "Escape") setEditingField(null);
            }}
            autoFocus
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border text-sm text-[var(--color-text)] focus:outline-none transition-colors"
            style={{ borderColor: brandColor }}
          />
          <button
            onClick={() => onSave(field, editingValue)}
            disabled={isSaving}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-black disabled:opacity-50 shrink-0"
            style={{ background: brandColor }}
          >
            {isSaving ? "…" : "✓"}
          </button>
          <button
            onClick={() => setEditingField(null)}
            className="px-2 py-1.5 rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-white/5"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setEditingField(field); setEditingValue(value ?? ""); }}
      className="w-full flex items-baseline justify-between gap-3 py-2.5 px-3 hover:bg-white/4 transition-colors text-left group"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-sm text-right break-words text-[var(--color-text-soft)] group-hover:text-[var(--color-text)]">
        {value || <span className="text-[var(--color-text-faint)] italic text-xs">tap to add</span>}
      </span>
    </button>
  );
}

function NumericEditableRow({ label, field, value, placeholder, suffix, onSave }: {
  label: string; field: string; value: number | null | undefined;
  placeholder: string; suffix: string;
  onSave: (field: string, value: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">{label}</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={async e => {
              if (e.key === "Enter") { setSaving(true); await onSave(field, draft ? Number(draft) : null); setSaving(false); setEditing(false); }
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            placeholder={placeholder}
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-gold)]/50 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-gold)]"
          />
          <button
            onClick={async () => { setSaving(true); await onSave(field, draft ? Number(draft) : null); setSaving(false); setEditing(false); }}
            disabled={saving}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-gold)] text-black disabled:opacity-50"
          >{saving ? "…" : "✓"}</button>
          <button onClick={() => setEditing(false)} className="px-2 py-1.5 rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-white/5">✕</button>
        </div>
      </div>
    );
  }
  return (
    <button
      onClick={() => { setEditing(true); setDraft(value != null ? String(value) : ""); }}
      className="w-full flex items-baseline justify-between gap-3 py-2.5 px-3 hover:bg-white/4 transition-colors text-left group"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-sm text-right text-[var(--color-text-soft)] group-hover:text-[var(--color-text)]">
        {value != null ? `${value.toLocaleString()}${suffix}` : <span className="text-[var(--color-text-faint)] italic text-xs">tap to add</span>}
      </span>
    </button>
  );
}

function prettyType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function conversationStatusPill(status: string): string {
  switch (status) {
    case "active": return "new";
    case "handoff": return "contacted";
    case "closed_won": return "sold";
    case "closed_lost": return "lost";
    case "stopped": return "lost";
    default: return "new";
  }
}
