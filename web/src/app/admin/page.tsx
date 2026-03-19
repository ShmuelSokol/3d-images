"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

interface Stats {
  totalJobs: number;
  totalUsers: number;
  totalSessions: number;
  statusCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  dailyData: { date: string; count: number }[];
  revenueData: { date: string; revenue: number }[];
  queueJobs: {
    id: string;
    fileName: string;
    status: string;
    mediaType: string;
    frameCount: number | null;
    framesDone: number;
    startedAt: string | null;
    createdAt: string;
  }[];
  users: { id: string; email: string; credits: number; createdAt: string; jobCount: number; paymentCount: number }[];
  payments: { id: string; email: string; amount: number; credits: number; status: string; stripeSessionId: string; createdAt: string }[];
  recentJobs: {
    id: string;
    fileName: string;
    status: string;
    mediaType: string;
    intensity: number;
    colorMode: string;
    sessionId: string | null;
    userId: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}

const ImageProcessor = lazy(() => import("../components/ImageProcessor"));

const STATUS_COLORS: Record<string, string> = {
  done: "#22c55e",
  pending: "#eab308",
  processing: "#3b82f6",
  error: "#ef4444",
  cancelled: "#6b7280",
};

const PIE_COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e"];

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"generator" | "overview" | "users" | "payments" | "queue" | "activity" | "coupons" | "tickets">("generator");
  const [coupons, setCoupons] = useState<{ id: string; code: string; credits: number; maxRedemptions: number; timesRedeemed: number; expiresAt: string | null; createdAt: string; redemptions: { id: string; createdAt: string; user: { email: string } }[] }[]>([]);
  const [tickets, setTickets] = useState<{ id: string; email: string; subject: string; message: string; status: string; adminNote: string | null; createdAt: string }[]>([]);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponCredits, setNewCouponCredits] = useState(100);
  const [newCouponMax, setNewCouponMax] = useState(1);
  const [couponError, setCouponError] = useState("");

  // Check auth
  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((d) => setAuthed(d.admin))
      .catch(() => setAuthed(false));
  }, []);

  const [statsError, setStatsError] = useState("");

  const loadStats = useCallback(async () => {
    try {
      setStatsError("");
      const res = await fetch("/api/admin/stats");
      if (res.ok) {
        setStats(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setStatsError(`${res.status}: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setStatsError(`Network error: ${(err as Error).message}`);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tickets");
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d)) setTickets(d);
      }
    } catch { /* ignore */ }
  }, []);

  const loadCoupons = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coupons");
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d)) setCoupons(d);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-refresh queue tab every 10s
  useEffect(() => {
    if (tab !== "queue" || !authed) return;
    const interval = setInterval(loadStats, 10_000);
    return () => clearInterval(interval);
  }, [tab, authed, loadStats]);

  // Load coupons/tickets when switching to those tabs
  useEffect(() => {
    if (tab === "coupons" && authed) loadCoupons();
    if (tab === "tickets" && authed) loadTickets();
  }, [tab, authed, loadCoupons, loadTickets]);

  useEffect(() => {
    if (authed && tab !== "generator") loadStats();
  }, [authed, tab, loadStats]);

  async function handleLogin() {
    setError("");
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setAuthed(true);
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setAuthed(false);
    setStats(null);
  }

  // Login screen
  if (authed === null) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="w-80 bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
          <h1 className="text-xl font-bold text-center">Admin Login</h1>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            onClick={handleLogin}
            className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
          >
            Log in
          </button>
        </div>
      </div>
    );
  }

  // Dashboard
  const statusData = stats
    ? Object.entries(stats.statusCounts).map(([name, value]) => ({ name, value }))
    : [];
  const typeData = stats
    ? Object.entries(stats.typeCounts).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto p-4 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <div className="flex items-center gap-3">
            <button onClick={loadStats} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors">
              Refresh
            </button>
            <button onClick={handleLogout} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors">
              Log out
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit">
          {(["generator", "overview", "users", "payments", "queue", "activity", "coupons", "tickets"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t ? "bg-cyan-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Generator Tab */}
        {tab === "generator" && (
          <Suspense fallback={<p className="text-gray-500">Loading...</p>}>
            <ImageProcessor />
          </Suspense>
        )}

        {/* Admin Tabs (need stats) */}
        {tab !== "generator" && tab !== "coupons" && tab !== "tickets" && !stats && (
          <div>
            <p className="text-gray-500">Loading stats...</p>
            {statsError && <p className="text-red-400 text-sm mt-2">{statsError}</p>}
          </div>
        )}

        {tab !== "generator" && (stats || tab === "coupons" || tab === "tickets") && (
          <>
            {/* Overview Tab */}
            {tab === "overview" && stats && (
              <div className="space-y-6">
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <StatCard label="Total Uploads" value={stats.totalJobs} />
                  <StatCard label="Registered Users" value={stats.totalUsers} />
                  <StatCard label="Unique Sessions" value={stats.totalSessions} />
                  <StatCard label="Success Rate" value={`${stats.totalJobs > 0 ? Math.round(((stats.statusCounts.done || 0) / stats.totalJobs) * 100) : 0}%`} />
                  <StatCard label="Total Revenue" value={`$${((stats.payments || []).filter(p => p.status === "completed").reduce((sum, p) => sum + p.amount, 0) / 100).toFixed(2)}`} />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Revenue over time */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 md:col-span-2">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Revenue (Last 30 Days)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.revenueData}>
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#6b7280", fontSize: 10 }}
                          tickFormatter={(v: string) => v.slice(5)}
                        />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickFormatter={(v: number) => `$${v}`} />
                        <Tooltip
                          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                          formatter={(v) => [`$${Number(v).toFixed(2)}`, "Revenue"]}
                        />
                        <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Uploads over time */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Uploads (Last 30 Days)</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={stats.dailyData}>
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "#6b7280", fontSize: 10 }}
                          tickFormatter={(v: string) => v.slice(5)}
                        />
                        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "#9ca3af" }}
                        />
                        <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Status breakdown */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Status Breakdown</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={3}
                          dataKey="value"
                          label={(props) => `${props.name}: ${props.value}`}
                        >
                          {statusData.map((entry) => (
                            <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#6b7280"} />
                          ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Type breakdown */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Media Types</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={typeData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={3}
                          dataKey="value"
                          label={(props) => `${props.name}: ${props.value}`}
                        >
                          {typeData.map((entry, i) => (
                            <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Settings distribution */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Popular Settings</h3>
                    <div className="space-y-3 text-sm">
                      {(() => {
                        const intensities: Record<number, number> = {};
                        const colorModes: Record<string, number> = {};
                        for (const j of stats.recentJobs) {
                          intensities[j.intensity] = (intensities[j.intensity] || 0) + 1;
                          colorModes[j.colorMode] = (colorModes[j.colorMode] || 0) + 1;
                        }
                        const topIntensity = Object.entries(intensities)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 5);
                        return (
                          <>
                            <div>
                              <p className="text-gray-500 text-xs mb-1">Top Intensities</p>
                              {topIntensity.map(([v, c]) => (
                                <div key={v} className="flex justify-between text-gray-300">
                                  <span>Intensity {v}</span>
                                  <span className="text-gray-500">{c} uses</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <p className="text-gray-500 text-xs mb-1">Color Modes</p>
                              {Object.entries(colorModes).map(([m, c]) => (
                                <div key={m} className="flex justify-between text-gray-300">
                                  <span>{m}</span>
                                  <span className="text-gray-500">{c} uses</span>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Users Tab */}
            {tab === "users" && stats && (
              <div className="space-y-4">
                {/* Export button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      window.open("/api/admin/users?format=csv", "_blank");
                    }}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors"
                  >
                    Export CSV
                  </button>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500">
                          <th className="px-4 py-3 font-medium">Email</th>
                          <th className="px-4 py-3 font-medium">Credits</th>
                          <th className="px-4 py-3 font-medium">Uploads</th>
                          <th className="px-4 py-3 font-medium">Payments</th>
                          <th className="px-4 py-3 font-medium">Registered</th>
                          <th className="px-4 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.users.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No registered users yet</td></tr>
                        ) : (
                          stats.users.map((u) => (
                            <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                              <td className="px-4 py-3 text-gray-200">{u.email}</td>
                              <td className="px-4 py-3">
                                <span className={`font-medium ${u.credits <= 0 ? "text-red-400" : u.credits <= 5 ? "text-yellow-400" : "text-green-400"}`}>
                                  {u.credits}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-400">{u.jobCount}</td>
                              <td className="px-4 py-3 text-gray-400">{u.paymentCount}</td>
                              <td className="px-4 py-3 text-gray-400">{formatDate(u.createdAt)}</td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button
                                    onClick={async () => {
                                      const amt = prompt(`Adjust credits for ${u.email}\nCurrent: ${u.credits}\n\nEnter amount (positive to add, negative to remove):`);
                                      if (!amt) return;
                                      const amount = parseInt(amt);
                                      if (isNaN(amount)) return;
                                      const reason = prompt("Reason (optional):") || "";
                                      await fetch("/api/admin/users", {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ userId: u.id, action: "adjustCredits", amount, reason }),
                                      });
                                      loadStats();
                                    }}
                                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                                  >
                                    Credits
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Suspend ${u.email}? This will set their credits to 0.`)) return;
                                      await fetch("/api/admin/users", {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ userId: u.id, action: "suspend" }),
                                      });
                                      loadStats();
                                    }}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                                  >
                                    Suspend
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {/* Anonymous sessions */}
                  <div className="border-t border-gray-800 px-4 py-3">
                    <p className="text-xs text-gray-500">
                      + {stats.totalSessions} anonymous session{stats.totalSessions !== 1 ? "s" : ""} (not registered)
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Payments Tab */}
            {tab === "payments" && stats && (
              <div className="space-y-4">
                {/* Revenue summary */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <StatCard
                    label="Total Revenue"
                    value={`$${((stats.payments || []).filter(p => p.status === "completed").reduce((sum, p) => sum + p.amount, 0) / 100).toFixed(2)}`}
                  />
                  <StatCard
                    label="Completed Payments"
                    value={(stats.payments || []).filter(p => p.status === "completed").length}
                  />
                  <StatCard
                    label="Credits Sold"
                    value={(stats.payments || []).filter(p => p.status === "completed").reduce((sum, p) => sum + p.credits, 0)}
                  />
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500">
                          <th className="px-4 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Email</th>
                          <th className="px-4 py-3 font-medium">Amount</th>
                          <th className="px-4 py-3 font-medium">Credits</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.payments || []).length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No payments yet</td></tr>
                        ) : (
                          (stats.payments || []).map((p) => (
                            <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                              <td className="px-4 py-3 text-gray-200">{p.email}</td>
                              <td className="px-4 py-3 text-green-400 font-medium">${(p.amount / 100).toFixed(2)}</td>
                              <td className="px-4 py-3 text-gray-300">{p.credits}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  p.status === "completed" ? "bg-green-900/50 text-green-300" :
                                  p.status === "refunded" ? "bg-red-900/50 text-red-300" :
                                  "bg-yellow-900/50 text-yellow-300"
                                }`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {p.status === "completed" && (
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Refund $${(p.amount / 100).toFixed(2)} to ${p.email}? This will also deduct ${p.credits} credits.`)) return;
                                      const reason = prompt("Reason (optional):") || "";
                                      try {
                                        const res = await fetch("/api/admin/refund", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ paymentId: p.id, reason }),
                                        });
                                        const data = await res.json();
                                        if (!res.ok) {
                                          alert(data.error || "Refund failed");
                                          return;
                                        }
                                        alert("Refund issued successfully");
                                        loadStats();
                                      } catch {
                                        alert("Network error");
                                      }
                                    }}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                                  >
                                    Refund
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Queue Tab */}
            {tab === "queue" && stats && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Job Queue</h3>
                  <button
                    onClick={async () => {
                      try {
                        await fetch("/api/admin/kick", { method: "POST" });
                        loadStats();
                      } catch { /* ignore */ }
                    }}
                    className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded-lg text-xs font-medium transition-colors"
                  >
                    Kick Queue
                  </button>
                </div>

                {/* Active / processing jobs */}
                {stats.queueJobs.length === 0 ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">
                    No jobs in queue
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.queueJobs.map((j) => {
                      const isVideo = j.mediaType === "video";
                      const progress = isVideo && j.frameCount
                        ? Math.round((j.framesDone / j.frameCount) * 100)
                        : null;
                      const elapsed = j.startedAt
                        ? Math.round((Date.now() - new Date(j.startedAt).getTime()) / 1000)
                        : null;
                      const eta = isVideo && j.frameCount && j.framesDone > 0 && elapsed
                        ? Math.round(((j.frameCount - j.framesDone) / j.framesDone) * elapsed)
                        : null;

                      return (
                        <div key={j.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                j.status === "processing" ? "bg-blue-900/50 text-blue-300" : "bg-yellow-900/50 text-yellow-300"
                              }`}>
                                {j.status}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                j.mediaType === "video" ? "bg-purple-900/50 text-purple-300" : "bg-cyan-900/50 text-cyan-300"
                              }`}>
                                {j.mediaType}
                              </span>
                              <span className="text-sm text-gray-200 truncate max-w-[300px]">{j.fileName}</span>
                            </div>
                            <span className="text-xs text-gray-500 font-mono">{j.id.slice(0, 12)}...</span>
                          </div>

                          {isVideo && j.frameCount && (
                            <div className="mt-3">
                              <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span>Frame {j.framesDone} / {j.frameCount}</span>
                                <span>{progress}%</span>
                              </div>
                              <div className="w-full bg-gray-800 rounded-full h-2">
                                <div
                                  className="bg-cyan-500 h-2 rounded-full transition-all duration-500"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-xs text-gray-500 mt-1">
                                {elapsed !== null && <span>Elapsed: {formatDuration(elapsed)}</span>}
                                {eta !== null && <span>ETA: {formatDuration(eta)}</span>}
                              </div>
                            </div>
                          )}

                          <div className="flex justify-between text-xs text-gray-500 mt-2">
                            <span>Created: {formatDate(j.createdAt)}</span>
                            {j.startedAt && <span>Started: {formatDate(j.startedAt)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Queue summary */}
                <div className="grid grid-cols-3 gap-4">
                  <StatCard label="Processing" value={stats.queueJobs.filter(j => j.status === "processing").length} />
                  <StatCard label="Pending" value={stats.queueJobs.filter(j => j.status === "pending").length} />
                  <StatCard label="Total Done" value={stats.statusCounts.done || 0} />
                </div>
              </div>
            )}

            {/* Activity Tab */}
            {tab === "activity" && stats && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-left text-gray-500">
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">File</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Settings</th>
                        <th className="px-4 py-3 font-medium">User / Session</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentJobs.map((j) => (
                        <tr key={j.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDate(j.createdAt)}</td>
                          <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">{j.fileName}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              j.mediaType === "video" ? "bg-purple-900/50 text-purple-300" : "bg-cyan-900/50 text-cyan-300"
                            }`}>
                              {j.mediaType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[j.status] || "#6b7280" }} />
                              <span className="text-gray-300">{j.status}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            i:{j.intensity} {j.colorMode}
                          </td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                            {j.userId ? (
                              <span className="text-cyan-600" title={j.userId}>{j.userId.slice(0, 8)}...</span>
                            ) : j.sessionId ? (
                              <span title={j.sessionId}>{j.sessionId.slice(0, 8)}...</span>
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Coupons Tab */}
            {tab === "coupons" && (
              <div className="space-y-6">
                {/* Create coupon */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">Create Coupon</h3>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Code</label>
                      <input
                        type="text"
                        value={newCouponCode}
                        onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                        placeholder="e.g. WELCOME100"
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 w-44"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Credits</label>
                      <input
                        type="number"
                        value={newCouponCredits}
                        onChange={(e) => setNewCouponCredits(parseInt(e.target.value) || 100)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 w-24"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Max Uses</label>
                      <input
                        type="number"
                        value={newCouponMax}
                        onChange={(e) => setNewCouponMax(parseInt(e.target.value) || 1)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 w-24"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        setCouponError("");
                        try {
                          const res = await fetch("/api/admin/coupons", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ code: newCouponCode, credits: newCouponCredits, maxRedemptions: newCouponMax }),
                          });
                          if (!res.ok) {
                            const d = await res.json();
                            setCouponError(d.error || "Failed");
                            return;
                          }
                          setNewCouponCode("");
                          loadCoupons();
                        } catch { setCouponError("Network error"); }
                      }}
                      disabled={!newCouponCode.trim()}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                  {couponError && <p className="text-red-400 text-xs mt-2">{couponError}</p>}
                </div>

                {/* Coupon list */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-gray-500">
                          <th className="px-4 py-3 font-medium">Code</th>
                          <th className="px-4 py-3 font-medium">Credits</th>
                          <th className="px-4 py-3 font-medium">Used / Max</th>
                          <th className="px-4 py-3 font-medium">Redeemed By</th>
                          <th className="px-4 py-3 font-medium">Created</th>
                          <th className="px-4 py-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {coupons.map((c) => (
                          <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="px-4 py-3 font-mono text-cyan-400">{c.code}</td>
                            <td className="px-4 py-3 text-gray-300">{c.credits}</td>
                            <td className="px-4 py-3 text-gray-400">{c.timesRedeemed} / {c.maxRedemptions}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {c.redemptions.map(r => r.user.email).join(", ") || "—"}
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={async () => {
                                  await fetch(`/api/admin/coupons?id=${c.id}`, { method: "DELETE" });
                                  setCoupons(prev => prev.filter(x => x.id !== c.id));
                                }}
                                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                        {coupons.length === 0 && (
                          <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No coupons yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {/* Tickets Tab */}
            {tab === "tickets" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Support Tickets</h3>
                  <div className="flex gap-2 text-xs text-gray-500">
                    <span className="px-2 py-0.5 bg-yellow-900/50 text-yellow-300 rounded-full">
                      {tickets.filter(t => t.status === "open").length} open
                    </span>
                    <span className="px-2 py-0.5 bg-green-900/50 text-green-300 rounded-full">
                      {tickets.filter(t => t.status === "closed").length} closed
                    </span>
                  </div>
                </div>

                {tickets.length === 0 ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">
                    No tickets yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tickets.map((t) => (
                      <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                t.status === "open" ? "bg-yellow-900/50 text-yellow-300" :
                                t.status === "in-progress" ? "bg-blue-900/50 text-blue-300" :
                                "bg-green-900/50 text-green-300"
                              }`}>
                                {t.status}
                              </span>
                              <span className="text-sm font-medium text-gray-200">{t.subject}</span>
                            </div>
                            <p className="text-xs text-gray-500">{t.email} &middot; {formatDate(t.createdAt)}</p>
                          </div>
                          <div className="flex gap-2">
                            {t.status !== "closed" && (
                              <button
                                onClick={async () => {
                                  await fetch("/api/admin/tickets", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ ticketId: t.id, status: "closed" }),
                                  });
                                  loadTickets();
                                }}
                                className="text-xs text-green-400 hover:text-green-300 transition-colors"
                              >
                                Close
                              </button>
                            )}
                            {t.status === "closed" && (
                              <button
                                onClick={async () => {
                                  await fetch("/api/admin/tickets", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ ticketId: t.id, status: "open" }),
                                  });
                                  loadTickets();
                                }}
                                className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap mt-2">{t.message}</p>
                        {t.adminNote && (
                          <div className="mt-3 bg-gray-800 rounded-lg p-3 text-xs text-gray-400">
                            <span className="text-cyan-400 font-medium">Admin note:</span> {t.adminNote}
                          </div>
                        )}
                        <button
                          onClick={async () => {
                            const note = prompt("Admin note:", t.adminNote || "");
                            if (note === null) return;
                            await fetch("/api/admin/tickets", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ ticketId: t.id, adminNote: note }),
                            });
                            loadTickets();
                          }}
                          className="text-xs text-gray-500 hover:text-gray-400 mt-2 transition-colors"
                        >
                          {t.adminNote ? "Edit note" : "Add note"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-100">{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
