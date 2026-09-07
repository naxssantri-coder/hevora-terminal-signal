import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';

interface BrokerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pairName?: string;
}

export const BrokerModal: React.FC<BrokerModalProps> = ({ isOpen, onClose, pairName }) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const brokers = [
    {
      id: 'hfm',
      name: 'HFM',
      spread: 'From 0.0 Pips',
      link: 'https://register.hfmtrade-ind.com/sv/en/new-live-account/?refid=30473641',
    },
    {
      id: 'exness',
      name: 'Exness',
      spread: 'From 0.1 Pips',
      link: 'https://www.extrade.global/?utm_source=partners&ex_ol=1',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay-backdrop)] backdrop-blur-md animate-in fade-in duration-200 font-mono">
      <div className="relative w-full max-w-md hev-card-v2 border border-[var(--border-subtle)] rounded-[18px] shadow-2xl p-6 overflow-hidden group transition-colors duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] rounded transition-colors cursor-pointer border border-[var(--border-subtle)]"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="mb-5 space-y-1">
          <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest block">
            {t('market.institutionalRouting')}
          </span>
          <h2 className="text-base font-black text-[var(--text-primary)] tracking-tight uppercase">
            {t('market.orderGateways')} {pairName ? `(${pairName})` : ''}
          </h2>
        </div>

        {/* Minimal Broker Cards */}
        <div className="space-y-3">
          {brokers.map((broker) => (
            <div
              key={broker.id}
              className="p-4 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-all duration-200 flex items-center justify-between gap-4"
            >
              <div>
                <h3 className="font-black text-sm text-[var(--text-primary)]">{broker.name}</h3>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--text-secondary)]">
                  <span>{t('market.spread')} <strong className="text-[var(--text-primary)]">{broker.spread}</strong></span>
                </div>
              </div>

              <a
                href={broker.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#2ECC71] hover:bg-[#2ECC71]/90 text-black font-extrabold text-xs transition-all shadow-sm cursor-pointer shrink-0 uppercase"
              >
                <span>{t('market.open')}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

