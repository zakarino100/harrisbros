import { useEffect, useState } from "react";
import type { MePayload } from "../lib/api";
import { Dialer } from "../components/Dialer";

interface CallRecord {
  id: number;
  vapi_call_id: string;
  direction: "inbound" | "outbound";
  status: string;
  from_phone: string;
  to_phone: string;
  duration_seconds: number | null;
  transcript: string | null;
  recording_url: string | null;
  summary: string | null;
  lead_name: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

interface CallsStats {
  total: number;
  inbound: number;
  outbound: number;
  completed: number;
  no_answer: number;
  voicemail: number;
  avg_duration_seconds: number;
  vapiConfigured: boolean;
}

interface Props {
  me: MePayload;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTimeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-900/30 text-green-300";
    case "in-progress":
      return "bg-blue-900/30 text-blue-300";
    case "no-answer":
      return "bg-gray-700/30 text-gray-300";
    case "voicemail":
      return "bg-yellow-900/30 text-yellow-300";
    case "failed":
      return "bg-red-900/30 text-red-300";
    default:
      return "bg-gray-700/30 text-gray-300";
  }
}

export function Calls({ me }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<CallsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [showDialer, setShowDialer] = useState(false);

  function openLeadFromCall(leadName: string) {
    sessionStorage.setItem("swell_lead_search", leadName);
    alert(`Stored: "${leadName}". Switch to Leads tab to view this lead's details.`);
  }

  async function refreshCalls() {
    try {
      const [callsRes, statsRes] = await Promise.all([
        fetch("/api/calls?limit=100", { credentials: "include" }),
        fetch("/api/calls/stats", { credentials: "include" }),
      ]);
      const callsData = await callsRes.json();
      const statsData = await statsRes.json();
      setCalls(callsData);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load calls:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshCalls();
  }, []);

  function handleCallInitiated() {
    setShowDialer(false);
    setTimeout(refreshCalls, 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 pb-20">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">📞 Calls</h1>
          <p className="text-sm text-[var(--color-text-soft)] mt-1">Voice call history and management</p>
        </div>
        <button
          onClick={() => setShowDialer(true)}
          className="px-4 py-2 min-h-[44px] rounded-lg bg-[var(--color-gold)] hover:bg-[var(--color-gold)]/90 text-black font-bold transition-colors flex items-center justify-center"
        >
          📞 New Call
        </button>
      </div>

      {/* Dialer Modal */}
      {showDialer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-bg)] border border-[var(--color-gold)]/30 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--color-text)]">📞 New Call</h2>
              <button
                onClick={() => setShowDialer(false)}
                className="text-[var(--color-text-soft)] hover:text-[var(--color-text)] text-xl"
              >
                ✕
              </button>
            </div>
            <Dialer me={me} onCallInitiated={handleCallInitiated} />
          </div>
        </div>
      )}

      {!showDialer && (
        <>
          {/* Warning banner if VAPI not configured */}
          {stats && !stats.vapiConfigured && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 text-yellow-300 text-sm">
              📞 <strong>VAPI not configured</strong> — add VAPI_API_KEY and assistant IDs to .env to enable AI call handling
            </div>
          )}

          {/* Stats bar */}
          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="surface rounded-xl p-4">
                <div className="text-[var(--color-text-soft)] text-xs uppercase tracking-wide font-semibold">
                  Total Calls
                </div>
                <div className="text-2xl font-bold text-[var(--color-gold)] mt-1">{stats.total}</div>
              </div>
              <div className="surface rounded-xl p-4">
                <div className="text-[var(--color-text-soft)] text-xs uppercase tracking-wide font-semibold">
                  Completed
                </div>
                <div className="text-2xl font-bold text-green-400 mt-1">{stats.completed}</div>
              </div>
              <div className="surface rounded-xl p-4">
                <div className="text-[var(--color-text-soft)] text-xs uppercase tracking-wide font-semibold">
                  No Answer
                </div>
                <div className="text-2xl font-bold text-gray-400 mt-1">{stats.no_answer}</div>
              </div>
              <div className="surface rounded-xl p-4">
                <div className="text-[var(--color-text-soft)] text-xs uppercase tracking-wide font-semibold">
                  Avg Duration
                </div>
                <div className="text-2xl font-bold text-[var(--color-gold)] mt-1">
                  {stats.avg_duration_seconds ? `${Math.round(stats.avg_duration_seconds / 60)}m` : "—"}
                </div>
              </div>
            </div>
          )}

          {/* Calls list */}
          {calls.length === 0 ? (
            <div className="surface rounded-2xl p-8 text-center">
              <p className="text-[var(--color-text-soft)]">No calls yet — calls will appear here once your phone system is active</p>
            </div>
          ) : (
            <div className="space-y-3">
              {calls.map((call) => (
                <div key={call.vapi_call_id} className="surface rounded-xl p-4 hover:bg-[var(--color-bg-soft)] transition-colors">
                  <div className="flex items-start gap-4">
                    {/* Direction badge */}
                    <div className="text-xl mt-1 flex-shrink-0">
                      {call.direction === "inbound" ? "📞" : "☎️"}
                    </div>

                    {/* Main info */}
                    <div className="flex-grow">
                      <div className="flex items-center gap-3 mb-2">
                        {call.lead_name ? (
                          <button
                            onClick={() => openLeadFromCall(call.lead_name || "")}
                            className="font-semibold text-[var(--color-gold)] hover:underline cursor-pointer"
                            title="Click to find this lead in the Leads view"
                          >
                            {call.lead_name}
                          </button>
                        ) : (
                          <span className="font-semibold text-[var(--color-text)]">Unknown</span>
                        )}
                        <span className="text-sm text-[var(--color-text-soft)]">
                          {call.from_phone || call.to_phone || "—"}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(call.status)}`}>
                          {call.status}
                        </span>
                        <span className="text-xs text-[var(--color-text-soft)] ml-auto">
                          {formatTimeAgo(call.created_at)}
                        </span>
                      </div>

                      {/* Duration + Summary */}
                      <div className="text-xs text-[var(--color-text-soft)] space-y-1">
                        {call.duration_seconds && (
                          <div>⏱️ Duration: {formatDuration(call.duration_seconds)}</div>
                        )}
                        {call.summary && (
                          <div className="text-[var(--color-text-soft)] line-clamp-2">
                            {call.summary}
                          </div>
                        )}
                      </div>

                      {/* Transcript expandable */}
                      {call.transcript && (
                        <button
                          onClick={() =>
                            setExpandedCallId(expandedCallId === call.vapi_call_id ? null : call.vapi_call_id)
                          }
                          className="mt-2 text-xs text-[var(--color-gold)] hover:underline"
                        >
                          {expandedCallId === call.vapi_call_id ? "Hide" : "View"} Transcript
                        </button>
                      )}

                      {/* Expanded transcript */}
                      {expandedCallId === call.vapi_call_id && call.transcript && (
                        <div className="mt-3 p-3 bg-black/30 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-soft)] leading-relaxed">
                          {call.transcript}
                        </div>
                      )}

                      {/* Recording player */}
                      {call.recording_url && (
                        <div className="mt-2">
                          <audio
                            controls
                            className="w-full h-8"
                            src={call.recording_url}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
