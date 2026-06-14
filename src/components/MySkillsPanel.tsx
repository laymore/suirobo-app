import React, { useState, useEffect } from 'react';
import { AGENT_URL } from '../agent/agentUrl';

interface InstalledSkill {
  name: string;
  description: string;
  source: 'builtin' | 'walrus' | 'local';
  type?: string;
  active: boolean;
}



const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  builtin: { label: 'Built-in', color: '#22c55e' },
  walrus: { label: 'Walrus', color: '#8b5cf6' },
  local: { label: 'Custom', color: '#f59e0b' },
};

const TYPE_ICONS: Record<string, string> = {
  signal: '📡', guard: '🛡️', scanner: '🔍', custom: '⚙️'
};

export const MySkillsPanel: React.FC = () => {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [filter, setFilter] = useState<'all' | 'builtin' | 'walrus' | 'local'>('all');

  useEffect(() => {
    loadInstalledSkills();
  }, []);

  const loadInstalledSkills = async () => {
    try {
      const res = await fetch(`${AGENT_URL}/api/skills/list`);
      if (res.ok) {
        const data = await res.json();
        const loaded: InstalledSkill[] = data.skills || [];
        setSkills(prev => {
          const merged: InstalledSkill[] = [];
          for (const s of loaded) {
            if (!merged.find(m => m.name === s.name)) {
              merged.push(s);
            }
          }
          return merged;
        });
      }
    } catch {
      // Agent not running
    }
  };

  const filtered = filter === 'all' ? skills : skills.filter(s => s.source === filter);

  const toggleSkill = (name: string) => {
    setSkills(prev => prev.map(s => s.name === name ? { ...s, active: !s.active } : s));
  };

  const removeSkill = async (name: string) => {
    if (!confirm(`Uninstall skill "${name}"?`)) return;
    try {
      await fetch(`${AGENT_URL}/api/skills/${name}`, { method: 'DELETE' });
    } catch {}
    setSkills(prev => prev.filter(s => s.name !== name));
  };

  const addByBlobId = async () => {
    const blobId = prompt('Enter the Walrus Blob ID of the skill:');
    if (!blobId?.trim()) return;

    try {
      const res = await fetch(`https://aggregator.walrus-testnet.walrus.space/v1/${blobId}`);
      if (!res.ok) throw new Error('Could not find Blob');
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { name: `skill-${blobId.slice(0, 6)}`, description: 'Imported from Walrus' }; }

      const skillName = parsed.name || `skill-${blobId.slice(0, 6)}`;
      const skillDesc = parsed.description || 'Skill from Walrus';
      const skillType = parsed.type || 'custom';
      const safeName = skillName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

      // Register skill with the agent
      try {
        await fetch(`${AGENT_URL}/api/skills/load`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: JSON.stringify({
              name: safeName,
              files: {
                'SKILL.md': parsed.files?.['SKILL.md'] || `---\nname: ${skillName}\ndescription: ${skillDesc}\ntype: ${skillType}\n---\n# ${skillName}\n${skillDesc}`,
                'index.js': parsed.files?.['index.js'] || `const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;
export const skill = new FunctionTool({
  name: '${safeName}',
  description: '${skillDesc}',
  parameters: z.object({ input: z.string().optional().describe('Input') })
}, async function ${safeName}(params) {
  return { status: 'active', skill: '${skillName}', message: '${skillDesc}' };
});
export default skill;`
              }
            }),
            password: 'walrus_seal'
          })
        });
      } catch {
        // Agent might not be running, still add locally
      }

      setSkills(prev => [...prev, {
        name: skillName,
        description: skillDesc,
        source: 'walrus',
        type: skillType,
        active: true
      }]);
      alert('✅ Skill added!');
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    }
  };

  const counts = {
    all: skills.length,
    builtin: skills.filter(s => s.source === 'builtin').length,
    walrus: skills.filter(s => s.source === 'walrus').length,
    local: skills.filter(s => s.source === 'local').length,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ color: '#fff', margin: '0 0 4px 0', fontSize: '1.1rem' }}>Installed skills</h3>
          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>
            Manage all skills active on your Local Agent.
          </p>
        </div>
        <button className="btn-outline" onClick={addByBlobId}>
          ➕ Add by Blob ID
        </button>
      </div>

      {/* Source Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['all', 'builtin', 'walrus', 'local'] as const).map(src => (
          <button
            key={src}
            className={`factory-filter-btn ${filter === src ? 'active' : ''}`}
            onClick={() => setFilter(src)}
          >
            {src === 'all' ? `🌐 All (${counts.all})`
              : `${src === 'builtin' ? '📦' : src === 'walrus' ? '🌊' : '🛠️'} ${SOURCE_LABELS[src].label} (${counts[src]})`}
          </button>
        ))}
      </div>

      {/* Skills List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((skill, idx) => (
          <div
            key={skill.name}
            className="skill-card fade-in-up"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', animationDelay: `${idx * 0.03}s`,
              opacity: skill.active ? 1 : 0.5
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
              {/* Icon */}
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.1rem', flexShrink: 0
              }}>
                {TYPE_ICONS[skill.type || 'custom']}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.85rem' }}>{skill.name}</span>
                  <span style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: '0.6rem', fontWeight: 600,
                    background: `${SOURCE_LABELS[skill.source].color}20`,
                    color: SOURCE_LABELS[skill.source].color,
                    border: `1px solid ${SOURCE_LABELS[skill.source].color}30`
                  }}>
                    {SOURCE_LABELS[skill.source].label}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {skill.description}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Toggle */}
              <button
                onClick={() => toggleSkill(skill.name)}
                title={skill.active ? 'Disable' : 'Enable'}
                style={{
                  width: 36, height: 20, borderRadius: 10, position: 'relative', border: 'none',
                  background: skill.active ? '#22c55e' : '#334155', cursor: 'pointer', transition: 'background 0.3s'
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2, left: skill.active ? 18 : 2, transition: 'left 0.3s'
                }} />
              </button>

              {/* Delete (non-builtin only) */}
              {skill.source !== 'builtin' && (
                <button className="btn-danger" onClick={() => removeSkill(skill.name)}>
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <div className="empty-state-text">No skills in this category yet</div>
        </div>
      )}
    </div>
  );
};
