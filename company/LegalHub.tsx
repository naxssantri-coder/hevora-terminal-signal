import React, { useState } from 'react';
import { AlertTriangle, FileText, Info, Send, Shield, Users, Youtube } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';
import { Badge, Panel, PanelHeader, SectionLabel, TabBar, type TabItem } from '../ui';

/**
 * Company / Legal Hub (Roadmap §F). Five pages the roadmap asked for - About, Team, Terms of
 * Service, Privacy Policy, Regulatory Disclosure - as ONE registry module with an in-page TabBar,
 * the same consolidation pattern CalendarHub already uses, rather than five separate nav entries
 * cluttering the primary sidebar for what is genuinely a low-traffic utility section.
 *
 * Every section below is either a real, verifiable fact already true of this codebase (the
 * product name, the real YouTube/Telegram links Footer.tsx already publishes, the real
 * third-party processors actually wired in server.ts - Clerk for auth, Upstash Redis for storage)
 * or is explicitly marked with a PLACEHOLDER badge. Nothing here invents a legal entity name,
 * jurisdiction, registration number, or team member identity - §1's "no fabricated data" rule
 * applies to legal/company facts exactly as much as it applies to a price feed.
 */

type LegalTab = 'about' | 'team' | 'terms' | 'privacy' | 'regulatory';

const YOUTUBE_URL = 'https://youtube.com/@hevterminalbyhevora';
const TELEGRAM_URL = 'https://t.me/Hevoraofficial';

const PlaceholderBadge: React.FC = () => {
  const { t } = useTranslation();
  return <Badge tone="warning">{t('company.placeholder')}</Badge>;
};

const Section: React.FC<{ heading: string; children: React.ReactNode; placeholder?: boolean }> = ({
  heading,
  children,
  placeholder = false,
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-2">
      <SectionLabel className="!mb-0">{heading}</SectionLabel>
      {placeholder && <PlaceholderBadge />}
    </div>
    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{children}</p>
  </div>
);

export const LegalHub: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LegalTab>('about');

  const tabs: TabItem[] = [
    { id: 'about', label: t('company.tabAbout'), icon: <Info className="w-3 h-3" /> },
    { id: 'team', label: t('company.tabTeam'), icon: <Users className="w-3 h-3" /> },
    { id: 'terms', label: t('company.tabTerms'), icon: <FileText className="w-3 h-3" /> },
    { id: 'privacy', label: t('company.tabPrivacy'), icon: <Shield className="w-3 h-3" /> },
    { id: 'regulatory', label: t('company.tabRegulatory'), icon: <AlertTriangle className="w-3 h-3" /> },
  ];

  return (
    <div className="space-y-4 font-mono">
      <Panel flush className="p-4 sm:p-5">
        <PanelHeader
          eyebrow={t('category.company')}
          title={t('company.title')}
          subtitle={t('company.subtitle')}
          icon={<Info className="w-4 h-4" />}
        />
        <div className="mt-4">
          <TabBar tabs={tabs} active={tab} onChange={(id) => setTab(id as LegalTab)} />
        </div>
      </Panel>

      {tab === 'about' && (
        <Panel className="space-y-4">
          <Section heading={t('company.aboutWhatTitle')}>{t('company.aboutWhatBody')}</Section>
          <Section heading={t('company.aboutPrincipleTitle')}>{t('company.aboutPrincipleBody')}</Section>
          <Section heading={t('company.aboutContactTitle')}>
            {t('company.aboutContactBody')}
          </Section>
          <div className="flex items-center gap-3 pt-1">
            <a
              href={YOUTUBE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
            >
              <Youtube className="w-3.5 h-3.5" /> YouTube
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
            >
              <Send className="w-3.5 h-3.5" /> Telegram
            </a>
          </div>
        </Panel>
      )}

      {tab === 'team' && (
        <Panel className="space-y-4">
          <Section heading={t('company.teamOperatorTitle')}>{t('company.teamOperatorBody')}</Section>
          <Section heading={t('company.teamProfilesTitle')} placeholder>
            {t('company.teamProfilesBody')}
          </Section>
        </Panel>
      )}

      {tab === 'terms' && (
        <Panel className="space-y-4">
          <Section heading={t('company.termsServiceTitle')}>{t('company.termsServiceBody')}</Section>
          <Section heading={t('company.termsNoAdviceTitle')}>{t('company.termsNoAdviceBody')}</Section>
          <Section heading={t('company.termsAccuracyTitle')}>{t('company.termsAccuracyBody')}</Section>
          <Section heading={t('company.termsAccountTitle')}>{t('company.termsAccountBody')}</Section>
          <Section heading={t('company.termsIpTitle')}>{t('company.termsIpBody')}</Section>
          <Section heading={t('company.termsLiabilityTitle')}>{t('company.termsLiabilityBody')}</Section>
          <Section heading={t('company.termsGoverningLawTitle')} placeholder>
            {t('company.termsGoverningLawBody')}
          </Section>
        </Panel>
      )}

      {tab === 'privacy' && (
        <Panel className="space-y-4">
          <Section heading={t('company.privacyCollectTitle')}>{t('company.privacyCollectBody')}</Section>
          <Section heading={t('company.privacyUseTitle')}>{t('company.privacyUseBody')}</Section>
          <Section heading={t('company.privacyProcessorsTitle')}>{t('company.privacyProcessorsBody')}</Section>
          <Section heading={t('company.privacyStorageTitle')}>{t('company.privacyStorageBody')}</Section>
          <Section heading={t('company.privacyRightsTitle')}>{t('company.privacyRightsBody')}</Section>
          <Section heading={t('company.privacyContactTitle')} placeholder>
            {t('company.privacyContactBody')}
          </Section>
        </Panel>
      )}

      {tab === 'regulatory' && (
        <Panel className="space-y-4">
          <Section heading={t('company.regNotAdvisorTitle')}>{t('company.regNotAdvisorBody')}</Section>
          <Section heading={t('company.regNoCustodyTitle')}>{t('company.regNoCustodyBody')}</Section>
          <Section heading={t('company.regRiskTitle')}>{t('company.regRiskBody')}</Section>
          <Section heading={t('company.regJurisdictionTitle')} placeholder>
            {t('company.regJurisdictionBody')}
          </Section>
        </Panel>
      )}
    </div>
  );
};
