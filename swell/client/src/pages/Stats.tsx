import { useEffect, useState } from "react";
import type { MePayload } from "../lib/api";

interface StatsData {
  leads: {
    total: number;
    byStatus: Record<string, number>;
    byTemperature: { hot: number; warm: number; cold: number };
    trend: Array<{ date: string; count: number }>;
  };
  appointments: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    no_show: number;
    schedulingRate: number;
  };
  revenue: {
    totalDollars: number;
    avgTicket: number;
    paidJobs: number;
    topServices: Array<{ service: string; bookings: number; revenue_cents: number }>;
  };
  conversations: {
    total: number;
    active: number;
    handoffs: number;
    dnc: number;
    avg_msgs_to_close: number;
    closeRate: number;
    convRate: number;
  };
  reviews: {
    total: number;
    routed_review: number;
    routed_feedback: number;
    avg_sentiment: number;
  };
}

interface AnalyticsSummary {
  period: { days: number; from: string; to: string };
  funnel: { leads: number; conversations_started: number; quotes_sent: number; handoffs: number; bookings: number };
  conversion_rates: { lead_to_conversation: number; conversation_to_quote: number; quote_to_booking: number; overall_close_rate: number };
  by_source: Array<{ campaign_name: string; ad_name: string; leads: number; conversations: number; bookings: number; close_rate: number }>;
  nurture_performance: Array<{ touch: string; fired: number; replies: number; reply_rate: number; bookings_from: number }>;
  top_messages: Array<{ body: string; role: string; led_to_booking: boolean; conversation_id: number }>;
  ab_variants: Array<{ variant: string; assigned: number; booked: number; close_rate: number }>;
  insights: any[];
}

interface Props {
  me: MePayload;
}

export function Stats({ me }: Props) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [perfTab, setPerfTab] = useState<'funnel' | 'messages' | 'insights'>('funnel');
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsInsights, setAnalyticsInsights] = useState<any[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState(30);
  const [implementedCount, setImplementedCount] = useState(() => {
    const stored = localStorage.getItem('swell_implemented_insights');
    return stored ? parseInt(stored) : 0;
  });

  useEffect(() => {
    fetch("/api/stats", { credentials: "include" })
      .then((r) => r.json())
      .then(setStats)
      .catch((err) => {
        console.error("Failed to load stats:", err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    fetch(`/api/analytics/summary?days=${analyticsPeriod}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setAnalytics(data);
        if (data.insights && data.insights.length > 0) {
          setAnalyticsInsights(data.insights);
        }
      })
      .catch((err) => {
        console.error("Failed to load analytics:", err);
        setAnalyticsError(err?.message || "Failed to load analytics");
      })
      .finally(() => setAnalyticsLoading(false));
  }, [analyticsPeriod]);

  const handleGenerateInsights = async () => {
    setInsightsLoading(true);
    try {
      const response = await fetch("/api/analytics/insights", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      setAnalyticsInsights(data.insights || []);
    } catch (err) {
      console.error("Failed to generate insights:", err);
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleMarkImplemented = () => {
    const newCount = implementedCount + 1;
    setImplementedCount(newCount);
    localStorage.setItem('swell_implemented_insights', String(newCount));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="surface rounded-2xl p-8 text-center">
          <p className="text-[var(--color-text-soft)]">No data yet — leads and appointments will appear here once your campaigns are running.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 pb-20">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text)]">📊 Statistics</h1>
        <p className="text-sm text-[var(--color-text-soft)] mt-1">Business performance overview</p>
      </div>

      {/* Row 1: KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPITile label="Total Leads" value={stats.leads.total} suffix="" />
        <KPITile label="Close Rate" value={stats.conversations.closeRate} suffix="%" />
        <KPITile label="Avg Ticket" value={`$${stats.revenue.avgTicket}`} suffix="" />
        <KPITile label="Scheduling Rate" value={stats.appointments.schedulingRate} suffix="%" />
      </div>

      {/* Row 2: Lead Temperature + Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LeadTemperatureChart data={stats.leads.byTemperature} />
        <AppointmentChart data={stats.appointments} />
      </div>

      {/* Row 3: Lead Trend */}
      <LeadTrendChart trend={stats.leads.trend} />

      {/* Row 4: Conversation Funnel */}
      <ConversationFunnel stats={stats} />

      {/* Row 5: Top Services + Review Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopServicesTable services={stats.revenue.topServices} />
        <ReviewPerformanceCard reviews={stats.reviews} />
      </div>

      {/* Performance Analytics Section */}
      <div className="mt-12 pt-8 border-t border-[var(--color-border)]">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">📈 Performance Analytics</h2>
          <p className="text-sm text-[var(--color-text-soft)]">Deep dive into sales funnel, messaging, and insights</p>
        </div>

        {/* Period selector */}
        <div className="mb-6 flex gap-2">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setAnalyticsPeriod(days)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                analyticsPeriod === days
                  ? 'bg-[var(--color-gold)] text-black'
                  : 'bg-[var(--color-bg-soft)] text-[var(--color-text-soft)] hover:bg-[var(--color-border)]'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>

        {analyticsError && (
          <div className="surface rounded-2xl p-6 bg-red-900/20 border border-red-700 mb-6">
            <p className="text-red-300">Error: {analyticsError}</p>
          </div>
        )}

        {analyticsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
          </div>
        ) : analytics ? (
          <>
            {/* Tab Navigation */}
            <div className="flex gap-2 mb-6 border-b border-[var(--color-border)]">
              {['funnel', 'messages', 'insights'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPerfTab(tab as any)}
                  className={`px-4 py-3 font-semibold text-sm uppercase transition-colors border-b-2 ${
                    perfTab === tab
                      ? 'border-[var(--color-gold)] text-[var(--color-gold)]'
                      : 'border-transparent text-[var(--color-text-soft)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {tab === 'funnel' && '📊 Funnel'}
                  {tab === 'messages' && '💬 Messages'}
                  {tab === 'insights' && '💡 Insights'}
                </button>
              ))}
            </div>

            {/* Funnel Tab */}
            {perfTab === 'funnel' && (
              <div className="space-y-8">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <KPICard label="Leads" value={analytics.funnel.leads} />
                  <KPICard label="Conversations" value={analytics.funnel.conversations_started} />
                  <KPICard label="Quotes" value={analytics.funnel.quotes_sent} />
                  <KPICard label="Handoffs" value={analytics.funnel.handoffs} />
                  <KPICard label="Bookings" value={analytics.funnel.bookings} />
                </div>

                {/* Conversion Rates */}
                <div className="surface rounded-2xl p-6">
                  <h3 className="text-lg font-bold text-[var(--color-text)] mb-6">Conversion Rates</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <ConversionRateCard
                      label="Lead → Conv"
                      rate={analytics.conversion_rates.lead_to_conversation}
                    />
                    <ConversionRateCard
                      label="Conv → Quote"
                      rate={analytics.conversion_rates.conversation_to_quote}
                    />
                    <ConversionRateCard
                      label="Quote → Booking"
                      rate={analytics.conversion_rates.quote_to_booking}
                    />
                    <ConversionRateCard
                      label="Overall Close"
                      rate={analytics.conversion_rates.overall_close_rate}
                      highlight
                    />
                  </div>
                </div>

                {/* Funnel Visualization */}
                <FunnelVisualization funnel={analytics.funnel} />

                {/* By Campaign Table */}
                {analytics.by_source.length > 0 && (
                  <div className="surface rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Performance by Campaign</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--color-border)]">
                            <th className="text-left py-3 px-4 font-semibold text-[var(--color-text-soft)]">Campaign / Ad</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Leads</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Conversations</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Bookings</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Close Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.by_source.map((row, i) => {
                            const isBest = i === 0 && analytics.by_source.length > 1;
                            return (
                              <tr
                                key={i}
                                className={`border-b border-[var(--color-border)] hover:bg-[var(--color-bg-soft)] transition-colors ${
                                  isBest ? 'bg-[var(--color-gold)]/10' : ''
                                }`}
                              >
                                <td className="py-3 px-4 text-[var(--color-text)]">
                                  {isBest && '🏆 '}
                                  {row.campaign_name} / {row.ad_name}
                                </td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{row.leads}</td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{row.conversations}</td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{row.bookings}</td>
                                <td className="text-right py-3 px-4 font-semibold text-[var(--color-gold)]">
                                  {row.close_rate.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Messages Tab */}
            {perfTab === 'messages' && (
              <div className="space-y-8">
                {analytics.nurture_performance.length === 0 && analytics.top_messages.length === 0 && (!analytics.ab_variants || analytics.ab_variants.length === 0) && (
                  <div className="surface rounded-2xl p-8 text-center">
                    <p className="text-[var(--color-text-soft)]">No message data yet for this period. Data appears as nurture touches fire and conversations progress.</p>
                  </div>
                )}
                {/* Nurture performance */}
                {analytics.nurture_performance.length > 0 && (
                  <div className="surface rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Nurture Touch Performance</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--color-border)]">
                            <th className="text-left py-3 px-4 font-semibold text-[var(--color-text-soft)]">Touch</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Fired</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Replies</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Reply Rate</th>
                            <th className="text-right py-3 px-4 font-semibold text-[var(--color-text-soft)]">Bookings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.nurture_performance.map((touch, i) => {
                            let rateColor = 'text-red-400';
                            if (touch.reply_rate >= 20) rateColor = 'text-green-400';
                            else if (touch.reply_rate >= 10) rateColor = 'text-yellow-400';

                            return (
                              <tr key={i} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-soft)]">
                                <td className="py-3 px-4 text-[var(--color-text)]">{touch.touch}</td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{touch.fired}</td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{touch.replies}</td>
                                <td className={`text-right py-3 px-4 font-semibold ${rateColor}`}>
                                  {touch.reply_rate.toFixed(1)}%
                                </td>
                                <td className="text-right py-3 px-4 text-[var(--color-text-soft)]">{touch.bookings_from}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Best Messages */}
                {analytics.top_messages.length > 0 && (
                  <div className="surface rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">Best Performing Messages</h3>
                    <div className="space-y-4">
                      {analytics.top_messages.slice(0, 5).map((msg, i) => (
                        <div key={i} className="p-4 bg-[var(--color-bg-soft)] rounded-lg border border-[var(--color-border)]">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-xs font-semibold text-[var(--color-gold)] uppercase">
                              {msg.role === 'assistant' ? '📤 Sent' : '📥 Received'}
                            </span>
                            {msg.led_to_booking && <span className="text-xs text-green-400 font-semibold">✓ Led to booking</span>}
                          </div>
                          <p className="text-sm text-[var(--color-text-soft)] leading-relaxed italic">
                            "{msg.body.length > 160 ? msg.body.substring(0, 160) + '...' : msg.body}"
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* A/B Test Summary */}
                {analytics.ab_variants && analytics.ab_variants.length > 0 && (
                  <div className="surface rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-[var(--color-text)] mb-4">A/B Test — Nurture Sequence</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {analytics.ab_variants.map((v) => (
                        <div key={v.variant} className="p-4 bg-[var(--color-bg-soft)] rounded-lg border border-[var(--color-border)]">
                          <p className="text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-3">Variant {v.variant}</p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-xl font-bold text-[var(--color-text)]">{v.assigned}</p>
                              <p className="text-xs text-[var(--color-text-soft)]">Assigned</p>
                            </div>
                            <div>
                              <p className="text-xl font-bold text-[var(--color-text)]">{v.booked}</p>
                              <p className="text-xs text-[var(--color-text-soft)]">Booked</p>
                            </div>
                            <div>
                              <p className="text-xl font-bold text-[var(--color-gold)]">{v.close_rate}%</p>
                              <p className="text-xs text-[var(--color-text-soft)]">Close Rate</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Insights Tab */}
            {perfTab === 'insights' && (
              <div className="space-y-6">
                <button
                  onClick={handleGenerateInsights}
                  disabled={insightsLoading}
                  className="px-6 py-3 bg-[var(--color-gold)] text-black font-semibold rounded-lg hover:bg-yellow-400 disabled:opacity-50 transition-colors"
                >
                  {insightsLoading ? 'Generating...' : '✨ Generate Insights'}
                </button>

                {analyticsInsights.length > 0 ? (
                  <div className="space-y-4">
                    {analyticsInsights.map((insight, i) => {
                      const impactColor = {
                        high: 'border-[var(--color-gold)] bg-[var(--color-gold)]/5',
                        medium: 'border-yellow-500/30 bg-yellow-500/5',
                        low: 'border-gray-600 bg-gray-600/5',
                      }[insight.impact] || 'border-gray-600';

                      const badgeColor = {
                        high: 'bg-[var(--color-gold)] text-black',
                        medium: 'bg-yellow-600 text-white',
                        low: 'bg-gray-700 text-gray-200',
                      }[insight.impact] || 'bg-gray-700';

                      return (
                        <div
                          key={i}
                          className={`surface rounded-2xl p-6 border-l-4 ${impactColor}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <h4 className="text-lg font-bold text-[var(--color-text)]">{insight.title}</h4>
                            <span className={`text-xs font-semibold px-3 py-1 rounded ${badgeColor}`}>
                              {insight.impact?.toUpperCase() || 'MEDIUM'} IMPACT
                            </span>
                          </div>
                          <p className="text-sm text-[var(--color-text-soft)] mb-4 leading-relaxed">{insight.insight}</p>
                          <div className="flex items-start gap-3">
                            <span className="text-sm font-semibold text-[var(--color-gold)]">→ Action:</span>
                            <p className="text-sm text-[var(--color-text-soft)]">{insight.action}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div className="mt-6 p-4 bg-[var(--color-bg-soft)] rounded-lg border border-[var(--color-border)]">
                      <p className="text-sm text-[var(--color-text-soft)]">
                        💾 <strong>Changes Implemented:</strong> {implementedCount}
                      </p>
                      <button
                        onClick={handleMarkImplemented}
                        className="text-sm text-[var(--color-gold)] hover:underline mt-2"
                      >
                        Mark as implemented ↗
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="surface rounded-2xl p-8 text-center">
                    <p className="text-[var(--color-text-soft)]">Click "Generate Insights" to get AI-powered recommendations</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Analytics Components ──────────────────────────────────────────────────────────────────

function KPICard({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface rounded-lg p-4 border border-[var(--color-border)]">
      <p className="text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-2">{label}</p>
      <p className="text-2xl font-bold text-[var(--color-gold)]">{value}</p>
    </div>
  );
}

function ConversionRateCard({
  label,
  rate,
  highlight,
}: {
  label: string;
  rate: number;
  highlight?: boolean;
}) {
  return (
    <div className={`p-4 rounded-lg border ${highlight ? 'bg-[var(--color-gold)]/10 border-[var(--color-gold)]' : 'bg-[var(--color-bg-soft)] border-[var(--color-border)]'}`}>
      <p className="text-sm font-semibold text-[var(--color-text-soft)] mb-2">{label}</p>
      <p className={`text-3xl font-bold ${highlight ? 'text-[var(--color-gold)]' : 'text-[var(--color-text)]'}`}>
        {rate.toFixed(1)}%
      </p>
    </div>
  );
}

function FunnelVisualization({ funnel }: { funnel: any }) {
  const maxValue = Math.max(
    funnel.leads,
    funnel.conversations_started,
    funnel.quotes_sent,
    funnel.handoffs,
    funnel.bookings
  );

  const stages = [
    { label: 'Leads', value: funnel.leads },
    { label: 'Conversations', value: funnel.conversations_started },
    { label: 'Quotes', value: funnel.quotes_sent },
    { label: 'Handoffs', value: funnel.handoffs },
    { label: 'Bookings', value: funnel.bookings },
  ];

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-bold text-[var(--color-text)] mb-6">Sales Funnel</h3>
      <div className="space-y-4">
        {stages.map((stage, i) => {
          const pct = (stage.value / maxValue) * 100;
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-[var(--color-text)]">{stage.label}</span>
                <span className="text-sm text-[var(--color-text-soft)]">{stage.value}</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-[var(--color-gold)] to-transparent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── KPI Tile ──────────────────────────────────────────────────────────────────
function KPITile({ label, value, suffix }: { label: string; value: number | string; suffix: string }) {
  return (
    <div className="surface rounded-2xl p-6">
      <p className="text-sm text-[var(--color-text-soft)] mb-2">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-[var(--color-gold)]">{value}</span>
        {suffix && <span className="text-[var(--color-text-soft)]">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Lead Temperature Chart (Donut/Ring using SVG) ──────────────────────────────
function LeadTemperatureChart({ data }: { data: { hot: number; warm: number; cold: number } }) {
  const total = data.hot + data.warm + data.cold;
  const hotPct = total > 0 ? (data.hot / total) * 100 : 0;
  const warmPct = total > 0 ? (data.warm / total) * 100 : 0;
  const coldPct = total > 0 ? (data.cold / total) * 100 : 0;

  // SVG donut chart using conic-gradient and stroke-dasharray
  const hotDash = (hotPct * 2.51) / 100;
  const warmDash = (warmPct * 2.51) / 100;
  const coldDash = (coldPct * 2.51) / 100;

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-6">Lead Temperature</h3>
      <div className="flex items-center justify-center">
        <svg width="140" height="140" viewBox="0 0 140 140">
          {/* Hot (gold) */}
          <circle
            cx="70"
            cy="70"
            r="50"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="12"
            strokeDasharray={`${hotDash.toFixed(2)} 2.51`}
            transform="rotate(-90 70 70)"
            opacity="1"
          />
          {/* Warm (green) */}
          <circle
            cx="70"
            cy="70"
            r="50"
            fill="none"
            stroke="#22c55e"
            strokeWidth="12"
            strokeDasharray={`${warmDash.toFixed(2)} 2.51`}
            strokeDashoffset={`-${hotDash.toFixed(2)}`}
            transform="rotate(-90 70 70)"
            opacity="1"
          />
          {/* Cold (slate) */}
          <circle
            cx="70"
            cy="70"
            r="50"
            fill="none"
            stroke="#64748b"
            strokeWidth="12"
            strokeDasharray={`${coldDash.toFixed(2)} 2.51`}
            strokeDashoffset={`-${(hotDash + warmDash).toFixed(2)}`}
            transform="rotate(-90 70 70)"
            opacity="1"
          />
          {/* Center text */}
          <text x="70" y="75" textAnchor="middle" fill="white" fontSize="24" fontWeight="bold">
            {total}
          </text>
        </svg>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-bold text-[var(--color-gold)]">{data.hot}</p>
          <p className="text-xs text-[var(--color-text-soft)]">🔥 Hot</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-green-400">{data.warm}</p>
          <p className="text-xs text-[var(--color-text-soft)]">✅ Warm</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-400">{data.cold}</p>
          <p className="text-xs text-[var(--color-text-soft)]">🧊 Cold</p>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Status Bar Chart ──────────────────────────────────────────────
function AppointmentChart({
  data,
}: {
  data: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    no_show: number;
  };
}) {
  const statuses = [
    { label: "Pending", count: data.pending, color: "bg-[var(--color-gold)]" },
    { label: "Confirmed", count: data.confirmed, color: "bg-green-500" },
    { label: "Completed", count: data.completed, color: "bg-emerald-600" },
    { label: "Cancelled", count: data.cancelled, color: "bg-red-600" },
    { label: "No Show", count: data.no_show, color: "bg-gray-600" },
  ];

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-6">Appointment Status</h3>
      <div className="space-y-4">
        {statuses.map((status) => {
          const pct = data.total > 0 ? (status.count / data.total) * 100 : 0;
          return (
            <div key={status.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-[var(--color-text-soft)]">{status.label}</span>
                <span className="text-sm font-semibold text-[var(--color-text)]">{status.count}</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className={`${status.color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lead Trend Chart (SVG Line Chart) ──────────────────────────────────────────
function LeadTrendChart({ trend }: { trend: Array<{ date: string; count: number }> }) {
  if (!trend || trend.length === 0) {
    return (
      <div className="surface rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Leads Over Time</h3>
        <p className="text-sm text-[var(--color-text-soft)]">No trend data available</p>
      </div>
    );
  }

  // Calculate SVG coordinates
  const maxCount = Math.max(...trend.map((t) => t.count), 1);
  const width = 600;
  const height = 120;
  const padding = 10;

  const points = trend.map((t, i) => {
    const x = (i / (trend.length - 1 || 1)) * (width - padding * 2) + padding;
    const y = height - (t.count / maxCount) * (height - padding * 2) - padding;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Leads Over Time (30 days)</h3>
      <svg width="100%" height="160" viewBox={`0 0 ${width} 160`} preserveAspectRatio="none">
        {/* Gradient fill */}
        <defs>
          <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines (every 7 days) */}
        {trend.map((_, i) => {
          if (i % 7 === 0) {
            const x = (i / (trend.length - 1 || 1)) * (width - padding * 2) + padding;
            return (
              <line key={`grid-${i}`} x1={x} y1="0" x2={x} y2={height} stroke="#374151" strokeWidth="1" />
            );
          }
          return null;
        })}

        {/* Fill under line */}
        <polygon
          points={`${padding},${height} ${polyline} ${width - padding},${height}`}
          fill="url(#trendGradient)"
        />

        {/* Line */}
        <polyline points={polyline} fill="none" stroke="#fbbf24" strokeWidth="2" />

        {/* X-axis labels (every 7 days) */}
        {trend.map((t, i) => {
          if (i % 7 === 0) {
            const x = (i / (trend.length - 1 || 1)) * (width - padding * 2) + padding;
            return (
              <text key={`label-${i}`} x={x} y={height + 15} textAnchor="middle" fontSize="11" fill="#9ca3af">
                {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            );
          }
          return null;
        })}
      </svg>
    </div>
  );
}

// ─── Conversation Funnel ──────────────────────────────────────────────────────
function ConversationFunnel({ stats }: { stats: StatsData }) {
  const leads = stats.leads.total;
  const conversations = stats.conversations.total;
  const handoffs = stats.conversations.handoffs;
  const completed = stats.appointments.completed;

  const stages = [
    { label: "Leads", count: leads, color: "bg-[var(--color-gold)]" },
    { label: "Conversations", count: conversations, color: "bg-blue-500" },
    { label: "Handoffs", count: handoffs, color: "bg-purple-500" },
    { label: "Completed", count: completed, color: "bg-emerald-600" },
  ];

  const maxWidth = 100;

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-6">Conversion Funnel</h3>
      <div className="space-y-4">
        {stages.map((stage, idx) => {
          const pct = leads > 0 ? (stage.count / leads) * 100 : 0;
          const widthPct = Math.max(pct, 5); // at least 5% visible
          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--color-text)]">{stage.label}</span>
                <span className="text-sm text-[var(--color-text-soft)]">
                  {stage.count} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className={`${stage.color} h-8 rounded-lg flex items-center justify-center text-sm font-semibold text-black`} style={{ width: `${widthPct}%` }}>
                {stage.count > 0 && stage.count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Services Table ─────────────────────────────────────────────────────────
function TopServicesTable({ services }: { services: Array<{ service: string; bookings: number; revenue_cents: number }> }) {
  if (!services || services.length === 0) {
    return (
      <div className="surface rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Top Services</h3>
        <p className="text-sm text-[var(--color-text-soft)]">No service data available</p>
      </div>
    );
  }

  return (
    <div className="surface rounded-2xl p-6 overflow-hidden">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Top Services</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-[var(--color-gold)] bg-opacity-10">
              <th className="text-left px-3 py-2 font-semibold text-[var(--color-gold)]">Service</th>
              <th className="text-right px-3 py-2 font-semibold text-[var(--color-gold)]">Bookings</th>
              <th className="text-right px-3 py-2 font-semibold text-[var(--color-gold)]">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service, idx) => (
              <tr
                key={service.service}
                className={`border-b border-gray-800 ${idx % 2 === 0 ? "bg-gray-900 bg-opacity-50" : ""}`}
              >
                <td className="px-3 py-2 text-[var(--color-text)]">{service.service}</td>
                <td className="text-right px-3 py-2 text-[var(--color-text-soft)]">{service.bookings}</td>
                <td className="text-right px-3 py-2 font-semibold text-green-400">${(service.revenue_cents / 100).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Review Performance Card ────────────────────────────────────────────────────
function ReviewPerformanceCard({ reviews }: { reviews: { total: number; routed_review: number; routed_feedback: number; avg_sentiment: number } }) {
  const sentimentStars = Math.round(reviews.avg_sentiment * 2) / 2;
  const reviewPct = reviews.total > 0 ? (reviews.routed_review / reviews.total) * 100 : 0;
  const feedbackPct = reviews.total > 0 ? (reviews.routed_feedback / reviews.total) * 100 : 0;

  return (
    <div className="surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-6">Review Performance</h3>

      {reviews.total === 0 ? (
        <p className="text-sm text-[var(--color-text-soft)]">No review data available</p>
      ) : (
        <div className="space-y-6">
          {/* Sentiment */}
          <div>
            <p className="text-sm text-[var(--color-text-soft)] mb-2">Average Sentiment</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-[var(--color-gold)]">{sentimentStars.toFixed(1)}</span>
              <span className="text-lg">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i}>{i < Math.floor(sentimentStars) ? "⭐" : "☆"}</span>
                ))}
              </span>
            </div>
          </div>

          {/* Routing */}
          <div>
            <p className="text-sm text-[var(--color-text-soft)] mb-3">Routing Distribution</p>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--color-text)]">Google Review</span>
                  <span className="text-sm font-semibold text-[var(--color-text-soft)]">{reviews.routed_review}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div className="bg-[var(--color-gold)] h-2 rounded-full" style={{ width: `${reviewPct}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--color-text)]">Feedback Form</span>
                  <span className="text-sm font-semibold text-[var(--color-text-soft)]">{reviews.routed_feedback}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: `${feedbackPct}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
