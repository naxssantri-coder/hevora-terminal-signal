import React, { useState, useEffect } from 'react';
import { Edit2, Trash2, Save, CheckCircle, AlertCircle, AlertTriangle, Bell, FileText, Settings, Shield, Sparkles, Zap, BrainCircuit, Activity, Bot, KeyRound, Copy, Wifi, WifiOff } from 'lucide-react';
import {
  PlatformUpdate,
  ResearchItem,
  SiteSettings,
  EngineSettings,
  AIInsightLog,
  ProviderHealthRow,
  AutotradeSettingsPublic,
  AutotradeLogEntry,
  AutotradeKillSwitchLogEntry,
  AutotradePairSettings,
  PairId,
} from '../types';
import { ImageUploadField } from './ImageUploadField';
import { PAIRS_LIST } from '../data/pairs';

type AdminTab = 'updates' | 'research' | 'settings' | 'data-health' | 'auto-trading';

const AUTOTRADE_ELIGIBLE_PAIRS = PAIRS_LIST.filter((p) => p.signalEngineEnabled);

const HEALTH_STATUS_STYLE: Record<ProviderHealthRow['status'], string> = {
  LIVE: 'bg-[#2ECC71]/10 border-[#2ECC71]/30 text-[#2ECC71]',
  DELAYED: 'bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623]',
  STALE: 'bg-[#F5A623]/10 border-[#F5A623]/30 text-[#F5A623]',
  UNAVAILABLE: 'bg-[#FF4D4F]/10 border-[#FF4D4F]/30 text-[#FF4D4F]',
};

export const AdminDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string>('');
  const [isRedisActive, setIsRedisActive] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('updates');

  // Data Stores
  const [updates, setUpdates] = useState<PlatformUpdate[]>([]);
  const [research, setResearch] = useState<ResearchItem[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({ siteLogoUrl: '', siteTagline: 'by HEVORA', signalsBlurred: false });
  const [engineSettings, setEngineSettings] = useState<EngineSettings>({ autoBreakevenEnabled: false });
  const [aiInsights, setAiInsights] = useState<AIInsightLog[]>([]);
  const [savingEngineSettings, setSavingEngineSettings] = useState<boolean>(false);
  const [dataHealth, setDataHealth] = useState<ProviderHealthRow[] | null>(null);
  const [dataHealthGeneratedAt, setDataHealthGeneratedAt] = useState<string | null>(null);
  const [loadingDataHealth, setLoadingDataHealth] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto Trading (MT5 EA) State
  const [autotradeSettings, setAutotradeSettings] = useState<AutotradeSettingsPublic>({
    enabled: false,
    mode: 'dry_run',
    tp1CloseEnabled: true,
    tp2CloseEnabled: true,
    pairs: {},
    maxConcurrentTrades: 3,
    killSwitchEnabled: false,
    killSwitchLastChangedAt: null,
    bridgeKeyLastRotated: null,
    bridgeKeyConfigured: false,
  });
  const [bridgeLastSeenAt, setBridgeLastSeenAt] = useState<string | null>(null);
  const [autotradeLog, setAutotradeLog] = useState<AutotradeLogEntry[]>([]);
  const [killSwitchLog, setKillSwitchLog] = useState<AutotradeKillSwitchLogEntry[]>([]);
  const [loadingAutotrade, setLoadingAutotrade] = useState<boolean>(false);
  const [savingAutotrade, setSavingAutotrade] = useState<boolean>(false);
  const [togglingKillSwitch, setTogglingKillSwitch] = useState<boolean>(false);
  const [rotatingBridgeKey, setRotatingBridgeKey] = useState<boolean>(false);
  const [revealedBridgeKey, setRevealedBridgeKey] = useState<string | null>(null);

  // Editing States
  const [editingUpdate, setEditingUpdate] = useState<Partial<PlatformUpdate> | null>(null);
  const [editingResearch, setEditingResearch] = useState<Partial<ResearchItem> | null>(null);

  // Check initial admin verification status via Basic Auth endpoint
  useEffect(() => {
    const checkAuth = async () => {
      setCheckingAuth(true);
      try {
        const res = await fetch('/api/admin/verify');
        if (res.ok) {
          setIsAuthenticated(true);
          setAuthError('');
        } else {
          setIsAuthenticated(false);
          setAuthError('Gagal memuat dashboard admin. Refresh halaman dan masukkan kredensial saat diminta browser.');
        }
      } catch (err) {
        setIsAuthenticated(false);
        setAuthError('Gagal memuat dashboard admin. Refresh halaman dan masukkan kredensial saat diminta browser.');
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  // Check storage health
  const checkStorageHealth = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/admin/storage-health');
      if (res.ok) {
        const data = await res.json();
        setIsRedisActive(Boolean(data.redisActive));
      } else {
        setIsRedisActive(false);
      }
    } catch (err) {
      setIsRedisActive(false);
    }
  };

  // Fetch data when authenticated or activeTab changes
  const fetchAdminData = async () => {
    if (!isAuthenticated) return;
    try {
      const [uRes, rRes, sRes, esRes, aiRes] = await Promise.all([
        fetch('/api/updates'),
        fetch('/api/research'),
        fetch('/api/settings'),
        fetch('/api/engine/settings'),
        fetch('/api/admin/ai-insights'),
      ]);

      if (uRes.ok) setUpdates(await uRes.json());
      if (rRes.ok) setResearch(await rRes.json());
      if (sRes.ok) setSettings(await sRes.json());
      if (esRes.ok) setEngineSettings(await esRes.json());
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        if (aiData && Array.isArray(aiData.insights)) {
          setAiInsights(aiData.insights);
        }
      }
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    }
  };

  const handleSaveEngineSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingEngineSettings(true);
    try {
      const res = await fetch('/api/admin/engine/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(engineSettings),
      });

      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'Settings signal engine berhasil diperbarui.');
      } else {
        showNotice('Gagal menyimpan settings signal engine.', 'error');
      }
    } catch (err) {
      showNotice('Koneksi error saat menyimpan settings signal engine.', 'error');
    } finally {
      setSavingEngineSettings(false);
    }
  };

  const fetchDataHealth = async () => {
    if (!isAuthenticated) return;
    setLoadingDataHealth(true);
    try {
      const res = await fetch('/api/admin/data-health');
      if (res.ok) {
        const data = await res.json();
        setDataHealth(Array.isArray(data.rows) ? data.rows : []);
        setDataHealthGeneratedAt(data.generatedAt ?? null);
      }
    } catch (err) {
      console.error('Failed to fetch data health:', err);
    } finally {
      setLoadingDataHealth(false);
    }
  };

  const fetchAutotrade = async () => {
    if (!isAuthenticated) return;
    setLoadingAutotrade(true);
    try {
      const [settingsRes, logRes, killSwitchLogRes] = await Promise.all([
        fetch('/api/admin/autotrade/settings'),
        fetch('/api/admin/autotrade/log?limit=50'),
        fetch('/api/admin/autotrade/kill-switch/log?limit=20'),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        if (data?.settings) setAutotradeSettings(data.settings);
        setBridgeLastSeenAt(data?.bridgeLastSeenAt ?? null);
      }
      if (logRes.ok) {
        const data = await logRes.json();
        if (Array.isArray(data?.entries)) setAutotradeLog(data.entries);
      }
      if (killSwitchLogRes.ok) {
        const data = await killSwitchLogRes.json();
        if (Array.isArray(data?.entries)) setKillSwitchLog(data.entries);
      }
    } catch (err) {
      console.error('Failed to fetch autotrade data:', err);
    } finally {
      setLoadingAutotrade(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchAdminData();
      checkStorageHealth();
      if (activeTab === 'data-health') fetchDataHealth();
      if (activeTab === 'auto-trading') fetchAutotrade();
    }
  }, [isAuthenticated, activeTab]);

  // Helper notice auto-dismiss
  const showNotice = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Auto Trading handlers
  const saveAutotradeSettings = async (next: AutotradeSettingsPublic) => {
    setSavingAutotrade(true);
    try {
      const res = await fetch('/api/admin/autotrade/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAutotradeSettings(data.settings);
        showNotice(data.message || 'Pengaturan Auto Trading tersimpan.');
      } else {
        showNotice(data.error || 'Gagal menyimpan pengaturan Auto Trading.', 'error');
      }
    } catch (err) {
      showNotice('Koneksi error saat menyimpan pengaturan Auto Trading.', 'error');
    } finally {
      setSavingAutotrade(false);
    }
  };

  const handleToggleAutotradeGlobal = () => {
    const next = { ...autotradeSettings, enabled: !autotradeSettings.enabled };
    if (next.enabled && next.mode === 'live') {
      if (
        !confirm(
          'PERINGATAN: Auto Trading akan AKTIF dalam mode LIVE - order sungguhan akan dikirim ke akun MT5 tanpa konfirmasi manual. Pastikan sudah diuji di akun demo. Lanjutkan?'
        )
      ) {
        return;
      }
    }
    setAutotradeSettings(next);
    saveAutotradeSettings(next);
  };

  // Fase H (roadmap Bagian 1, kill-switch): a SEPARATE toggle from handleToggleAutotradeGlobal
  // above - see AutotradeSettings.killSwitchEnabled's own comment for why. Uses its own dedicated,
  // logged endpoint rather than the generic saveAutotradeSettings PUT.
  const handleToggleKillSwitch = async () => {
    const nextEnabled = !autotradeSettings.killSwitchEnabled;
    if (
      !nextEnabled &&
      !confirm('Melepas kill-switch akan mengizinkan order OPEN baru dikirim ke EA lagi (mengikuti pengaturan per-pair/mode seperti biasa). Lanjutkan?')
    ) {
      return;
    }
    setTogglingKillSwitch(true);
    try {
      const res = await fetch('/api/admin/autotrade/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAutotradeSettings(data.settings);
        if (data.logEntry) setKillSwitchLog((prev) => [data.logEntry, ...prev].slice(0, 20));
        showNotice(data.message || 'Status kill-switch diperbarui.');
      } else {
        showNotice(data.error || 'Gagal mengubah status kill-switch.', 'error');
      }
    } catch (err) {
      showNotice('Koneksi error saat mengubah status kill-switch.', 'error');
    } finally {
      setTogglingKillSwitch(false);
    }
  };

  const handleChangeAutotradeMode = (mode: 'dry_run' | 'live') => {
    if (mode === 'live') {
      if (
        !confirm(
          'PERINGATAN: Memindahkan ke mode LIVE berarti order sungguhan akan dikirim ke akun MT5 dan kerugian finansial nyata bisa terjadi otomatis. Disarankan menguji di akun DEMO terlebih dahulu dan memastikan broker mengizinkan trading otomatis via EA. Lanjutkan ke LIVE?'
        )
      ) {
        return;
      }
    }
    const next = { ...autotradeSettings, mode };
    setAutotradeSettings(next);
    saveAutotradeSettings(next);
  };

  const handleSaveAutotradeForm = (e: React.FormEvent) => {
    e.preventDefault();
    saveAutotradeSettings(autotradeSettings);
  };

  const updateAutotradePair = (pairId: PairId, patch: Partial<AutotradePairSettings>) => {
    const base: AutotradePairSettings = autotradeSettings.pairs[pairId] || {
      enabled: false,
      brokerSymbol: '',
      lotMode: 'fixed',
      lotValue: 0.01,
      maxLot: 1,
    };
    setAutotradeSettings({
      ...autotradeSettings,
      pairs: { ...autotradeSettings.pairs, [pairId]: { ...base, ...patch } },
    });
  };

  const handleRotateBridgeKey = async () => {
    if (
      autotradeSettings.bridgeKeyConfigured &&
      !confirm('Bridge API Key lama akan langsung tidak berlaku. Script EA yang masih memakai key lama akan gagal auth sampai key baru ditempel ulang. Lanjutkan rotate?')
    ) {
      return;
    }
    setRotatingBridgeKey(true);
    try {
      const res = await fetch('/api/admin/autotrade/bridge-key/rotate', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setRevealedBridgeKey(data.bridgeKey);
        setAutotradeSettings((prev) => ({ ...prev, bridgeKeyConfigured: true, bridgeKeyLastRotated: new Date().toISOString() }));
      } else {
        showNotice(data.error || 'Gagal membuat Bridge API Key baru.', 'error');
      }
    } catch (err) {
      showNotice('Koneksi error saat membuat Bridge API Key.', 'error');
    } finally {
      setRotatingBridgeKey(false);
    }
  };

  const bridgeStatusLabel = (() => {
    if (!bridgeLastSeenAt) return { text: 'Belum pernah terhubung', online: false };
    const diffMs = Date.now() - new Date(bridgeLastSeenAt).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const online = diffMin < 5;
    const text =
      diffMin < 1
        ? 'Terhubung - lapor beberapa detik lalu'
        : `Terhubung - lapor terakhir ${diffMin} menit lalu`;
    return { text: online ? text : `Terakhir terlihat ${diffMin} menit lalu (kemungkinan offline)`, online };
  })();

  // Reset Total History
  const handleResetHistory = async () => {
    if (
      !confirm(
        'PERINGATAN PERMANEN: Apakah Anda yakin ingin MENGHAPUS TOTAL seluruh data history signal? Action ini TIDAK BISA DIBATALKAN dan seluruh riwayat performa akan bersih total!'
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/admin/reset-history', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        showNotice(data.message || 'History telah direset total.');
        fetchAdminData();
      } else {
        const err = await res.json();
        showNotice(err.error || 'Gagal mereset history', 'error');
      }
    } catch (e) {
      showNotice('Gagal mereset history', 'error');
    }
  };

  // CRUD for Platform Updates
  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUpdate?.title || !editingUpdate?.description) {
      showNotice('Judul dan Deskripsi Wajib Diisi!', 'error');
      return;
    }

    try {
      const isEdit = Boolean(editingUpdate.id);
      const url = isEdit ? `/api/admin/updates/${editingUpdate.id}` : '/api/admin/updates';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingUpdate),
      });

      if (res.ok) {
        showNotice(`Platform Update berhasil ${isEdit ? 'diperbarui' : 'ditambahkan'}!`);
        setEditingUpdate(null);
        fetchAdminData();
      } else {
        const err = await res.json();
        showNotice(err.error || 'Gagal menyimpan update', 'error');
      }
    } catch (e) {
      showNotice('Gagal menyimpan update', 'error');
    }
  };

  const handleDeleteUpdate = async (id: string) => {
    if (!confirm('Hapus Platform Update ini?')) return;
    try {
      const res = await fetch(`/api/admin/updates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotice('Platform Update dihapus.');
        fetchAdminData();
      }
    } catch (e) {
      showNotice('Gagal menghapus', 'error');
    }
  };

  // CRUD for Research
  const handleSaveResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResearch?.title || !editingResearch?.summary) {
      showNotice('Judul dan Ringkasan Wajib Diisi!', 'error');
      return;
    }

    try {
      const isEdit = Boolean(editingResearch.id);
      const url = isEdit ? `/api/admin/research/${editingResearch.id}` : '/api/admin/research';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingResearch),
      });

      if (res.ok) {
        showNotice(`Research item berhasil ${isEdit ? 'diperbarui' : 'ditambahkan'}!`);
        setEditingResearch(null);
        fetchAdminData();
      } else {
        const err = await res.json();
        showNotice(err.error || 'Gagal menyimpan research', 'error');
      }
    } catch (e) {
      showNotice('Gagal menyimpan research', 'error');
    }
  };

  const handleDeleteResearch = async (id: string) => {
    if (!confirm('Hapus Research report ini?')) return;
    try {
      const res = await fetch(`/api/admin/research/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotice('Research report dihapus.');
        fetchAdminData();
      }
    } catch (e) {
      showNotice('Gagal menghapus', 'error');
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        showNotice('Pengaturan situs berhasil diperbarui!');
        fetchAdminData();
      } else {
        showNotice('Gagal menyimpan pengaturan', 'error');
      }
    } catch (e) {
      showNotice('Gagal menyimpan pengaturan', 'error');
    }
  };

  // Toggle "Blur Signal Publik" - saves immediately on click (not gated behind the branding
  // form's Save button) since this is meant to take effect right away during maintenance.
  const [savingBlurToggle, setSavingBlurToggle] = useState<boolean>(false);
  const handleToggleSignalsBlurred = async () => {
    const nextValue = !settings.signalsBlurred;
    const updated = { ...settings, signalsBlurred: nextValue };
    setSavingBlurToggle(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });

      if (res.ok) {
        setSettings(updated);
        showNotice(
          nextValue
            ? 'Blur Signal Publik AKTIF. Angka entry/SL/TP/harga disembunyikan dari user publik.'
            : 'Blur Signal Publik NONAKTIF. Sinyal kembali tampil normal ke user publik.'
        );
      } else {
        showNotice('Gagal mengubah status Blur Signal Publik', 'error');
      }
    } catch (err) {
      showNotice('Koneksi error saat mengubah status Blur Signal Publik', 'error');
    } finally {
      setSavingBlurToggle(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-[500px] flex items-center justify-center font-mono">
        <div className="w-8 h-8 border-2 border-[#202020] border-t-[var(--accent-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  // Render Access Denied / Instructions if Not Authenticated
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl font-mono text-center">
        <div className="w-12 h-12 rounded-2xl bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/30 flex items-center justify-center text-[var(--accent-gold)] mx-auto mb-4">
          <Shield className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">HEVORA Admin Portal</h1>
        <p className="text-xs text-[var(--text-secondary)] mb-6 leading-relaxed">
          {authError || 'Gagal memuat dashboard admin. Refresh halaman dan masukkan kredensial saat diminta browser.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2.5 rounded-lg bg-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/90 text-black font-extrabold text-xs transition-all cursor-pointer shadow-md inline-flex items-center justify-center gap-2"
        >
          <span>Refresh Halaman</span>
        </button>
      </div>
    );
  }

  // Render Admin Dashboard once Authenticated
  return (
    <div className="space-y-6 font-mono pb-12">
      {/* Redis Cooldown / Inactive Storage Warning Banner */}
      {!isRedisActive && (
        <div className="p-4 rounded-xl bg-[#2A0808] border border-[#FF4D4F]/50 text-[#FF8888] text-xs flex items-start gap-3 shadow-xl animate-fadeIn">
          <AlertTriangle className="w-5 h-5 shrink-0 text-[#FF4D4F] mt-0.5" />
          <div className="leading-relaxed text-[#FFD0D0]">
            ⚠️ Penyimpanan permanen (Redis) sedang tidak aktif. Perubahan yang kamu buat sekarang HANYA tersimpan sementara dan bisa HILANG jika server restart. Tunggu beberapa menit lalu refresh halaman ini sebelum upload data penting.
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[var(--accent-gold)] font-bold mb-1">
            <Shield className="w-4 h-4" />
            <span>HEVORA ADMIN CONTROL PANEL</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Pengelolaan Konten & Informasi Terminal</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          <button
            onClick={handleResetHistory}
            className="px-3.5 py-2 rounded-lg bg-[#FF4D4F]/10 hover:bg-[#FF4D4F]/20 border border-[#FF4D4F]/40 text-[#FF4D4F] font-extrabold text-xs transition-all cursor-pointer flex items-center gap-2 shrink-0 shadow-sm"
            title="Hapus total seluruh history signal"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Total History</span>
          </button>
          <div className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] px-3.5 py-2 rounded-lg border border-[var(--border-subtle)] font-bold">
            💡 Tutup semua tab browser untuk logout
          </div>
        </div>
      </div>

      {/* Global Status Message Banner */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 animate-fadeIn ${
            statusMessage.type === 'success'
              ? 'bg-[#2ECC71]/10 border-[#2ECC71]/30 text-[#2ECC71]'
              : 'bg-[#FF4D4F]/10 border-[#FF4D4F]/30 text-[#FF4D4F]'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Admin Navigation Tabs */}
      <div className="flex items-center gap-2 bg-[var(--bg-panel)] p-1.5 rounded-xl border border-[var(--border-subtle)] text-xs overflow-x-auto">
        <button
          onClick={() => { setActiveTab('updates'); setEditingUpdate(null); }}
          className={`px-4 py-2 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'updates'
              ? 'bg-[var(--accent-gold)] text-black'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Platform Updates ({updates.length})</span>
        </button>


        <button
          onClick={() => { setActiveTab('research'); setEditingResearch(null); }}
          className={`px-4 py-2 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'research'
              ? 'bg-[#A855F7] text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Research Desk ({research.length})</span>
        </button>


        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'settings'
              ? 'bg-[var(--text-primary)] text-[var(--bg-panel)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Site Settings</span>
        </button>

        <button
          onClick={() => setActiveTab('data-health')}
          className={`px-4 py-2 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'data-health'
              ? 'bg-[#2ECC71] text-black'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Data Health{dataHealth ? ` (${dataHealth.length})` : ''}</span>
        </button>

        <button
          onClick={() => setActiveTab('auto-trading')}
          className={`px-4 py-2 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            activeTab === 'auto-trading'
              ? 'bg-[#3B82F6] text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Auto Trading{autotradeSettings.enabled ? ` (${autotradeSettings.mode === 'live' ? 'LIVE' : 'Dry-run'})` : ' (OFF)'}</span>
        </button>
      </div>

      {/* SUB-TAB 1: PLATFORM UPDATES */}
      {activeTab === 'updates' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Create / Edit */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center justify-between">
              <span>{editingUpdate?.id ? 'Edit Platform Update' : 'Tambah Platform Update Baru'}</span>
              {editingUpdate && (
                <button
                  onClick={() => setEditingUpdate(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                >
                  Batal
                </button>
              )}
            </h2>

            <form onSubmit={handleSaveUpdate} className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Judul Update</label>
                <input
                  type="text"
                  required
                  value={editingUpdate?.title || ''}
                  onChange={(e) => setEditingUpdate({ ...editingUpdate, title: e.target.value })}
                  placeholder="Contoh: Rilis Fitur Intel Hub v2"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-gold)]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Deskripsi Ringkas</label>
                <textarea
                  required
                  rows={3}
                  value={editingUpdate?.description || ''}
                  onChange={(e) => setEditingUpdate({ ...editingUpdate, description: e.target.value })}
                  placeholder="Jelaskan detail perbaikan/fitur..."
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-gold)]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Tipe Update</label>
                <select
                  value={editingUpdate?.type || 'feature'}
                  onChange={(e) => setEditingUpdate({ ...editingUpdate, type: e.target.value as any })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)] cursor-pointer"
                >
                  <option value="feature">Feature (Fitur Baru)</option>
                  <option value="fix">Fix (Perbaikan Bug)</option>
                  <option value="improvement">Improvement (Peningkatan Performance)</option>
                  <option value="announcement">Announcement (Pengumuman Resmi)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[var(--accent-gold)] text-black font-bold rounded hover:opacity-90 transition-all cursor-pointer flex items-center justify-center gap-1.5 mt-2"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan Update</span>
              </button>
            </form>
          </div>

          {/* List Table */}
          <div className="lg:col-span-2 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 overflow-x-auto">
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-4">Daftar Platform Updates Log</h2>
            {updates.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Belum ada update terdaftar.</p>
            ) : (
              <div className="space-y-3">
                {updates.map((item) => (
                  <div key={item.id} className="p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[10px] font-bold text-[var(--accent-gold)] uppercase">
                          {item.type}
                        </span>
                        <span className="text-xs font-bold text-[var(--text-primary)]">{item.title}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-snug">{item.description}</p>
                      <span className="text-[10px] text-[var(--text-muted)] block">
                        {new Date(item.createdAt).toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingUpdate(item)}
                        className="p-1.5 rounded hover:bg-[var(--card-hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteUpdate(item.id)}
                        className="p-1.5 rounded hover:bg-[#FF4D4F]/20 text-[#FF4D4F] cursor-pointer"
                        title="Hapus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: RESEARCH */}
      {activeTab === 'research' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Create / Edit */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center justify-between">
              <span>{editingResearch?.id ? 'Edit Research Report' : 'Tambah Research Report'}</span>
              {editingResearch && (
                <button
                  onClick={() => setEditingResearch(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                >
                  Batal
                </button>
              )}
            </h2>

            <form onSubmit={handleSaveResearch} className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Judul Riset</label>
                <input
                  type="text"
                  required
                  value={editingResearch?.title || ''}
                  onChange={(e) => setEditingResearch({ ...editingResearch, title: e.target.value })}
                  placeholder="Contoh: Gold Liquidity Analysis & FVG Setup"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#A855F7]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Ringkasan Riset</label>
                <textarea
                  required
                  rows={2}
                  value={editingResearch?.summary || ''}
                  onChange={(e) => setEditingResearch({ ...editingResearch, summary: e.target.value })}
                  placeholder="Ringkasan eksekutif..."
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#A855F7]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Isi Lengkap Analisis Riset</label>
                <textarea
                  required
                  rows={5}
                  value={editingResearch?.content || ''}
                  onChange={(e) => setEditingResearch({ ...editingResearch, content: e.target.value })}
                  placeholder="Tuliskan analisis teknikal & institusional mendalam..."
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#A855F7]"
                />
              </div>

              <ImageUploadField
                label="Gambar Riset (Upload Langsung)"
                value={editingResearch?.imageUrl || ''}
                onChange={(url) => setEditingResearch({ ...editingResearch, imageUrl: url })}
                accentColor="#A855F7"
              />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">Penulis (Author)</label>
                  <input
                    type="text"
                    value={editingResearch?.author || 'HEVORA Research Desk'}
                    onChange={(e) => setEditingResearch({ ...editingResearch, author: e.target.value })}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">Kategori</label>
                  <select
                    value={editingResearch?.category || 'Forex'}
                    onChange={(e) => setEditingResearch({ ...editingResearch, category: e.target.value as any })}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none cursor-pointer"
                  >
                    <option value="Forex">Forex</option>
                    <option value="Crypto">Crypto</option>
                    <option value="Commodities">Commodities</option>
                    <option value="Macro">Macro</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[#A855F7] text-white font-bold rounded hover:opacity-90 transition-all cursor-pointer flex items-center justify-center gap-1.5 mt-2"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan Research Report</span>
              </button>
            </form>
          </div>

          {/* List Table */}
          <div className="lg:col-span-2 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 overflow-x-auto">
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-4">Daftar Research Reports</h2>
            {research.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Belum ada riset terdaftar.</p>
            ) : (
              <div className="space-y-3">
                {research.map((item) => (
                  <div key={item.id} className="p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#A855F7]/10 text-[#A855F7] border border-[#A855F7]/30 text-[10px] font-bold">
                          {item.category}
                        </span>
                        <span className="text-xs font-bold text-[var(--text-primary)]">{item.title}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-1">{item.summary}</p>
                      <span className="text-[10px] text-[var(--text-muted)] block">Author: {item.author || 'HEVORA Desk'}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingResearch(item)}
                        className="p-1.5 rounded hover:bg-[var(--card-hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteResearch(item.id)}
                        className="p-1.5 rounded hover:bg-[#FF4D4F]/20 text-[#FF4D4F] cursor-pointer"
                        title="Hapus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: SITE SETTINGS & ENGINE CONTROLS */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Blur Signal Publik (Maintenance Mode) */}
          <div className="lg:col-span-2 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#F5B942]" />
              <span>Blur Signal Publik (Mode Maintenance)</span>
            </h2>

            <div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-[var(--text-primary)] text-sm">Sembunyikan Angka Sinyal dari User Publik</span>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Saat aktif, angka entry/SL/TP/harga di halaman Overview, Market, dan Signal akan di-blur untuk user publik
                    (nama pair, arah BUY/SELL, dan status tetap terlihat). Berguna saat sedang update/testing sistem supaya tidak
                    ada yang meniru sinyal yang mungkin masih ada bug, tanpa harus mematikan seluruh website. Halaman admin ini
                    TIDAK ikut ter-blur.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={savingBlurToggle}
                  onClick={handleToggleSignalsBlurred}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                    settings.signalsBlurred ? 'bg-[#F5B942]' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.signalsBlurred ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Status Blur Signal saat ini:</span>
                <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                  settings.signalsBlurred ? 'bg-[#F5B942]/20 text-[#F5B942]' : 'bg-gray-800 text-gray-400'
                }`}>
                  {settings.signalsBlurred ? 'AKTIF (Sinyal Disembunyikan)' : 'NONAKTIF (Sinyal Tampil Normal)'}
                </span>
              </div>
            </div>
          </div>

          {/* Site Branding Settings */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-5">
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Settings className="w-4 h-4 text-[var(--accent-gold)]" />
              <span>Pengaturan Branding Situs</span>
            </h2>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <ImageUploadField
                label="Logo Situs / Brand Image"
                value={settings.siteLogoUrl || ''}
                onChange={(url) => setSettings({ ...settings, siteLogoUrl: url })}
                accentColor="var(--accent-gold)"
              />

              <div>
                <label className="block text-[var(--text-secondary)] mb-1.5">Tagline / Sub-Logo Text</label>
                <input
                  type="text"
                  value={settings.siteTagline || 'by HEVORA'}
                  onChange={(e) => setSettings({ ...settings, siteTagline: e.target.value })}
                  placeholder="by HEVORA"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3.5 py-2 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-primary)]"
                />
              </div>

              <button
                type="submit"
                className="py-2.5 px-6 bg-[var(--text-primary)] text-[var(--bg-panel)] font-extrabold rounded hover:opacity-90 transition-all cursor-pointer flex items-center gap-2"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Simpan Pengaturan Branding</span>
              </button>
            </form>
          </div>

          {/* Signal Engine Settings (Auto Break Even) */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-5">
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#3B82F6]" />
              <span>Signal Engine Behavior Settings</span>
            </h2>

            <form onSubmit={handleSaveEngineSettings} className="space-y-5 text-xs">
              <div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-1.5">
                      <span>Auto Break Even (Auto-BE pada TP1)</span>
                    </span>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      Ketika aktif, Stop Loss otomatis digeser ke level Break Even (dengan noise buffer 15%) saat TP1 tersentuh.
                      Saat nonaktif (default), Stop Loss tetap di level awal tanpa intervensi otomatis.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setEngineSettings((prev) => ({
                        ...prev,
                        autoBreakevenEnabled: !prev.autoBreakevenEnabled,
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      engineSettings.autoBreakevenEnabled ? 'bg-[#3B82F6]' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        engineSettings.autoBreakevenEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px]">
                  <span className="text-[var(--text-muted)]">Status Auto-BE saat ini:</span>
                  <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                    engineSettings.autoBreakevenEnabled ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'bg-gray-800 text-gray-400'
                  }`}>
                    {engineSettings.autoBreakevenEnabled ? 'AKTIF (Auto BE)' : 'NONAKTIF (Manual BE)'}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingEngineSettings}
                className="py-2.5 px-6 bg-[#3B82F6] text-white font-extrabold rounded hover:opacity-90 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingEngineSettings ? 'Saving...' : 'Simpan Settings Engine'}</span>
              </button>
            </form>
          </div>

          {/* AI Self-Evaluation Insights Log Section */}
          <div className="lg:col-span-2 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-[#A855F7]" />
                <span>AI Quant Self-Evaluation Insights (Setiap 10 Closed Signals)</span>
              </h2>
              <span className="text-xs text-[var(--text-muted)]">DeepSeek-v4 Pro Reasoning Mode</span>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Engine secara otomatis mengirimkan performa 10 sinyal tertutup per pair ke DeepSeek Pro untuk dianalisis.
              Rekomendasi di bawah berfungsi sebagai panduan pertimbangan Admin dalam menyesuaikan confluence threshold.
            </p>

            {aiInsights.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
                <Sparkles className="w-6 h-6 text-[#A855F7] mx-auto mb-2 opacity-60" />
                <p className="text-xs text-[var(--text-muted)]">Belum ada insight AI. Insight baru akan otomatis dihasilkan setelah minimal 10 sinyal ditutup pada salah satu pair.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {aiInsights.map((insight) => (
                  <div key={insight.id} className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-2">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#A855F7]/10 text-[#A855F7] font-extrabold text-xs border border-[#A855F7]/30">
                          {insight.pairId}
                        </span>
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          Evaluasi {insight.closedSignalCount} Sinyal Closed
                        </span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {new Date(insight.timestamp).toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs py-1 text-[var(--text-secondary)]">
                      <div>
                        <span className="text-[10px] text-[var(--text-muted)] block">Win Rate 10 Sinyal:</span>
                        <span className={`font-bold ${insight.winRate >= 60 ? 'text-[#00C853]' : insight.winRate >= 40 ? 'text-[var(--accent-gold)]' : 'text-[#FF4D4F]'}`}>
                          {insight.winRate}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--text-muted)] block">Avg Risk-Reward:</span>
                        <span className="font-bold text-[var(--text-primary)]">{insight.avgR}R</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[var(--text-muted)] block">Breakdown Outcome:</span>
                        <span className="font-medium text-[var(--text-secondary)]">{insight.outcomeBreakdown}</span>
                      </div>
                    </div>

                    <div className="p-3 bg-[var(--bg-panel)] rounded border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] leading-relaxed">
                      <span className="text-[10px] font-bold text-[#A855F7] block mb-1">DeepSeek Pro Reasoning Analysis & Recommendation:</span>
                      {insight.aiAnalysis}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: MARKET DATA HEALTH CENTER (Tahap G §62 tambahan-2) */}
      {activeTab === 'data-health' && (
        <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#2ECC71]" />
                Market Data Health Center
              </h2>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Status kategorikal per provider (LIVE/DELAYED/STALE/UNAVAILABLE) + waktu fetch sukses terakhir - bukan skor numerik. Membaca state yang sudah ada, tidak melakukan fetch baru ke provider mana pun.
                {dataHealthGeneratedAt && ` Dihasilkan ${new Date(dataHealthGeneratedAt).toLocaleString('id-ID')}.`}
              </p>
            </div>
            <button
              onClick={fetchDataHealth}
              disabled={loadingDataHealth}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--card-hover-bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-bold text-[10px] transition-all cursor-pointer disabled:opacity-50 shrink-0"
            >
              {loadingDataHealth ? 'Memuat...' : 'Refresh'}
            </button>
          </div>

          {!dataHealth ? (
            <p className="text-xs text-[var(--text-muted)]">{loadingDataHealth ? 'Memuat status provider...' : 'Belum dimuat.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <th className="text-left font-normal py-2 pr-3">Provider</th>
                    <th className="text-left font-normal py-2 pr-3">Kategori</th>
                    <th className="text-left font-normal py-2 pr-3">Status</th>
                    <th className="text-left font-normal py-2 pr-3">Fetch sukses terakhir</th>
                    <th className="text-left font-normal py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {dataHealth.map((row) => (
                    <tr key={row.provider} className="border-b border-[var(--border-subtle)]/50">
                      <td className="py-2 pr-3 font-bold text-[var(--text-primary)] whitespace-nowrap">{row.provider}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)] whitespace-nowrap">{row.category}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border font-mono text-[9px] font-bold uppercase tracking-wider ${HEALTH_STATUS_STYLE[row.status]}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)] whitespace-nowrap font-mono text-[10px]">
                        {row.lastSuccessfulFetch ? new Date(row.lastSuccessfulFetch).toLocaleString('id-ID') : '—'}
                      </td>
                      <td className="py-2 text-[var(--text-muted)] text-[10px] leading-relaxed">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: AUTO TRADING (MT5 EA) */}
      {activeTab === 'auto-trading' && (
        <div className="space-y-6">
          {/* Global Kill-Switch + Mode */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#3B82F6]" />
              <span>Auto Trading MT5 - Global Control</span>
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Saat aktif, sinyal baru dan perubahan status (TP1/TP2/SL/Invalidated) untuk pair yang diaktifkan di bawah akan
              dikirim ke Expert Advisor MT5 milik admin (lihat folder <code className="font-mono">/mt5-ea</code>) untuk dieksekusi
              otomatis. Default OFF dan mode Dry-run - tidak ada order sungguhan sampai admin secara eksplisit memindahkan ke Live.
            </p>

            <div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-[var(--text-primary)] text-sm">Auto Trading Master Switch</span>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Mematikan ini langsung menghentikan SEMUA pengiriman event ke EA (order baru maupun pengelolaan posisi yang
                    sudah terbuka - TP1/TP2/SL/Invalidated), terlepas dari pengaturan per-pair di bawah. Untuk cuma menghentikan
                    order baru tanpa meninggalkan posisi yang sudah terbuka, pakai Kill-Switch di bawah, bukan ini.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingAutotrade}
                  onClick={handleToggleAutotradeGlobal}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                    autotradeSettings.enabled ? 'bg-[#3B82F6]' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      autotradeSettings.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Status saat ini:</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                    autotradeSettings.enabled ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {autotradeSettings.enabled ? 'AKTIF' : 'NONAKTIF'}
                </span>
              </div>
            </div>

            {/* Fase H (roadmap Bagian 1): kill-switch - narrower than the master switch above, blocks
                ONLY new OPEN events so an already-open position keeps being managed (TP1/TP2/SL/
                Invalidated close events still flow) instead of being left to only the broker-side
                SL/TP the EA set at entry. Every change here is logged (see the history below). */}
            <div className="p-4 bg-[var(--bg-surface)] border border-[#FF4D4F]/30 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#FF4D4F]" />
                    Kill-Switch: Tolak Order Baru
                  </span>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Mengaktifkan ini memblokir HANYA order OPEN baru ke EA - posisi yang sudah terbuka tetap dikelola normal
                    (TP1/TP2/SL/Invalidated tetap terkirim). Tidak menyentuh signal generation - sinyal untuk 79 user publik
                    tetap terbit seperti biasa. Pakai ini untuk berhenti ambil risiko baru tanpa meninggalkan posisi yang
                    sedang berjalan. Setiap perubahan status di bawah ini tercatat di histori.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={togglingKillSwitch}
                  onClick={handleToggleKillSwitch}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                    autotradeSettings.killSwitchEnabled ? 'bg-[#FF4D4F]' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      autotradeSettings.killSwitchEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Status saat ini:</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                    autotradeSettings.killSwitchEnabled ? 'bg-[#FF4D4F]/20 text-[#FF4D4F]' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {autotradeSettings.killSwitchEnabled ? 'ENGAGED - order baru diblokir' : 'RELEASED - order baru diizinkan'}
                </span>
              </div>
              {autotradeSettings.killSwitchLastChangedAt && (
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>Perubahan terakhir:</span>
                  <span>{new Date(autotradeSettings.killSwitchLastChangedAt).toLocaleString('id-ID')}</span>
                </div>
              )}

              {killSwitchLog.length > 0 && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5 max-h-40 overflow-y-auto">
                  <span className="block text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Histori Perubahan Status</span>
                  {killSwitchLog.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                      <span className={entry.enabled ? 'text-[#FF4D4F] font-semibold' : 'text-[#2ECC71] font-semibold'}>
                        {entry.enabled ? 'ENGAGED' : 'RELEASED'}
                      </span>
                      <span>{new Date(entry.changedAt).toLocaleString('id-ID')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg space-y-3">
              <span className="font-bold text-[var(--text-primary)] text-sm">Mode Eksekusi</span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleChangeAutotradeMode('dry_run')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    autotradeSettings.mode === 'dry_run'
                      ? 'border-[#2ECC71] bg-[#2ECC71]/10'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--card-hover-bg)]'
                  }`}
                >
                  <span className="block text-xs font-bold text-[var(--text-primary)]">Dry-run (Simulasi)</span>
                  <span className="block text-[10px] text-[var(--text-muted)] mt-1">EA hanya mencatat log, tidak kirim order sungguhan. Aman untuk testing.</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeAutotradeMode('live')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    autotradeSettings.mode === 'live'
                      ? 'border-[#FF4D4F] bg-[#FF4D4F]/10'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--card-hover-bg)]'
                  }`}
                >
                  <span className="block text-xs font-bold text-[var(--text-primary)]">Live (Order Sungguhan)</span>
                  <span className="block text-[10px] text-[var(--text-muted)] mt-1">EA mengirim order riil ke akun MT5. Pastikan sudah diuji di akun demo.</span>
                </button>
              </div>
              {autotradeSettings.mode === 'live' && (
                <div className="flex items-start gap-2 p-2.5 bg-[#FF4D4F]/10 border border-[#FF4D4F]/30 rounded text-[10px] text-[#FF4D4F]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Mode LIVE aktif - kerugian finansial nyata bisa terjadi otomatis tanpa pengecekan manual.</span>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSaveAutotradeForm} className="space-y-6">
            {/* Per-Pair Settings */}
            <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Settings className="w-4 h-4 text-[var(--accent-gold)]" />
                <span>Pengaturan Per-Pair</span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                      <th className="text-left font-normal py-2 pr-3">Aktif</th>
                      <th className="text-left font-normal py-2 pr-3">Pair</th>
                      <th className="text-left font-normal py-2 pr-3">Broker Symbol</th>
                      <th className="text-left font-normal py-2 pr-3">Lot Mode</th>
                      <th className="text-left font-normal py-2 pr-3">Nilai Lot / Risk %</th>
                      <th className="text-left font-normal py-2">Max Lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AUTOTRADE_ELIGIBLE_PAIRS.map((pair) => {
                      const p: AutotradePairSettings = autotradeSettings.pairs[pair.id] || {
                        enabled: false,
                        brokerSymbol: '',
                        lotMode: 'fixed',
                        lotValue: 0.01,
                        maxLot: 1,
                      };
                      return (
                        <tr key={pair.id} className="border-b border-[var(--border-subtle)]/50">
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={p.enabled}
                              onChange={(e) => updateAutotradePair(pair.id, { enabled: e.target.checked })}
                              className="w-4 h-4 cursor-pointer accent-[#3B82F6]"
                            />
                          </td>
                          <td className="py-2 pr-3 font-bold text-[var(--text-primary)] whitespace-nowrap">{pair.name}</td>
                          <td className="py-2 pr-3">
                            <input
                              type="text"
                              value={p.brokerSymbol}
                              onChange={(e) => updateAutotradePair(pair.id, { brokerSymbol: e.target.value })}
                              placeholder={pair.id}
                              className="w-28 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-primary)]"
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={p.lotMode}
                              onChange={(e) => updateAutotradePair(pair.id, { lotMode: e.target.value as 'fixed' | 'risk_percent' })}
                              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                            >
                              <option value="fixed">Fixed Lot</option>
                              <option value="risk_percent">Risk % Saldo</option>
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={p.lotValue}
                              onChange={(e) => updateAutotradePair(pair.id, { lotValue: Number(e.target.value) })}
                              className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                            />
                          </td>
                          <td className="py-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={p.maxLot}
                              onChange={(e) => updateAutotradePair(pair.id, { maxLot: Number(e.target.value) })}
                              className="w-20 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                Risk % Saldo dihitung oleh EA di dalam MT5 memakai equity akun dan tick value simbol saat itu juga - bukan dihitung di server ini.
              </p>
            </div>

            {/* TP1 Management + Max Concurrent Trades */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#F5B942]" />
                  <span>Manajemen TP1 / TP2</span>
                </h2>
                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--card-hover-bg)]">
                    <input
                      type="checkbox"
                      checked={autotradeSettings.tp1CloseEnabled}
                      onChange={(e) => setAutotradeSettings({ ...autotradeSettings, tp1CloseEnabled: e.target.checked })}
                      className="w-4 h-4 mt-0.5 cursor-pointer accent-[#F5B942]"
                    />
                    <span className="text-xs font-bold text-[var(--text-primary)]">Tutup penuh saat TP1 tersentuh</span>
                  </label>
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--card-hover-bg)]">
                    <input
                      type="checkbox"
                      checked={autotradeSettings.tp2CloseEnabled}
                      onChange={(e) => setAutotradeSettings({ ...autotradeSettings, tp2CloseEnabled: e.target.checked })}
                      className="w-4 h-4 mt-0.5 cursor-pointer accent-[#F5B942]"
                    />
                    <span className="text-xs font-bold text-[var(--text-primary)]">Tutup penuh saat TP2 tersentuh</span>
                  </label>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                  Kalau dua-duanya dicentang, TP1 yang dieksekusi duluan (posisi ditutup penuh di TP1); event TP2 setelahnya
                  otomatis dilewati karena posisi sudah tertutup. Kalau sebuah checkbox tidak dicentang, level TP itu hanya
                  dicatat di log EA - tidak ada aksi ke posisi.
                </p>
              </div>

              <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#3B82F6]" />
                  <span>Pengaman Tambahan</span>
                </h2>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1.5 text-xs">Max Concurrent Trades</label>
                  <input
                    type="number"
                    min="1"
                    value={autotradeSettings.maxConcurrentTrades}
                    onChange={(e) => setAutotradeSettings({ ...autotradeSettings, maxConcurrentTrades: Number(e.target.value) })}
                    className="w-28 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
                    Batas jumlah posisi terbuka bersamaan yang boleh dibuka EA - dihitung EA di dalam MT5 sebelum membuka posisi baru.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingAutotrade}
              className="py-2.5 px-6 bg-[var(--text-primary)] text-[var(--bg-panel)] font-extrabold rounded hover:opacity-90 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingAutotrade ? 'Menyimpan...' : 'Simpan Pengaturan Auto Trading'}</span>
            </button>
          </form>

          {/* Bridge API Key + Connection Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#A855F7]" />
                <span>Bridge API Key</span>
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                Key ini ditempel di parameter <code className="font-mono">HevoraBridgeKey</code> pada EA MT5 (lihat folder{' '}
                <code className="font-mono">/mt5-ea</code>), bukan password broker. Hanya hash-nya yang tersimpan di server -
                plaintext hanya tampil sekali saat generate/rotate.
              </p>
              <div className="flex items-center justify-between text-[11px] p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg">
                <span className="text-[var(--text-muted)]">Status Key:</span>
                <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${autotradeSettings.bridgeKeyConfigured ? 'bg-[#2ECC71]/20 text-[#2ECC71]' : 'bg-gray-800 text-gray-400'}`}>
                  {autotradeSettings.bridgeKeyConfigured ? 'SUDAH DIKONFIGURASI' : 'BELUM ADA KEY'}
                </span>
              </div>
              {autotradeSettings.bridgeKeyLastRotated && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Terakhir di-rotate: {new Date(autotradeSettings.bridgeKeyLastRotated).toLocaleString('id-ID')}
                </p>
              )}
              <button
                type="button"
                disabled={rotatingBridgeKey}
                onClick={handleRotateBridgeKey}
                className="py-2 px-4 bg-[#A855F7] text-white font-bold rounded hover:opacity-90 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 text-xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{rotatingBridgeKey ? 'Membuat key...' : 'Rotate Bridge API Key'}</span>
              </button>
            </div>

            <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 space-y-4">
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                {bridgeStatusLabel.online ? <Wifi className="w-4 h-4 text-[#2ECC71]" /> : <WifiOff className="w-4 h-4 text-[var(--text-muted)]" />}
                <span>Status Koneksi Bridge (EA MT5)</span>
              </h2>
              <div
                className={`p-4 rounded-lg border text-xs font-bold ${
                  bridgeStatusLabel.online
                    ? 'bg-[#2ECC71]/10 border-[#2ECC71]/30 text-[#2ECC71]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                }`}
              >
                {bridgeStatusLabel.text}
              </div>
              <button
                type="button"
                onClick={fetchAutotrade}
                disabled={loadingAutotrade}
                className="py-1.5 px-3 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--card-hover-bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-bold text-[10px] transition-all cursor-pointer disabled:opacity-50"
              >
                {loadingAutotrade ? 'Memuat...' : 'Refresh Status'}
              </button>
            </div>
          </div>

          {/* Execution Log */}
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--text-muted)]" />
              Log Eksekusi Terbaru
            </h2>
            {autotradeLog.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Belum ada eksekusi yang dilaporkan oleh EA.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                      <th className="text-left font-normal py-2 pr-3">Waktu</th>
                      <th className="text-left font-normal py-2 pr-3">Pair</th>
                      <th className="text-left font-normal py-2 pr-3">Event</th>
                      <th className="text-left font-normal py-2 pr-3">Status</th>
                      <th className="text-left font-normal py-2 pr-3">Ticket</th>
                      <th className="text-left font-normal py-2">Pesan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autotradeLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-[var(--border-subtle)]/50">
                        <td className="py-2 pr-3 whitespace-nowrap font-mono text-[10px] text-[var(--text-secondary)]">
                          {new Date(entry.reportedAt).toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 pr-3 font-bold text-[var(--text-primary)] whitespace-nowrap">{entry.pairId}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-[var(--text-secondary)]">{entry.eventType}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border font-mono text-[9px] font-bold uppercase tracking-wider ${
                              entry.status === 'success'
                                ? 'bg-[#2ECC71]/10 border-[#2ECC71]/30 text-[#2ECC71]'
                                : 'bg-[#FF4D4F]/10 border-[#FF4D4F]/30 text-[#FF4D4F]'
                            }`}
                          >
                            {entry.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-[10px] text-[var(--text-secondary)]">{entry.ticket ?? '—'}</td>
                        <td className="py-2 text-[var(--text-muted)] text-[10px] leading-relaxed">{entry.message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rotate Bridge Key - One-Time Reveal Modal */}
      {revealedBridgeKey && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#A855F7]" />
              Bridge API Key Baru
            </h3>
            <div className="flex items-start gap-2 p-3 bg-[#FF4D4F]/10 border border-[#FF4D4F]/30 rounded text-[11px] text-[#FF4D4F]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>SALIN SEKARANG. Key ini tidak akan pernah ditampilkan lagi setelah dialog ini ditutup.</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 block bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-2 text-[11px] text-[var(--text-primary)] break-all font-mono">
                {revealedBridgeKey}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(revealedBridgeKey);
                  showNotice('Bridge API Key disalin ke clipboard.');
                }}
                className="p-2.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--card-hover-bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer shrink-0"
                title="Salin"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRevealedBridgeKey(null)}
              className="w-full py-2.5 px-6 bg-[var(--text-primary)] text-[var(--bg-panel)] font-extrabold rounded hover:opacity-90 transition-all cursor-pointer text-sm"
            >
              Sudah Disalin, Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
