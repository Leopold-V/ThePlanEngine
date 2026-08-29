import { useMemo, useState } from 'react'
import type { RobotProfile, SkillOverride } from '@shared/profile.js'
import { SKILLS } from '@sim/skills/registry.js'
import type { SkillCategory } from '@sim/skills/types.js'
import { fingerprint, resolveProfile, type ResolvedSkill } from '@engine/resolveProfile.js'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_SYSTEM_PROMPT } from '@engine/prompt.js'

type Tab = 'skills' | 'context' | 'preview'

const CATEGORY_ORDER: SkillCategory[] = [
  'locomotion',
  'manipulation',
  'perception',
  'gesture',
  'communication'
]

interface Props {
  profile: RobotProfile
  onChange: (profile: RobotProfile) => void
  onReset: () => void
  onClose: () => void
}

/**
 * Editor for the robot profile. Everything shown here is resolved live from
 * `profile + code registry`, so the Preview tab is the exact input the model
 * will receive on the next run — not a reconstruction of it.
 */
export function RobotPanel({ profile, onChange, onReset, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('skills')
  const [selected, setSelected] = useState<string>(SKILLS[0]?.name ?? '')

  const resolved = useMemo(() => resolveProfile(profile, SKILLS), [profile])
  const active = resolved.skills.find((s) => s.name === selected)

  const patchSkill = (name: string, patch: SkillOverride): void => {
    const next = { ...profile.skills[name], ...patch }
    // Drop keys that no longer say anything, keeping the document sparse.
    if (next.description !== undefined && next.description.trim().length === 0) {
      delete next.description
    }
    if (next.enabled === true) delete next.enabled

    const skills = { ...profile.skills }
    if (Object.keys(next).length === 0) delete skills[name]
    else skills[name] = next

    onChange({ ...profile, skills })
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    skills: resolved.skills.filter((s) => s.category === category)
  })).filter((g) => g.skills.length > 0)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="robot-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>Robot profile</h2>
            <p className="muted">
              {profile.name} · rev {profile.revision} · config{' '}
              <code>{fingerprint(resolved)}</code>
            </p>
          </div>
          <div className="header-actions">
            <button className="ghost" onClick={onReset}>
              Reset all
            </button>
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <nav className="tabs">
          {(['skills', 'context', 'preview'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t === 'skills'
                ? `Skills (${resolved.enabled.size}/${resolved.skills.length})`
                : t === 'context'
                  ? 'Context'
                  : 'Preview'}
            </button>
          ))}
        </nav>

        {tab === 'skills' && (
          <div className="robot-body two-col">
            <div className="skill-list">
              {grouped.map((group) => (
                <section key={group.category}>
                  <h3>{group.category}</h3>
                  {group.skills.map((skill) => (
                    <button
                      key={skill.name}
                      className={`skill-row${skill.name === selected ? ' selected' : ''}${
                        skill.enabled ? '' : ' disabled'
                      }`}
                      onClick={() => setSelected(skill.name)}
                    >
                      <input
                        type="checkbox"
                        checked={skill.enabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchSkill(skill.name, { enabled: e.target.checked })}
                      />
                      <span className="skill-name">{skill.name}</span>
                      {skill.overridden && <span className="badge">edited</span>}
                    </button>
                  ))}
                </section>
              ))}
            </div>

            {active ? (
              <SkillDetail
                skill={active}
                onDescription={(description) => patchSkill(active.name, { description })}
                onResetDescription={() => patchSkill(active.name, { description: '' })}
              />
            ) : (
              <div className="skill-detail muted">Select a skill.</div>
            )}
          </div>
        )}

        {tab === 'context' && (
          <div className="robot-body">
            <label>
              System prompt
              <textarea
                rows={20}
                value={profile.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                onChange={(e) => onChange({ ...profile, systemPrompt: e.target.value })}
              />
              <small>
                Everything the robot knows about itself and the world.{' '}
                {profile.systemPrompt !== undefined && (
                  <button
                    className="link"
                    onClick={() => {
                      const { systemPrompt: _drop, ...rest } = profile
                      onChange(rest)
                    }}
                  >
                    Reset to default
                  </button>
                )}
              </small>
            </label>

            <h3>Sensing mode</h3>
            <label>
              What the robot is told without looking
              <select
                value={resolved.observationDetail}
                onChange={(e) =>
                  onChange({
                    ...profile,
                    observationDetail: e.target.value as 'full' | 'proprioceptive'
                  })
                }
              >
                <option value="full">Full — pose, plus visible and remembered objects</option>
                <option value="proprioceptive">Proprioceptive — pose and grip only</option>
              </select>
              <small>
                Full simulates a detection-and-mapping stack feeding a planner. Proprioceptive
                gives only what a robot senses of itself, so objects must be found with{' '}
                <code>look</code> — which is what a vision-language-action model actually gets,
                and the only mode that scales to a large world.
              </small>
            </label>

            <h3>Perception</h3>
            <p className="muted small">
              The robot only sees what is in front of it. Narrowing this is a real experiment —
              it changes the config fingerprint, so runs stay comparable.
            </p>

            <div className="field-row">
              <label className="narrow">
                Sight range (m)
                <input
                  type="number"
                  min={1}
                  max={25}
                  step={0.5}
                  value={resolved.perception.range}
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      perception: { ...profile.perception, range: Number(e.target.value) || 1 }
                    })
                  }
                />
              </label>

              <label className="narrow">
                Half field of view (°)
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={resolved.perception.halfAngleDeg}
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      perception: {
                        ...profile.perception,
                        halfAngleDeg: Number(e.target.value) || 5
                      }
                    })
                  }
                />
                <small>180 sees all around.</small>
              </label>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={resolved.perception.occlusion}
                onChange={(e) =>
                  onChange({
                    ...profile,
                    perception: { ...profile.perception, occlusion: e.target.checked }
                  })
                }
              />
              Objects can hide behind other objects
            </label>

            <label className="narrow">
              Max steps per instruction
              <input
                type="number"
                min={1}
                max={50}
                value={profile.maxIterations ?? DEFAULT_MAX_ITERATIONS}
                onChange={(e) =>
                  onChange({ ...profile, maxIterations: Number(e.target.value) || 1 })
                }
              />
              <small>Caps how many model→action round trips one instruction can take.</small>
            </label>
          </div>
        )}

        {tab === 'preview' && (
          <div className="robot-body">
            <p className="muted">
              Exactly what the model receives on the next run. Providers wrap this differently —
              the Claude Code provider inlines the tool schemas into the system prompt.
            </p>
            <h3>System prompt</h3>
            <pre>{resolved.systemPrompt}</pre>
            <h3>Tools ({resolved.tools.length})</h3>
            <pre>{JSON.stringify(resolved.tools, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillDetail({
  skill,
  onDescription,
  onResetDescription
}: {
  skill: ResolvedSkill
  onDescription: (value: string) => void
  onResetDescription: () => void
}): React.JSX.Element {
  return (
    <div className="skill-detail">
      <h3>
        {skill.name}
        {!skill.enabled && <span className="badge off">disabled</span>}
      </h3>

      <label>
        Description
        <textarea
          rows={6}
          value={skill.description}
          onChange={(e) => onDescription(e.target.value)}
        />
        <small>
          This text is the prompt — it is how the model decides when to call the skill.{' '}
          {skill.overridden && (
            <button className="link" onClick={onResetDescription}>
              Reset to default
            </button>
          )}
        </small>
      </label>

      {skill.overridden && (
        <details>
          <summary>Default description</summary>
          <pre>{skill.defaultDescription}</pre>
        </details>
      )}

      <h4>Parameters</h4>
      <p className="muted small">
        Generated from the skill&rsquo;s zod schema, which also validates incoming arguments. Not
        editable here — change it in the skill&rsquo;s source file.
      </p>
      <pre>{JSON.stringify(skill.parameters, null, 2)}</pre>
    </div>
  )
}
