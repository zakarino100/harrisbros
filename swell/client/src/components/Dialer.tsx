import { useEffect, useState, useRef } from "react";
import type { MePayload } from "../lib/api";

interface Lead {
  id: number;
  full_name: string | null;
  phone: string;
}

interface Props {
  me: MePayload;
  onCallInitiated: () => void;
}

const KEYS = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

export function Dialer({ me, onCallInitiated }: Props) {
  const [displayNumber, setDisplayNumber] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<{
    type: "idle" | "calling" | "success" | "error";
    message: string;
  }>({ type: "idle", message: "" });
  const [vapiConfigured, setVapiConfigured] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch stats to check if VAPI is configured
  useEffect(() => {
    async function checkVapi() {
      try {
        const res = await fetch("/api/calls/stats", { credentials: "include" });
        const data = await res.json();
        setVapiConfigured(data.vapiConfigured === true);
      } catch (err) {
        console.error("Failed to check VAPI config:", err);
        setVapiConfigured(false);
      }
    }
    checkVapi();
  }, []);

  // Search leads as user types in search bar
  useEffect(() => {
    async function searchLeads() {
      if (!searchQuery.trim()) {
        setLeads([]);
        setShowSuggestions(false);
        return;
      }
      try {
        const res = await fetch(`/api/leads?search=${encodeURIComponent(searchQuery)}&limit=5`, {
          credentials: "include",
        });
        const data = await res.json();
        setLeads(data);
        setShowSuggestions(data.length > 0);
      } catch (err) {
        console.error("Failed to search leads:", err);
        setLeads([]);
      }
    }

    const timer = setTimeout(searchLeads, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard support
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Backspace") {
        e.preventDefault();
        setDisplayNumber((prev) => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (displayNumber && vapiConfigured) {
          initiateCall(displayNumber);
        }
      } else if (/^\d$/.test(e.key) || e.key === "*" || e.key === "#") {
        e.preventDefault();
        setDisplayNumber((prev) => prev + e.key);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [displayNumber, vapiConfigured]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function addDigit(digit: string) {
    setDisplayNumber((prev) => prev + digit);
    // Reset search when adding digit from dialpad
    if (searchQuery) {
      setSearchQuery("");
      setLeads([]);
      setShowSuggestions(false);
    }
  }

  function handleBackspace() {
    setDisplayNumber((prev) => prev.slice(0, -1));
  }

  function handleClear() {
    setDisplayNumber("");
    setSearchQuery("");
    setLeads([]);
    setShowSuggestions(false);
    setCallStatus({ type: "idle", message: "" });
  }

  function selectLead(lead: Lead) {
    setDisplayNumber(lead.phone);
    setSearchQuery("");
    setLeads([]);
    setShowSuggestions(false);
  }

  async function initiateCall(phone: string) {
    if (!phone || !vapiConfigured) return;

    setCalling(true);
    setCallStatus({ type: "calling", message: `📞 Calling ${phone}...` });

    try {
      const res = await fetch("/api/calls/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCallStatus({
          type: "error",
          message: `❌ ${data.error || "Failed to initiate call"}`,
        });
        setCalling(false);
        return;
      }

      setCallStatus({
        type: "success",
        message: `✅ Call initiated — ${phone}`,
      });
      setDisplayNumber("");
      setSearchQuery("");
      setLeads([]);
      setShowSuggestions(false);

      // Notify parent to close modal and refresh calls
      setTimeout(() => {
        onCallInitiated();
      }, 1000);
    } catch (err) {
      setCallStatus({
        type: "error",
        message: `❌ ${(err as Error).message || "Failed to initiate call"}`,
      });
      setCalling(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm">
      {/* VAPI Warning */}
      {!vapiConfigured && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-300 text-sm">
          ⚠️ VAPI not configured — cannot initiate calls
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search leads by name or phone..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSuggestions(e.target.value.length > 0);
          }}
          onFocus={() => searchQuery && setShowSuggestions(true)}
          className="w-full min-h-[44px] px-3 py-2 bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-text-soft)] focus:outline-none focus:border-[var(--color-gold)] flex items-center"
        />

        {/* Lead Suggestions Dropdown */}
        {showSuggestions && leads.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto"
          >
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => selectLead(lead)}
                className="w-full text-left min-h-[44px] px-3 py-2 hover:bg-[var(--color-gold)]/10 border-b border-[var(--color-border)] last:border-b-0 transition-colors flex flex-col justify-center"
              >
                <div className="font-semibold text-sm text-[var(--color-gold)]">
                  {lead.full_name || "Unknown"}
                </div>
                <div className="text-xs text-[var(--color-text-soft)]">{lead.phone}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Display Area with Backspace */}
      <div className="flex items-center gap-2 bg-black/40 border border-[var(--color-gold)]/30 rounded-xl p-4">
        <input
          type="text"
          value={displayNumber}
          readOnly
          placeholder="0"
          className="flex-grow text-4xl font-mono font-bold text-[var(--color-gold)] bg-transparent text-right focus:outline-none placeholder-[var(--color-text-soft)]/30"
        />
        <button
          onClick={handleBackspace}
          disabled={!displayNumber}
          className="flex-shrink-0 min-h-[44px] min-w-[44px] text-2xl rounded-lg bg-[var(--color-bg-soft)] hover:bg-[var(--color-gold)]/20 disabled:opacity-30 transition-colors flex items-center justify-center"
          title="Delete last digit"
        >
          ⌫
        </button>
      </div>

      {/* Dialpad Grid */}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key.digit}
            onClick={() => addDigit(key.digit)}
            className="aspect-square min-h-[50px] sm:min-h-[56px] rounded-lg bg-[var(--color-bg-soft)] hover:bg-[var(--color-gold)] text-white font-bold text-lg sm:text-xl transition-colors flex flex-col items-center justify-center gap-0.5"
          >
            <div>{key.digit}</div>
            {key.letters && <div className="text-xs font-normal">{key.letters}</div>}
          </button>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {vapiConfigured ? (
          <button
            onClick={() => initiateCall(displayNumber)}
            disabled={!displayNumber || calling}
            className="flex-grow min-h-[44px] py-3 rounded-lg bg-[var(--color-gold)] hover:bg-[var(--color-gold)]/90 disabled:opacity-40 text-black font-bold text-base sm:text-lg transition-colors flex items-center justify-center gap-2"
          >
            {calling ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Calling...
              </>
            ) : (
              <>📞 Call</>
            )}
          </button>
        ) : (
          <div className="flex-grow min-h-[44px] py-3 rounded-lg bg-yellow-700/30 text-yellow-300 font-bold text-base sm:text-lg flex items-center justify-center">
            ⚠️ VAPI not configured
          </div>
        )}
        <button
          onClick={handleClear}
          className="min-h-[44px] min-w-[44px] px-3 py-3 rounded-lg bg-[var(--color-bg-soft)] hover:bg-red-900/30 text-[var(--color-text)] hover:text-red-300 font-bold text-lg transition-colors flex items-center justify-center"
          title="Clear display"
        >
          ✕
        </button>
      </div>

      {/* Status Display */}
      {callStatus.type !== "idle" && (
        <div
          className={`text-center text-sm font-semibold p-3 rounded-lg ${
            callStatus.type === "calling"
              ? "bg-blue-900/30 text-blue-300 animate-pulse"
              : callStatus.type === "success"
                ? "bg-green-900/30 text-green-300"
                : "bg-red-900/30 text-red-300"
          }`}
        >
          {callStatus.message}
        </div>
      )}
    </div>
  );
}
