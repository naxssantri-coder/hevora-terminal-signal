import React, { useState } from 'react';
import { Youtube, Send } from 'lucide-react';
import { DisclaimerModal } from './DisclaimerModal';
import { useTranslation } from '../i18n/LanguageContext';

const YOUTUBE_URL = 'https://youtube.com/@hevterminalbyhevora';
const TELEGRAM_URL = 'https://t.me/Hevoraofficial';

export const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);

  return (
    // Extra bottom padding (mobile only) clears the fixed bottom nav bar so the footer's own
    // content - the disclaimer box in particular - is never hidden behind it.
    <footer className="mt-12 bg-[var(--bg-header)] border-t border-[var(--border-subtle)] text-[var(--text-muted)] py-6 pb-20 md:pb-6 font-mono text-[11px] transition-colors duration-200">
      {/* Matches AppShell.tsx's main content max-width tiers (2026-09-02 desktop width audit) so
          the footer band lines up with the page content above it at every viewport width instead
          of reading as a narrower second footer. */}
      <div className="max-w-[1400px] xl:max-w-[1600px] 2xl:max-w-[1880px] mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-[var(--text-primary)] tracking-wider">HEVORA Signal Terminal</span>
            <span className="text-[var(--text-muted)]">|</span>
            <span className="text-accent font-bold">TradingView Real-time Data</span>
            <span className="text-[var(--text-muted)] hidden md:inline">|</span>
            <span className="hidden md:inline font-bold">AI Signal Engine</span>
          </div>

          <div className="flex items-center gap-3 text-[var(--text-muted)] text-[10px] font-medium">
            {/* Official channel links */}
            <a
              href={YOUTUBE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              className="p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[#FF4D4F] hover:border-[var(--border-strong)] transition-colors"
            >
              <Youtube className="w-3.5 h-3.5" />
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[#3B82F6] hover:border-[var(--border-strong)] transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </a>
            <span className="text-[var(--border-strong)]">|</span>
            <span>{t('footer.build')}</span>
            <span>&copy; {new Date().getFullYear()} HEVORA Group</span>
          </div>
        </div>

        {/* Single-line disclaimer summary - full text moved to modal (was duplicated in full on
            every page here, on top of the per-chart short disclaimer in MarketView). */}
        <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] text-[10px] text-[var(--text-muted)] leading-relaxed font-medium flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <span>
            <span className="font-bold text-accent uppercase tracking-wider">{t('footer.riskTitle')}</span>{' '}
            {t('footer.riskShort')}
          </span>
          <button
            onClick={() => setIsDisclaimerOpen(true)}
            className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold underline underline-offset-2 transition-colors cursor-pointer"
          >
            {t('footer.viewFullDisclaimer')}
          </button>
        </div>
      </div>

      <DisclaimerModal isOpen={isDisclaimerOpen} onClose={() => setIsDisclaimerOpen(false)} />
    </footer>
  );
};
