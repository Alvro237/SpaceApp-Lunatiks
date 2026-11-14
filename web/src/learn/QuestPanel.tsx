/**
 * The running challenge, floating over the navigator: the question, a hint, the choices and, once answered,
 * the measured numbers behind the answer. The answer is computed by the browser engine for this exact scene.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEphemeris, useMasks } from '../time/hooks'
import { QUESTS, questById } from './quests'
import { useQuest } from './useQuest'

export function QuestPanel() {
  const activeId = useQuest((s) => s.activeId)
  const quest = questById(activeId)
  if (!quest) return null
  // A new key per challenge resets the answer state.
  return <QuestCard key={quest.id} id={quest.id} />
}

function QuestCard({ id }: { id: string }) {
  const quest = questById(id)!
  const { stop, start, markDone } = useQuest()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const [picked, setPicked] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const headingId = useId()
  const solved = useMemo(() => (eph && masks ? quest.solve({ table: eph.table, masks }) : null), [eph, masks, quest])
  const index = QUESTS.findIndex((q) => q.id === id)
  const next = QUESTS[index + 1] ?? null
  const right = solved && picked === solved.answerId

  useEffect(() => {
    if (right) markDone(id)
  }, [right, id, markDone])

  return (
    <section className="float quest-card" aria-labelledby={headingId}>
      <div className="quest-top">
        <span className="quest-kicker">
          Lunar Quest · {index + 1} of {QUESTS.length} · {quest.kind}
        </span>
        <button type="button" className="icon small" aria-label="Close the challenge" onClick={stop}>
          ✕
        </button>
      </div>
      <h2 id={headingId} className="quest-title">
        {quest.title}
      </h2>
      <p className="quest-question">{quest.question}</p>

      {!solved && <p className="hint">Working out the answer from the ephemeris and LOLA horizons…</p>}
      {solved && (
        <div role="group" aria-label="Your answer" className="quest-choices">
          {solved.choices.map((c) => {
            const state = picked === null ? '' : c.id === solved.answerId ? ' is-right' : c.id === picked ? ' is-wrong' : ' is-dim'
            return (
              <button key={c.id} type="button" className={`quest-choice${state}`} aria-pressed={picked === c.id} disabled={picked !== null} onClick={() => setPicked(c.id)}>
                <span>{c.label}</span>
                {picked !== null && c.id === solved.answerId && <span aria-hidden="true">✓</span>}
                {picked === c.id && c.id !== solved.answerId && <span aria-hidden="true">✕</span>}
              </button>
            )
          })}
        </div>
      )}

      <div role="status" aria-live="polite">
        {solved && picked !== null && (
          <div className={`quest-result${right ? ' is-right' : ' is-wrong'}`}>
            <strong>{right ? 'Correct.' : 'Not this time.'}</strong> {solved.explanation}
            <span className="quest-skill">Skill: {quest.skill}</span>
          </div>
        )}
      </div>

      <div className="quest-actions">
        {picked === null ? (
          <button type="button" className="link" aria-expanded={showHint} onClick={() => setShowHint(!showHint)}>
            {showHint ? 'Hide hint' : 'Hint'}
          </button>
        ) : (
          <button type="button" className="link" onClick={() => setPicked(null)}>
            Try again
          </button>
        )}
        <span className="quest-spacer" />
        {next ? (
          <button type="button" className="primary" onClick={() => start(next.id)}>
            Next challenge
          </button>
        ) : (
          <Link className="button-link" to="/learn" onClick={stop}>
            All challenges
          </Link>
        )}
      </div>
      {showHint && picked === null && <p className="quest-hint">{quest.hint}</p>}
    </section>
  )
}
