import React, { useState, useEffect, useRef } from 'react';
import { Bell, Search, Sun, Moon, LogIn, X, CheckCircle, Languages } from 'lucide-react';
import { UserButton, useUser } from '@clerk/clerk-react';
import { PlatformUpdate, SiteSettings } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

/**
 * Terminal top bar: brand, global-search trigger, language, platform updates, theme, auth.
 *
 * Navigation itself no longer lives here. The ticker tape, the desktop tab strip, the mobile
 * bottom nav and the pair-only ⌘K overlay all moved into the shell (components/shell/*) where
 * they are driven by the module registry - this component keeps only the chrome that is not
 * navigation, so adding a module never means editing the header.
 */

interface NavbarProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  /** Opens the auth modal; the optional route is where to land once sign-in completes. */
  onOpenAuthModal?: (route?: string) => void;
  /** Opens the global command palette (shell/CommandPalette.tsx). */
  onOpenSearch: () => void;
  /** Brand click - returns to the Overview module. */
  onNavigateHome: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  theme = 'dark',
  onToggleTheme,
  onOpenAuthModal,
  onOpenSearch,
  onNavigateHome,
}) => {
  const { isSignedIn } = useUser();
  const { language, setLanguage, t } = useTranslation();

  // Bell Notifications State
  const [updates, setUpdates] = useState<PlatformUpdate[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isBellOpen, setIsBellOpen] = useState<boolean>(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // Site Branding State
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({
    siteLogoUrl: '',
    siteTagline: 'by HEVORA',
  });

  // Fetch Platform Updates & Calculate Unread Count
  useEffect(() => {
    const fetchUpdates = async () => {
      try {
        const res = await fetch('/api/updates');
        if (res.ok) {
          const data: PlatformUpdate[] = await res.json();
          setUpdates(Array.isArray(data) ? data : []);

          const lastRead = localStorage.getItem('hev_updates_last_read');
          const lastReadTime = lastRead ? new Date(lastRead).getTime() : 0;

          const unread = data.filter((u) => new Date(u.createdAt).getTime() > lastReadTime).length;
          setUnreadCount(unread);
        }
      } catch (e) {
        console.error('Failed to fetch platform updates:', e);
      }
    };

    fetchUpdates();
    const interval = setInterval(fetchUpdates, 30000); // refresh every 30s

    // 2026-08-31 audit (point 4): same background-tab throttling catch-up as the other polls in
    // this app - refetch immediately on the tab becoming visible again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchUpdates();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Fetch Site Settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings: SiteSettings = await res.json();
          if (settings) setSiteSettings(settings);
        }
      } catch (e) {
        // Silent
      }
    };
    fetchSettings();
  }, []);

  // Click outside listener to close bell dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle bell dropdown and mark updates as read
  const handleToggleBell = () => {
    const nextState = !isBellOpen;
    setIsBellOpen(nextState);
    if (nextState) {
      localStorage.setItem('hev_updates_last_read', new Date().toISOString());
      setUnreadCount(0);
    }
  };

  const formatUpdateType = (type: string) => {
    switch (type) {
      case 'feature':
        return { label: t('nav.badge.feature'), bg: 'bg-[#2ECC71]/15 text-[#2ECC71] border-[#2ECC71]/30' };
      case 'fix':
        return { label: t('nav.badge.fix'), bg: 'bg-[#FF4D4F]/15 text-[#FF4D4F] border-[#FF4D4F]/30' };
      case 'improvement':
        return { label: t('nav.badge.improvement'), bg: 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30' };
      default:
        return {
          label: t('nav.badge.announcement'),
          bg: 'bg-[var(--accent-gold)]/15 text-[var(--accent-gold)] border-[var(--accent-gold)]/30',
        };
    }
  };

  return (
    <div className="bg-[var(--bg-header)] border-b border-[var(--border-subtle)] text-xs transition-colors duration-200 relative overflow-visible">
      {/* Background Subtle Watermark Text */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-around opacity-[0.02] text-[var(--text-primary)] font-black text-xs tracking-[0.6em] whitespace-nowrap select-none z-0">
        <span>HEVORA</span>
        <span>HEVORA</span>
        <span>HEVORA</span>
        <span>HEVORA</span>
        <span>HEVORA</span>
      </div>

      <div className="px-4 sm:px-6 relative z-10">
        <div className="flex items-center justify-between h-14 gap-3">
          {/* Brand Logo: Custom image or HEV TERMINAL text */}
          <button
            onClick={onNavigateHome}
            className="flex items-center gap-3 group text-left cursor-pointer select-none shrink-0"
          >
            {siteSettings.siteLogoUrl ? (
              // Admin-configured custom logo override takes priority over the default brand mark
              <div className="flex items-center gap-2">
                <img src={siteSettings.siteLogoUrl} alt="Logo" className="h-8 w-auto object-contain max-w-[140px]" />
                {siteSettings.siteTagline && (
                  <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)] font-extralight border-l border-[var(--border-strong)] pl-2 hidden sm:inline">
                    {siteSettings.siteTagline}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="hev-logo-mark h-9 w-9 shrink-0" role="img" aria-label="HEVTERMINAL" />
                <div className="flex flex-col leading-none">
                  <span className="font-mono font-black text-sm tracking-wider text-[var(--text-primary)]">
                    HEVTERMINAL
                  </span>
                  <span className="text-[8px] font-mono tracking-[0.28em] text-[var(--text-muted)] font-extralight mt-0.5">
                    {siteSettings.siteTagline || 'BY HEVORA'}
                  </span>
                </div>
              </div>
            )}
          </button>

          {/* Right Header Controls - gap-1.5 on mobile (gap-3 from sm up). At narrow widths
              (~375-430px) this row packs search+language+bell+theme+login all at once; the
              tighter gap plus the smaller icon-button size below keeps everything on-screen
              instead of the last item (Login) clipping off the right edge. */}
          <div className="flex items-center gap-1 sm:gap-3 font-mono">
            {/* Global search trigger (⌘K) - opens the command palette: modules AND assets. */}
            <button
              type="button"
              onClick={onOpenSearch}
              className="hidden sm:flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] px-3 py-1.5 rounded text-xs hover:border-[var(--border-strong)] transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <span className="text-[11px] text-[var(--text-secondary)]">{t('shell.searchPlaceholder')}</span>
              <kbd className="hidden lg:inline-block bg-[var(--bg-base)] text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-muted)]">
                ⌘K
              </kbd>
            </button>

            {/* Search-only trigger for mobile (icon button, no hidden text) - the palette needs to
                be reachable without a hardware keyboard too. */}
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label={t('shell.searchPlaceholder')}
              className="sm:hidden min-w-[36px] min-h-[36px] rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-all cursor-pointer flex items-center justify-center"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            {/* Language Switcher - always visible (not desktop-only) so it's reachable on every
                screen size, not just >=sm. A second shortcut also lives in the profile dropdown
                (UserButton menu items below) for signed-in users. */}
            <div
              className="flex items-center gap-0.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-0.5"
              title={t('nav.language')}
            >
              <Languages className="hidden sm:block w-3 h-3 text-[var(--text-muted)] ml-1.5 mr-0.5" />
              {(['en', 'id'] as const).map((lng) => (
                <button
                  key={lng}
                  onClick={() => setLanguage(lng)}
                  aria-label={`${t('nav.language')}: ${lng.toUpperCase()}`}
                  className={`px-1.5 sm:px-2 py-1.5 sm:py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer ${
                    language === lng
                      ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {lng}
                </button>
              ))}
            </div>

            {/* Notification Bell & Dropdown Container */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={handleToggleBell}
                title={t('nav.platformUpdatesTooltip')}
                className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-all cursor-pointer flex items-center justify-center relative hover:border-[var(--border-strong)]"
              >
                <Bell className="w-3.5 h-3.5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1.5 min-w-[18px] h-[18px] bg-[#FF4D4F] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm border border-[var(--bg-base)]">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Bell Dropdown Panel */}
              {isBellOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-xl shadow-2xl z-50 p-4 font-mono space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[var(--accent-gold)]" />
                      <span className="font-bold text-xs text-[var(--text-primary)]">{t('nav.changelogTitle')}</span>
                    </div>
                    <button
                      onClick={() => setIsBellOpen(false)}
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                    {updates.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--text-muted)]">{t('nav.noAnnouncements')}</div>
                    ) : (
                      updates.map((item) => {
                        const style = formatUpdateType(item.type);
                        return (
                          <div
                            key={item.id}
                            className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1.5 hover:border-[var(--border-strong)] transition-all"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${style.bg}`}>
                                {style.label}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {new Date(item.createdAt).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                })}
                              </span>
                            </div>

                            <h4 className="text-xs font-bold text-[var(--text-primary)] leading-tight">{item.title}</h4>

                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                              {item.description}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span className="flex items-center gap-1 text-[#2ECC71]">
                      <CheckCircle className="w-3 h-3" />
                      <span>{t('nav.allUpdatesRead')}</span>
                    </span>
                    <span>HEV Terminal v2.4</span>
                  </div>
                </div>
              )}
            </div>

            {/* Theme Toggle Button */}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                title={theme === 'dark' ? t('nav.switchToLight') : t('nav.switchToDark')}
                className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-all cursor-pointer flex items-center justify-center hover:border-[var(--border-strong)]"
              >
                {theme === 'dark' ? (
                  <Sun className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                )}
              </button>
            )}

            {/* User Auth Avatar / Login Button */}
            {isSignedIn ? (
              <div className="flex items-center gap-2 border-l border-[var(--border-subtle)] pl-3">
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      avatarBox: 'w-7 h-7 rounded-full border border-[var(--border-strong)] shadow-sm cursor-pointer',
                    },
                  }}
                >
                  {/* Extra shortcut into the profile dropdown - guarantees the language switcher
                      is reachable at every screen size regardless of the toolbar control above. */}
                  <UserButton.MenuItems>
                    <UserButton.Action
                      label={`${t('nav.language')}: ${language === 'en' ? 'English' : 'Bahasa Indonesia'}`}
                      labelIcon={<Languages className="w-3.5 h-3.5" />}
                      onClick={() => setLanguage(language === 'en' ? 'id' : 'en')}
                    />
                  </UserButton.MenuItems>
                </UserButton>
              </div>
            ) : (
              <button
                onClick={() => onOpenAuthModal && onOpenAuthModal()}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded bg-[var(--text-primary)] hover:opacity-90 text-[var(--bg-base)] font-extrabold text-xs transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
              >
                <LogIn className="w-3 h-3" />
                <span className="hidden sm:inline">{t('nav.login')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
