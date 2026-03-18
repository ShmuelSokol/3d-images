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
  users: { id: string; email: string; createdAt: string; jobCount: number }[];
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
  const [tab, setTab] = useState<"generator" | "overview" | "users" | "activity" | "coupons">("generator");
  const [coupons, setCoupons] = useState<{ id: string; code: string; credits: number; maxRedemptions: number; timesRedeemed: number; expiresAt: string | null; createdAt: string; redemptions: { id: string; createdAt: string; user: { email: string } }[] }[]>([]);
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

  const loadCoupons = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coupons");
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d)) setCoupons(d);
      }
    } catch { /* ignore */ }
  }, []);

  // Load coupons when switching to coupons tab
  useEffect(() => {
    if (tab === "coupons" && authed) loadCoupons();
  }, [tab, authed, loadCoupons]);

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
          {(["generator", "overview", "users", "activity", "coupons"] as const).map((t) => (
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
        {tab !== "generator" && tab !== "coupons" && !stats && (
          <div>
            <p className="text-gray-500">Loading stats...</p>
            {statsError && <p className="text-red-400 text-sm mt-2">{statsError}</p>}
          </div>
        )}

        {tab !== "generator" && (stats || tab === "coupons") && (
          <>
            {/* Overview Tab */}
            {tab === "overview" && stats && (
              <div className="space-y-6">
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Total Uploads" value={stats.totalJobs} />
                  <StatCard label="Registered Users" value={stats.totalUsers} />
                  <StatCard label="Unique Sessions" value={stats.totalSessions} />
                  <StatCard label="Success Rate" value={`${stats.totalJobs > 0 ? Math.round(((stats.statusCounts.done || 0) / stats.totalJobs) * 100) : 0}%`} />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-gray-500">
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Uploads</th>
                      <th className="px-4 py-3 font-medium">Registered</th>
                      <th className="px-4 py-3 font-medium">User ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No registered users yet</td></tr>
                    ) : (
                      stats.users.map((u) => (
                        <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-4 py-3 text-gray-200">{u.email}</td>
                          <td className="px-4 py-3 text-gray-400">{u.jobCount}</td>
                          <td className="px-4 py-3 text-gray-400">{formatDate(u.createdAt)}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.id}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {/* Anonymous sessions */}
                <div className="border-t border-gray-800 px-4 py-3">
                  <p className="text-xs text-gray-500">
                    + {stats.totalSessions} anonymous session{stats.totalSessions !== 1 ? "s" : ""} (not registered)
                  </p>
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
