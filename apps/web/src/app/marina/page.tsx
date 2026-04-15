import Link from 'next/link';
import { Eyebrow, SiteShell } from '@/components/ui';
import {
  CLASS_LABEL,
  MARINA_SEED,
  type BoatClass,
  type UnlockedBoat,
  type BoatSlot,
} from './data';
import styles from './page.module.css';

function formatRank(n: number): { main: string; suffix: string } {
  return { main: String(n).padStart(2, '0'), suffix: n === 1 ? 'er' : 'e' };
}

function BoatRender({ boat }: { boat: UnlockedBoat }): React.ReactElement {
  // Rendu SVG top-view simplifié : coque + mât + grand-voile + foc + numéro.
  // Pas de distinction monocoque/multicoque en Phase 3 — on gardera ça pour
  // Phase 4 quand la customisation arrivera avec ses presets de coque.
  const deck = boat.deckColor ?? '#f5f0e8';
  return (
    <div className={styles.render}>
      <svg className={styles.renderSvg} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <line x1="10" y1="148" x2="310" y2="148"
              stroke="#1a2840" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 4" />
        <path d="M 50,148 L 268,148 L 244,164 L 76,164 Z" fill={boat.hullColor} />
        <path d="M 50,148 L 268,148 L 264,142 L 54,142 Z" fill={deck} />
        <text x="160" y="160" fontFamily="Bebas Neue" fontSize="12"
              fill="#f5f0e8" textAnchor="middle" letterSpacing="0.1em">{boat.hullNumber}</text>
        <line x1="158" y1="148" x2="158" y2="22" stroke="#1a2840" strokeWidth="2.5" />
        <line x1="158" y1="86" x2="240" y2="92" stroke="#1a2840" strokeWidth="1.5" />
        <path d="M 160,22 L 238,92 L 160,82 Z" fill="#f5f0e8" stroke="#1a2840" strokeWidth="0.6" />
        <text x="195" y="68" fontFamily="Bebas Neue" fontSize="16"
              fill={boat.hullColor} textAnchor="middle">{boat.hullNumber}</text>
        <path d="M 156,22 L 156,82 L 100,124 Z" fill="#f5f0e8" stroke="#1a2840" strokeWidth="0.6" opacity="0.92" />
        <path d="M 150,164 L 166,164 L 158,180 Z" fill="#1a2840" opacity="0.6" />
      </svg>
    </div>
  );
}

function LockedBoatRender({ klass }: { klass: BoatClass }): React.ReactElement {
  // SVG silhouette grisée pour les slots verrouillés.
  const isMulti = klass === 'OCEAN_FIFTY' || klass === 'ULTIM';
  return (
    <div className={styles.render}>
      <svg className={styles.renderSvg} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <line x1="10" y1="148" x2="310" y2="148"
              stroke="#1a2840" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 4" />
        <path d={isMulti
          ? 'M 30,148 L 290,148 L 260,168 L 60,168 Z'
          : 'M 50,148 L 268,148 L 244,164 L 76,164 Z'}
          fill="#1a2840" opacity="0.4" />
        <line x1="160" y1="148" x2="160" y2={klass === 'ULTIM' ? 2 : 8}
              stroke="#1a2840" strokeWidth={klass === 'ULTIM' ? 3.5 : 3} opacity="0.45" />
        <path d={`M 162,${klass === 'ULTIM' ? 2 : 8} L 260,84 L 162,72 Z`}
              fill="#1a2840" opacity="0.25" />
        <path d={`M 158,${klass === 'ULTIM' ? 2 : 8} L 158,72 L 80,124 Z`}
              fill="#1a2840" opacity="0.25" />
      </svg>
    </div>
  );
}

function UnlockedCard({ boat }: { boat: UnlockedBoat }): React.ReactElement {
  const stateClass = boat.stateTone === 'inRace' ? styles.stateInRace
    : boat.stateTone === 'new' ? styles.stateNew : styles.stateIdle;

  const isActive = boat.stateTone === 'inRace';
  const cardCls = [
    styles.card,
    isActive ? styles.cardActive : '',
  ].filter(Boolean).join(' ');

  return (
    <Link href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']} className={cardCls}>
      <header className={styles.head}>
        <span className={styles.class}>{CLASS_LABEL[boat.class]}</span>
        <span className={`${styles.state} ${stateClass}`}>{boat.stateLabel}</span>
      </header>
      <h2 className={styles.name}>{boat.name}</h2>

      <BoatRender boat={boat} />

      <div className={styles.stats}>
        <div>
          <p className={styles.statLabel}>Courses</p>
          <p className={styles.statValue}>{String(boat.races).padStart(2, '0')}</p>
        </div>
        <div>
          <p className={styles.statLabel}>Meilleur</p>
          <p className={`${styles.statValue} ${styles.statValueGold}`}>
            {boat.bestRank
              ? <>{String(boat.bestRank).padStart(2, '0')}<sup>{boat.bestRank === 1 ? 'er' : 'e'}</sup></>
              : '—'}
          </p>
        </div>
        <div>
          <p className={styles.statLabel}>Upgrades</p>
          <p className={styles.statValue}>{boat.upgrades}<small>/6</small></p>
        </div>
      </div>

      <div className={styles.cta}>
        <span>{boat.ctaLabel ?? 'Détail bateau'}</span>
        <span className={styles.ctaArrow}>→</span>
      </div>
    </Link>
  );
}

function LockedCard({ klass }: { klass: BoatClass }): React.ReactElement {
  const label = CLASS_LABEL[klass];
  return (
    <div className={`${styles.card} ${styles.cardLocked}`} aria-disabled>
      <header className={styles.head}>
        <span className={styles.class}>{label}</span>
        <span className={`${styles.state} ${styles.stateLocked}`}>Verrouillé</span>
      </header>
      <h2 className={styles.name}>À débloquer</h2>
      <LockedBoatRender klass={klass} />

      <div className={styles.lockedMsg}>
        <span className={styles.lockedIcon} aria-hidden>⚿</span>
        <p className={styles.lockedText}>
          Inscris-toi à une course <strong>{label}</strong> pour recevoir gratuitement
          ta coque vierge.
        </p>
      </div>

      <Link
        href={`/races?class=${klass}` as Parameters<typeof Link>[0]['href']}
        className={styles.cta}
      >
        <span>Voir les courses {label}</span>
        <span className={styles.ctaArrow}>→</span>
      </Link>
    </div>
  );
}

function Card({ slot }: { slot: BoatSlot }): React.ReactElement {
  if (slot.kind === 'locked') return <LockedCard klass={slot.class} />;
  return <UnlockedCard boat={slot} />;
}

export default function MarinaPage(): React.ReactElement {
  const { unlockedCount, totalSlots, races, bestRankSeason, credits, fleet } = MARINA_SEED;
  const bestRank = formatRank(bestRankSeason.position);

  return (
    <SiteShell>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Ta carrière">Saison 2026</Eyebrow>
          <h1 className={styles.title}>Marina</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            Ta flotte personnelle. Chaque bateau te suit de course en course,
            gagne en performance avec tes <strong>upgrades</strong> et porte
            tes couleurs. Inscris-toi à une course pour débloquer la classe
            correspondante.
          </p>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Bateaux</p>
              <p className={styles.counterValue}>
                {String(unlockedCount).padStart(2, '0')}<small>/{String(totalSlots).padStart(2, '0')}</small>
              </p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Courses</p>
              <p className={styles.counterValue}>{races}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>Meilleur classement</p>
              <p className={`${styles.counterValue} ${styles.counterValueGold}`}>
                {bestRank.main}<sup>{bestRank.suffix}</sup>
              </p>
              <p className={styles.counterSub}>{bestRankSeason.raceName} · {bestRankSeason.season}</p>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.careerBand}>
        <div className={styles.credits}>
          <span className={styles.creditsLabel}>Crédits</span>
          <span className={styles.creditsValue}>
            {credits.toLocaleString('fr-FR')}<small>cr.</small>
          </span>
        </div>
      </div>

      <main className={styles.fleet} aria-label="Flotte du skipper">
        {fleet.map((slot, i) => (
          <Card key={slot.kind === 'unlocked' ? slot.id : `locked-${slot.class}-${i}`} slot={slot} />
        ))}
      </main>
    </SiteShell>
  );
}
