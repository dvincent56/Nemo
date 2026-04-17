import Link from 'next/link';
import { Eyebrow, BoatSvg } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';
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

      <div className={styles.render}>
        <BoatSvg className={styles.renderSvg} hullColor={boat.hullColor} deckColor={boat.deckColor} />
      </div>

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
      <div className={styles.render}>
        <BoatSvg className={styles.renderSvg} hullColor="#1a2840" locked />
      </div>

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
