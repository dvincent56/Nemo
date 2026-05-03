'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eyebrow, BoatSvg } from '@/components/ui';
import {
  fetchMyBoats, createBoat,
  type BoatRecord, type BoatClass,
} from '@/lib/marina-api';
import { useBoatLabel } from '@/lib/boat-classes-i18n';
import { ALL_CLASSES, MAX_BOATS_PER_CLASS } from './data';
import styles from './page.module.css';

function BoatCard({ boat }: { boat: BoatRecord }): React.ReactElement {
  const t = useTranslations('marina.boatCard');
  const inRace = !!boat.activeRaceId;
  const stateLabel = inRace
    ? t('stateInRace', { raceId: boat.activeRaceId ?? '' })
    : t('stateIdle');
  const stateCls = inRace ? styles.stateInRace : styles.stateIdle;
  const cardCls = `${styles.card} ${inRace ? styles.cardActive : ''}`;

  return (
    <Link href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']} className={cardCls}>
      <header className={styles.head}>
        <span className={`${styles.state} ${stateCls}`}>{stateLabel}</span>
      </header>
      <h3 className={styles.name}>{boat.name}</h3>
      <div className={styles.render}>
        <BoatSvg className={styles.renderSvg} hullColor={boat.hullColor ?? '#1a2840'} deckColor={boat.deckColor ?? undefined} />
      </div>
      <div className={styles.stats}>
        <div>
          <p className={styles.statLabel}>{t('races')}</p>
          <p className={styles.statValue}>{String(boat.racesCount).padStart(2, '0')}</p>
        </div>
        <div>
          <p className={styles.statLabel}>{t('podiums')}</p>
          <p className={`${styles.statValue} ${styles.statValueGold}`}>{boat.podiums}</p>
        </div>
        <div>
          <p className={styles.statLabel}>{t('condition')}</p>
          <p className={styles.statValue}>
            {Math.round((boat.hullCondition + boat.rigCondition + boat.sailCondition + boat.elecCondition) / 4)}%
          </p>
        </div>
      </div>
      <div className={styles.cta}>
        <span>{t('cta')}</span>
        <span className={styles.ctaArrow}>→</span>
      </div>
    </Link>
  );
}

function NewBoatButton({ boatClass, onCreated }: {
  boatClass: BoatClass;
  onCreated: () => void;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('marina');
  const boatLabel = useBoatLabel();
  const label = boatLabel(boatClass);
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    try {
      const defaultName = `${label} ${Date.now() % 1000}`;
      const result = await createBoat(boatClass, defaultName);
      onCreated();
      router.push(`/marina/${result.id}/customize`);
    } catch (err) {
      console.error('create boat failed', err);
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`${styles.card} ${styles.cardNew}`} onClick={handleCreate} disabled={busy}>
      <span className={styles.newIcon}>+</span>
      <span className={styles.newLabel}>{t('newBoatLabel', { label })}</span>
    </button>
  );
}

export default function MarinaClient(): React.ReactElement {
  const t = useTranslations('marina');
  const boatLabel = useBoatLabel();
  const [boats, setBoats] = useState<BoatRecord[]>([]);
  const [credits, setCredits] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyBoats();
      setBoats(data.boats);
      setCredits(data.credits);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errorUnknown');
      setLoadError(msg);
    }
    setLoaded(true);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const byClass = new Map<string, BoatRecord[]>();
  for (const cls of ALL_CLASSES) byClass.set(cls, []);
  for (const b of boats) {
    const list = byClass.get(b.boatClass);
    if (list) list.push(b);
  }

  const totalBoats = boats.length;

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('eyebrowTrailing')}>{t('eyebrowSeason')}</Eyebrow>
          <h1 className={styles.title}>{t('title')}</h1>
        </div>
        <div>
          <p className={styles.heroMeta}>
            {t.rich('heroLede', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <div className={styles.counters}>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>{t('counters.boats')}</p>
              <p className={styles.counterValue}>{String(totalBoats).padStart(2, '0')}</p>
            </div>
            <div className={styles.counter}>
              <p className={styles.counterLabel}>{t('counters.credits')}</p>
              <p className={styles.counterValue}>
                {credits.toLocaleString('fr-FR')}<small>{t('counters.creditsUnit')}</small>
              </p>
            </div>
            <Link
              href={'/marina/inventory' as Parameters<typeof Link>[0]['href']}
              className={styles.inventoryLink}
            >
              {t('inventoryLink')}
            </Link>
          </div>
        </div>
      </section>

      {loadError && (
        <div className={styles.errorBanner}>
          <strong>{t('errorBannerTitle')}</strong> {loadError}.
          {' '}{t('errorBannerHelp')}{' '}
          <Link href="/login">/login</Link>
          {t('errorBannerHelpEnd')}
        </div>
      )}

      {loaded && !loadError && boats.length === 0 && (
        <div className={styles.emptyBanner}>{t('emptyBanner')}</div>
      )}

      <main className={styles.fleet} aria-label={t('ariaFleet')}>
        {ALL_CLASSES.map((cls) => {
          const classBoats = byClass.get(cls) ?? [];
          const unlocked = classBoats.length > 0;
          const label = boatLabel(cls);

          return (
            <section key={cls} className={styles.classSection}>
              <header className={styles.classHeader}>
                <h2 className={styles.className}>{label}</h2>
                <span className={styles.classCount}>
                  {unlocked ? t('classCount', { n: classBoats.length, max: MAX_BOATS_PER_CLASS }) : t('classLocked')}
                </span>
              </header>

              {unlocked ? (
                <div className={styles.classGrid}>
                  {classBoats.map((b) => <BoatCard key={b.id} boat={b} />)}
                  {classBoats.length < MAX_BOATS_PER_CLASS && (
                    <NewBoatButton boatClass={cls} onCreated={load} />
                  )}
                </div>
              ) : (
                <div className={styles.classLocked}>
                  <p className={styles.lockedText}>
                    {t('lockedTextPre')}<strong>{label}</strong>{t('lockedTextPost')}
                  </p>
                  <Link
                    href={`/races?class=${cls}` as Parameters<typeof Link>[0]['href']}
                    className={styles.lockedCta}
                  >
                    {t('lockedCta', { label })}
                  </Link>
                </div>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
