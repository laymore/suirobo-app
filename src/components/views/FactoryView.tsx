import React, { useState, useCallback } from 'react';
import { SkillMarketplace } from '../SkillMarketplace';
import { Leaderboard } from '../Leaderboard';
import { MySkillsPanel } from '../MySkillsPanel';
import { BotSkillBuilder } from '../BotSkillBuilder';
import type { BotSkillConfig } from '../../types/botSkill';
import { useI18n } from '../../i18n';
import '../../styles/factory.css';

type FactoryTab = 'market' | 'botskills' | 'myskills' | 'leaderboard';

interface Props {
  onRequestBacktest?: (skill: BotSkillConfig) => void;
}

export const FactoryView: React.FC<Props> = ({ onRequestBacktest }) => {
  const [tab, setTab] = useState<FactoryTab>('market');
  const { t } = useI18n();

  const TABS: { id: FactoryTab; icon: string; label: string; badge?: string }[] = [
    { id: 'market',     icon: '🛒', label: t('factory.tabs.market') },
    { id: 'botskills',  icon: '🤖', label: t('factory.tabs.botskills') },
    { id: 'myskills',   icon: '📦', label: t('factory.tabs.myskills') },
    { id: 'leaderboard',icon: '🏆', label: t('factory.tabs.leaderboard') },
  ];

  const handleRequestBacktest = useCallback((skill: BotSkillConfig) => {
    onRequestBacktest?.(skill);
  }, [onRequestBacktest]);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{
          color: '#fff', fontSize: '1.6rem', margin: '0 0 8px 0',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.2rem',
          }}>🏭</span>
          {t('factory.title')}
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
          {t('factory.subtitle')}
        </p>
      </div>

      {/* Tab Bar */}
      <div className="factory-tabs" style={{ marginBottom: 24 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`factory-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            style={{ position: 'relative' }}
          >
            <span>{t.icon}</span>
            {t.label}
            {t.badge && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                background: '#10b981', color: '#fff',
                fontSize: '0.5rem', fontWeight: 800,
                padding: '1px 4px', borderRadius: 4, letterSpacing: 0.5,
              }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {tab === 'market'      && <SkillMarketplace />}
        {tab === 'botskills'   && <BotSkillBuilder onRequestBacktest={handleRequestBacktest} />}
        {tab === 'myskills'    && <MySkillsPanel />}
        {tab === 'leaderboard' && <Leaderboard />}
      </div>
    </div>
  );
};
