import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Flag, NewsCard } from '@/components/ui';
import type { RaceSummary } from '@/lib/api';
import type { NewsItem } from '@/lib/home-data';
import type { SkipperRanking } from './ranking/data';
import { CLASS_LABEL } from '@/lib/boat-classes';
import { HomeHeroTopbar } from './HomeHeroTopbar';
import styles from './page.module.css';

type LinkHref = Parameters<typeof Link>[0]['href'];
type Href = string;

interface Cta {
  href: Href;
  label: string;
}

export interface HomeViewProps {
  isVisitor: boolean;
  liveRaces: RaceSummary[];
  news: NewsItem[];
  podium: SkipperRanking[];
  heroStats: {
    liveRaces: number;
    racersOnWater: number;
    totalRegistered: number;
  };
}

/** Normalise un code pays 2-lettres (notre modèle interne) en ISO alpha-2. */
function toIsoCountry(code: string): string {
  return code.toUpperCase();
}

export default function HomeView(props: HomeViewProps): React.ReactElement {
  const t = useTranslations('home.hero');
  const primary: Cta = props.isVisitor
    ? { href: '/login', label: t('ctaPrimaryVisitor') }
    : { href: '/marina', label: t('ctaPrimaryPlayer') };
  const secondary: Cta = {
    href: '/races',
    label: props.isVisitor ? t('ctaSecondaryVisitor') : t('ctaSecondaryPlayer'),
  };

  return (
    <div className={styles.page}>
      <Hero
        isVisitor={props.isVisitor}
        primary={primary}
        secondary={secondary}
        stats={props.heroStats}
      />
      <Pillars />
      <LiveRaces races={props.liveRaces} />
      <CareerBand />
      <NewsGrid news={props.news} />
      <SeasonPodium podium={props.podium} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────

function Hero({
  isVisitor,
  primary,
  secondary,
  stats,
}: {
  isVisitor: boolean;
  primary: Cta;
  secondary: Cta;
  stats: HomeViewProps['heroStats'];
}): React.ReactElement {
  const t = useTranslations('home.hero');
  const tSvg = useTranslations('home.svg.compass');
  return (
    <section className={styles.hero}>
      <div className={styles.heroBg}>
        <img
          src="/images/hero-sailing.jpg"
          alt=""
          aria-hidden
          fetchPriority="high"
        />
      </div>

      <HomeHeroTopbar isVisitor={isVisitor} />

      <div className={styles.heroContent}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>{t('eyebrow')}</p>
          <h1 className={styles.heroTitle}>
            {t('title.line1')}<br />
            {t('title.line2Pre')}<em>{t('title.line2Em')}</em>{t('title.line2Post')}<br />
            {t('title.line3')}
          </h1>
          <p className={styles.heroLede}>
            {t.rich('lede', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <div className={styles.heroCtas}>
            <Link
              href={primary.href as LinkHref}
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              {primary.label} <span className={styles.btnArrow}>→</span>
            </Link>
            <Link
              href={secondary.href as LinkHref}
              className={`${styles.btn} ${styles.btnSecondary}`}
            >
              {secondary.label} <span className={styles.btnArrow}>→</span>
            </Link>
          </div>
          <div className={styles.heroStatus}>
            <span>
              <span className={styles.liveDot} aria-hidden />
              <strong>{stats.liveRaces}</strong>&nbsp;{t('stats.liveRaces')}
            </span>
            <span>
              <strong>{stats.racersOnWater.toLocaleString('fr-FR')}</strong>
              &nbsp;{t('stats.racersOnWater')}
            </span>
            <span>
              <strong>{stats.totalRegistered.toLocaleString('fr-FR')}</strong>
              &nbsp;{t('stats.totalRegistered')}
            </span>
          </div>
        </div>

        <div className={styles.heroCompass} aria-hidden>
          <svg viewBox="0 0 340 340">
            <g
              fill="none"
              stroke="rgba(245, 240, 232, 0.35)"
              strokeWidth="1"
            >
              <circle cx="170" cy="170" r="160" />
              <circle cx="170" cy="170" r="130" />
              <circle cx="170" cy="170" r="90" />
              <circle cx="170" cy="170" r="30" />
              <line x1="170" y1="10" x2="170" y2="330" />
              <line x1="10" y1="170" x2="330" y2="170" />
              <line x1="56" y1="56" x2="284" y2="284" />
              <line x1="284" y1="56" x2="56" y2="284" />
            </g>
            <g
              fill="rgba(245, 240, 232, 0.6)"
              fontFamily="Space Mono"
              fontSize="10"
              textAnchor="middle"
            >
              <text x="170" y="25">{tSvg('n')}</text>
              <text x="325" y="174">{tSvg('e')}</text>
              <text x="170" y="327">{tSvg('s')}</text>
              <text x="15" y="174">{tSvg('o')}</text>
            </g>
          </svg>
          <div className={styles.needle}>
            <svg viewBox="0 0 340 340">
              <path d="M170,10 L180,160 L170,170 L160,160 Z" fill="#c9a227" />
              <path
                d="M170,170 L180,170 L170,330 L160,170 Z"
                fill="rgba(245, 240, 232, 0.4)"
              />
              <circle cx="170" cy="170" r="6" fill="#c9a227" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Pillars
// ─────────────────────────────────────────────────────────────

function Pillars(): React.ReactElement {
  const t = useTranslations('home.pillars');
  const tSvg = useTranslations('home.svg.pillarMeteo');
  return (
    <section className={styles.block}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            {t('eyebrow')}
          </p>
          <h2>{t('title')}</h2>
        </div>
        <p className={styles.sectionLede}>{t('lede')}</p>
      </header>

      <div className={styles.pillars}>
        <article className={styles.pillar}>
          <div className={styles.pillarVisual}>
            <svg viewBox="0 0 200 150" aria-hidden>
              <g
                fill="none"
                stroke="rgba(26, 40, 64, 0.2)"
                strokeWidth="1"
              >
                <circle cx="100" cy="75" r="60" />
                <circle cx="100" cy="75" r="40" />
                <circle cx="100" cy="75" r="20" />
                <line x1="100" y1="15" x2="100" y2="135" />
                <line x1="40" y1="75" x2="160" y2="75" />
              </g>
              <path
                d="M100,30 Q140,35 155,75 Q150,115 125,125 Q100,130 100,120 Z"
                fill="rgba(201, 162, 39, 0.25)"
                stroke="#c9a227"
                strokeWidth="2"
              />
              <circle cx="100" cy="75" r="3" fill="#1a2840" />
            </svg>
          </div>
          <p className={styles.pillarNum}>{t('polars.num')}</p>
          <h3>{t('polars.title')}</h3>
          <p>
            {t.rich('polars.body', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </article>

        <article className={styles.pillar}>
          <div className={styles.pillarVisual}>
            <svg viewBox="0 0 200 150" aria-hidden>
              <rect x="0" y="0" width="200" height="150" fill="#ede8e0" />
              <g stroke="#1a2840" fill="none" strokeWidth="1">
                <path d="M20,30 Q80,40 130,30 T195,35" opacity="0.25" />
                <path d="M15,55 Q70,70 130,60 T195,62" opacity="0.35" />
                <path d="M10,85 Q60,100 130,90 T195,95" opacity="0.45" />
                <path d="M10,115 Q60,130 140,120 T195,125" opacity="0.35" />
              </g>
              <g stroke="#c9a227" strokeWidth="1.5" fill="none">
                <line x1="30" y1="45" x2="45" y2="40" />
                <line x1="80" y1="65" x2="95" y2="58" />
                <line x1="60" y1="100" x2="78" y2="92" />
                <line x1="130" y1="75" x2="148" y2="68" />
              </g>
              <text
                x="108"
                y="65"
                fontFamily="Space Mono"
                fontSize="14"
                fontWeight="700"
                fill="#1a2840"
              >
                {tSvg('lLabel')}
              </text>
              <text
                x="40"
                y="115"
                fontFamily="Space Mono"
                fontSize="14"
                fontWeight="700"
                fill="#1a2840"
              >
                {tSvg('hLabel')}
              </text>
            </svg>
          </div>
          <p className={styles.pillarNum}>{t('weather.num')}</p>
          <h3>{t('weather.title')}</h3>
          <p>
            {t.rich('weather.body', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </article>

        <article className={styles.pillar}>
          <div className={styles.pillarVisual}>
            <PillarCareerSvg />
          </div>
          <p className={styles.pillarNum}>{t('career.num')}</p>
          <h3>{t('career.title')}</h3>
          <p>
            {t.rich('career.body', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </article>
      </div>
    </section>
  );
}

function PillarCareerSvg(): React.ReactElement {
  const tSvg = useTranslations('home.svg.pillarCareer');
  return (
    <svg viewBox="0 0 200 150" aria-hidden>
      <g transform="translate(10, 50)">
        <path
          d="M5,40 L45,40 L40,52 L10,52 Z"
          fill="#cbc4b5"
          opacity="0.6"
        />
        <line
          x1="25"
          y1="40"
          x2="25"
          y2="10"
          stroke="#8a7f6d"
          strokeWidth="1.5"
        />
        <path
          d="M26,10 L45,38 L26,34 Z"
          fill="#cbc4b5"
          stroke="#8a7f6d"
          strokeWidth="0.5"
          opacity="0.8"
        />
        <text
          x="25"
          y="68"
          fontFamily="Space Mono"
          fontSize="7"
          fill="#8a7f6d"
          textAnchor="middle"
          letterSpacing="0.1em"
        >
          {tSvg('blank')}
        </text>
      </g>
      <g transform="translate(75, 50)">
        <path d="M5,40 L45,40 L40,52 L10,52 Z" fill="#1a4d7a" />
        <line
          x1="25"
          y1="40"
          x2="25"
          y2="8"
          stroke="#1a2840"
          strokeWidth="2"
        />
        <path
          d="M26,8 L47,38 L26,34 Z"
          fill="#f5f0e8"
          stroke="#1a2840"
          strokeWidth="0.5"
        />
        <text
          x="25"
          y="68"
          fontFamily="Space Mono"
          fontSize="7"
          fill="#1a2840"
          fontWeight="700"
          textAnchor="middle"
          letterSpacing="0.1em"
        >
          {tSvg('custom')}
        </text>
      </g>
      <g transform="translate(140, 50)">
        <path d="M5,40 L45,40 L40,52 L10,52 Z" fill="#9e2a2a" />
        <line
          x1="25"
          y1="40"
          x2="25"
          y2="5"
          stroke="#1a2840"
          strokeWidth="2.5"
        />
        <path
          d="M26,5 L49,38 L26,34 Z"
          fill="#f5f0e8"
          stroke="#1a2840"
          strokeWidth="0.5"
        />
        <circle cx="40" cy="48" r="5" fill="#c9a227" />
        <text
          x="25"
          y="68"
          fontFamily="Space Mono"
          fontSize="7"
          fill="#c9a227"
          fontWeight="700"
          textAnchor="middle"
          letterSpacing="0.1em"
        >
          {tSvg('palmares')}
        </text>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Live races
// ─────────────────────────────────────────────────────────────

function minifyRoute(points: [number, number][]): string {
  if (points.length === 0) return '';
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const w = Math.max(0.01, maxLon - minLon);
  const h = Math.max(0.01, maxLat - minLat);
  return points
    .map((p, i) => {
      const x = ((p[0] - minLon) / w) * 280 + 20;
      const y = 140 - ((p[1] - minLat) / h) * 100;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function LiveRaces({ races }: { races: RaceSummary[] }): React.ReactElement {
  const t = useTranslations('home.liveRaces');
  const tCommon = useTranslations('common');
  const tActions = useTranslations('common.actions');
  const visible = races.slice(0, 3);
  return (
    <section className={`${styles.block} ${styles.liveRaces}`}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            {t('eyebrow')}
          </p>
          <h2>{t('title')}</h2>
        </div>
        <Link href="/races" className={styles.sectionLink}>
          {t('link')} <span>→</span>
        </Link>
      </header>

      <div className={styles.liveGrid}>
        {visible.length === 0 ? (
          <p className={styles.liveEmpty}>{t('empty')}</p>
        ) : (
          visible.map((r) => {
            const pts: [number, number][] = [
              r.course.start,
              ...r.course.waypoints,
              r.course.finish,
            ];
            const path = minifyRoute(pts);
            return (
              <Link
                key={r.id}
                href={`/play/${r.id}` as LinkHref}
                className={styles.raceCard}
              >
                <header className={styles.raceCardHead}>
                  <div>
                    <h3 className={styles.raceCardName}>{r.name}</h3>
                    <p className={styles.raceCardMeta}>
                      {CLASS_LABEL[r.boatClass]} ·{' '}
                      {r.participants.toLocaleString('fr-FR')} {tCommon('units.skippers')}
                    </p>
                  </div>
                  <span className={`${styles.chip} ${styles.chipLive}`}>
                    <span className={styles.chipDot} />
                    {t('chipLive')}
                  </span>
                </header>
                <div className={styles.raceCardMap}>
                  <svg
                    viewBox="0 0 320 160"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <path
                      d={path}
                      stroke="#1a2840"
                      strokeWidth="1.5"
                      fill="none"
                      opacity="0.65"
                      strokeLinecap="round"
                      strokeDasharray="3 3"
                    />
                    {pts.map((p, i) => {
                      const lons = pts.map((q) => q[0]);
                      const lats = pts.map((q) => q[1]);
                      const minLon = Math.min(...lons);
                      const maxLon = Math.max(...lons);
                      const minLat = Math.min(...lats);
                      const maxLat = Math.max(...lats);
                      const w = Math.max(0.01, maxLon - minLon);
                      const h = Math.max(0.01, maxLat - minLat);
                      const x = ((p[0] - minLon) / w) * 280 + 20;
                      const y = 140 - ((p[1] - minLat) / h) * 100;
                      const isStart = i === 0;
                      const isFinish = i === pts.length - 1;
                      const fill = isStart ? '#2d8a4e' : '#c9a227';
                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r={isStart || isFinish ? 4 : 2.5}
                          fill={fill}
                          stroke={isFinish ? '#1a2840' : 'none'}
                          strokeWidth={isFinish ? 1 : 0}
                        />
                      );
                    })}
                  </svg>
                </div>
                <div className={styles.raceCardLeader}>
                  <span>
                    {t('rewardLabel')}{' '}
                    <strong>
                      {r.rewardMaxCredits.toLocaleString('fr-FR')}
                    </strong>
                    &nbsp;{tCommon('units.credits')}
                  </span>
                  <span className={styles.nb}>{tActions('follow')}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Career band
// ─────────────────────────────────────────────────────────────

function CareerBand(): React.ReactElement {
  const t = useTranslations('home.career');
  const tBoats = useTranslations('common.boats');
  return (
    <section className={`${styles.blockWide} ${styles.career}`}>
      <div className={`${styles.blockWideInner} ${styles.careerInner}`}>
        <div className={styles.careerText}>
          <p className={styles.eyebrow}>{t('eyebrow')}</p>
          <h2>
            {t('titleLine1')}<em>{t('titleEm')}</em>{t('titleLine1End')}<br />{t('titleLine2')}
          </h2>
          <p>
            {t.rich('body1', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <div className={styles.careerEmphasis}>{t('emphasis')}</div>
          <p>
            {t.rich('body2', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <Link
            href={'/subscribe' as LinkHref}
            className={`${styles.btn} ${styles.btnGold}`}
            style={{ marginTop: 16 }}
          >
            {t('cta')} <span className={styles.btnArrow}>→</span>
          </Link>
        </div>

        <div className={styles.careerVisual}>
          <p className={styles.careerVisualEyebrow}>{t('marinaPreviewEyebrow')}</p>
          <h4>{t('marinaPreviewTitle')}</h4>

          <div className={styles.careerBoats}>
            <div className={styles.careerBoat}>
              <svg viewBox="0 0 60 60" aria-hidden>
                <path
                  d="M10,42 L50,42 L44,52 L16,52 Z"
                  fill="#3a4a6b"
                />
                <line
                  x1="30"
                  y1="42"
                  x2="30"
                  y2="12"
                  stroke="#f5f0e8"
                  strokeWidth="1.5"
                />
                <path
                  d="M31,12 L48,40 L31,36 Z"
                  fill="#f5f0e8"
                  opacity="0.9"
                />
              </svg>
              <div className={styles.careerBoatStage}>{tBoats('figaro3')}</div>
            </div>
            <div className={styles.careerBoat}>
              <svg viewBox="0 0 60 60" aria-hidden>
                <path d="M8,42 L52,42 L46,52 L14,52 Z" fill="#9e2a2a" />
                <line
                  x1="30"
                  y1="42"
                  x2="30"
                  y2="8"
                  stroke="#f5f0e8"
                  strokeWidth="1.5"
                />
                <path
                  d="M31,8 L50,40 L31,36 Z"
                  fill="#f5f0e8"
                  stroke="#1a2840"
                  strokeWidth="0.5"
                />
              </svg>
              <div className={styles.careerBoatStage}>{tBoats('imoca60')}</div>
            </div>
            <div className={styles.careerBoat}>
              <svg viewBox="0 0 60 60" aria-hidden>
                <g opacity="0.35">
                  <path
                    d="M10,42 L50,42 L44,52 L16,52 Z"
                    fill="#f5f0e8"
                  />
                  <line
                    x1="30"
                    y1="42"
                    x2="30"
                    y2="15"
                    stroke="#f5f0e8"
                    strokeWidth="1.5"
                  />
                </g>
                <text
                  x="30"
                  y="30"
                  fontFamily="Space Mono"
                  fontSize="16"
                  fill="#c9a227"
                  textAnchor="middle"
                  fontWeight="700"
                >
                  +
                </text>
              </svg>
              <div className={styles.careerBoatStage}>{t('ultimToUnlock')}</div>
            </div>
          </div>

          <div className={styles.careerTimeline}>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>{t('creditsLabel')}</p>
              <p className={styles.careerStatValue}>
                4&nbsp;820<small>{t('creditsUnit')}</small>
              </p>
            </div>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>{t('podiumsLabel')}</p>
              <p className={styles.careerStatValue}>
                07<small>{t('podiumsUnit')}</small>
              </p>
            </div>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>{t('upgradesLabel')}</p>
              <p className={styles.careerStatValue}>
                12<small>{t('upgradesUnit')}</small>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// News grid
// ─────────────────────────────────────────────────────────────

function NewsGrid({ news }: { news: NewsItem[] }): React.ReactElement {
  const t = useTranslations('home.newsGrid');
  return (
    <section className={styles.block}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            {t('eyebrow')}
          </p>
          <h2>{t('title')}</h2>
        </div>
        <Link href={'/news' as LinkHref} className={styles.sectionLink}>
          {t('link')} <span>→</span>
        </Link>
      </header>

      <div className={styles.newsGrid}>
        {news.map((n) => (
          <NewsCard key={n.id} news={n} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Season podium
// ─────────────────────────────────────────────────────────────

function SeasonPodium({
  podium,
}: {
  podium: SkipperRanking[];
}): React.ReactElement | null {
  const t = useTranslations('home.podium');
  if (podium.length < 3) return null;
  const p1 = podium[0];
  const p2 = podium[1];
  const p3 = podium[2];
  if (!p1 || !p2 || !p3) return null;
  return (
    <section className={`${styles.block} ${styles.podiumSection}`}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            {t('eyebrow')}
          </p>
          <h2>{t('title')}</h2>
        </div>
        <Link href="/ranking" className={styles.sectionLink}>
          {t('link')} <span>→</span>
        </Link>
      </header>

      <div className={styles.podiumGrid}>
        <PodiumCard skipper={p2} position={2} tone="p2" />
        <PodiumCard skipper={p1} position={1} tone="p1" />
        <PodiumCard skipper={p3} position={3} tone="p3" />
      </div>
    </section>
  );
}

function PodiumCard({
  skipper,
  position,
  tone,
}: {
  skipper: SkipperRanking;
  position: 1 | 2 | 3;
  tone: 'p1' | 'p2' | 'p3';
}): React.ReactElement {
  const t = useTranslations('home.podium');
  const tCommon = useTranslations('common.units');
  const main = String(position).padStart(2, '0');
  const suffix = position === 1 ? 'er' : 'e';
  const toneCls =
    tone === 'p1'
      ? styles.podiumCardP1
      : tone === 'p2'
      ? styles.podiumCardP2
      : styles.podiumCardP3;
  return (
    <article className={`${styles.podiumCard} ${toneCls}`}>
      <div className={styles.podiumPos}>
        {main}
        <sup>{suffix}</sup>
      </div>
      <div>
        <Flag
          code={toIsoCountry(skipper.country)}
          style={{ width: 20, height: 14, verticalAlign: 'middle' }}
          title={t('flagAria', { country: skipper.country.toUpperCase() })}
        />
      </div>
      <h3 className={styles.podiumName}>{skipper.username}</h3>
      <p className={styles.podiumCity}>
        {skipper.city} · {skipper.country.toUpperCase()}
      </p>
      <p className={styles.podiumPoints}>
        {skipper.rankingScore.toLocaleString('fr-FR')}
        <small>{tCommon('points')}</small>
      </p>
    </article>
  );
}
