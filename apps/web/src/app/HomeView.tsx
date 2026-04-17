import Link from 'next/link';
import { Flag, NewsCard } from '@/components/ui';
import type { RaceSummary } from '@/lib/api';
import type { NewsItem } from './home-data';
import type { SkipperRanking } from './classement/data';
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

const CLASS_LABEL: Record<RaceSummary['boatClass'], string> = {
  FIGARO: 'Figaro III',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

/** Normalise un code pays 2-lettres (notre modèle interne) en ISO alpha-2. */
function toIsoCountry(code: string): string {
  return code.toUpperCase();
}

export default function HomeView(props: HomeViewProps): React.ReactElement {
  const primary: Cta = props.isVisitor
    ? { href: '/login', label: 'Créer un compte' }
    : { href: '/marina', label: 'Reprendre ma carrière' };
  const secondary: Cta = {
    href: '/races',
    label: props.isVisitor ? 'Voir les courses en direct' : 'Voir les courses',
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

      <header className={styles.heroTopbar}>
        <Link href="/" className={styles.brand} aria-label="Nemo">
          NE<span>M</span>O
        </Link>
        <nav aria-label="Principal">
          <Link href="/races">Courses</Link>
          <Link href="/classement">Classement</Link>
          {!isVisitor && <Link href="/marina">Marina</Link>}
          {!isVisitor && <Link href="/profile">Profil</Link>}
        </nav>
        {isVisitor && (
          <Link href="/login" className={styles.heroLoginBtn}>
            Se connecter
          </Link>
        )}
      </header>

      <div className={styles.heroContent}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>Saison 2026 · Circuit Nemo</p>
          <h1 className={styles.heroTitle}>
            Un bateau.<br />
            Ta <em>carrière</em>.<br />
            Mille à mille.
          </h1>
          <p className={styles.heroLede}>
            <strong>Nemo</strong> est un circuit de course offshore en ligne.
            Polaires réelles fournies par les constructeurs, météo{' '}
            <strong>GFS</strong> mise à jour toutes les 6 h, et un bateau qui
            te suit de course en course, façonné par tes victoires.
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
              <strong>{stats.liveRaces}</strong>&nbsp;courses en direct
            </span>
            <span>
              <strong>{stats.racersOnWater.toLocaleString('fr-FR')}</strong>
              &nbsp;skippers en mer
            </span>
            <span>
              <strong>{stats.totalRegistered.toLocaleString('fr-FR')}</strong>
              &nbsp;skippers inscrits
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
              <text x="170" y="25">N</text>
              <text x="325" y="174">E</text>
              <text x="170" y="327">S</text>
              <text x="15" y="174">O</text>
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
  return (
    <section className={styles.block}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            02 · L'essentiel
          </p>
          <h2>Voici Nemo.</h2>
        </div>
        <p className={styles.sectionLede}>
          Trois piliers qui font de Nemo un circuit de skipper : simulation
          fidèle, données partagées par tous, progression qui se gagne course
          après course.
        </p>
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
          <p className={styles.pillarNum}>01 · Polaires</p>
          <h3>Polaires réelles</h3>
          <p>
            Les <strong>mêmes fichiers</strong> pour tous les joueurs, du
            Figaro III à l'Ultim. Fournis par les constructeurs, jamais
            modifiés. Ton bateau se comporte exactement comme dans la vraie vie.
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
                L
              </text>
              <text
                x="40"
                y="115"
                fontFamily="Space Mono"
                fontSize="14"
                fontWeight="700"
                fill="#1a2840"
              >
                H
              </text>
            </svg>
          </div>
          <p className={styles.pillarNum}>02 · Météo</p>
          <h3>Météo réelle</h3>
          <p>
            Les données <strong>GFS</strong> mises à jour toutes les 6 h,
            identiques côté moteur de jeu et côté routeurs tiers. Tes décisions
            tactiques se prennent sur les mêmes fichiers que ceux d'un skipper
            en vraie course.
          </p>
        </article>

        <article className={styles.pillar}>
          <div className={styles.pillarVisual}>
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
                  VIERGE
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
                  CUSTOMISÉ
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
                  PALMARÈS
                </text>
              </g>
            </svg>
          </div>
          <p className={styles.pillarNum}>03 · Carrière</p>
          <h3>Ton bateau, ta carrière</h3>
          <p>
            Une <strong>seule coque</strong> qui te suit de course en course.
            Tes podiums financent tes upgrades — voiles, foils, électronique.
            Ta progression est la seule monnaie qui compte.
          </p>
        </article>
      </div>
    </section>
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
  const visible = races.slice(0, 3);
  return (
    <section className={`${styles.block} ${styles.liveRaces}`}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            03 · En direct
          </p>
          <h2>Ça se joue maintenant.</h2>
        </div>
        <Link href="/races" className={styles.sectionLink}>
          Voir toutes les courses <span>→</span>
        </Link>
      </header>

      <div className={styles.liveGrid}>
        {visible.length === 0 ? (
          <p className={styles.liveEmpty}>
            Aucune course en direct pour le moment — jette un œil aux courses
            ouvertes.
          </p>
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
                      {r.participants.toLocaleString('fr-FR')} skippers
                    </p>
                  </div>
                  <span className={`${styles.chip} ${styles.chipLive}`}>
                    <span className={styles.chipDot} />
                    En direct
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
                    Dotation{' '}
                    <strong>
                      {r.rewardMaxCredits.toLocaleString('fr-FR')}
                    </strong>
                    &nbsp;cr
                  </span>
                  <span className={styles.nb}>Suivre →</span>
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
  return (
    <section className={`${styles.blockWide} ${styles.career}`}>
      <div className={`${styles.blockWideInner} ${styles.careerInner}`}>
        <div className={styles.careerText}>
          <p className={styles.eyebrow}>04 · Carrière skipper</p>
          <h2>
            Une seule <em>coque</em>.<br />Mille milles.
          </h2>
          <p>
            Le <strong>mode Carrière</strong>, c'est la version longue de
            Nemo. Tu démarres avec un bateau récent mais vierge d'équipement —
            Figaro, Class40, IMOCA ou Ultim selon la course qui te lance.
            Chaque épreuve que tu finis laisse une trace : un podium, des
            crédits, une upgrade.
          </p>
          <div className={styles.careerEmphasis}>
            Ton bateau vieillit avec toi, prend des couleurs, gagne en
            performance.
          </div>
          <p>
            Les crédits se gagnent en course et financent tes upgrades —
            voiles, foils, électronique. Le <strong>mode Carrière</strong> te
            donne accès à la persistance de ton bateau, à ta progression sur la
            saison, et au palmarès officiel du circuit.
          </p>
          <Link
            href={'/subscribe' as LinkHref}
            className={`${styles.btn} ${styles.btnGold}`}
            style={{ marginTop: 16 }}
          >
            Rejoindre le circuit <span className={styles.btnArrow}>→</span>
          </Link>
        </div>

        <div className={styles.careerVisual}>
          <p className={styles.careerVisualEyebrow}>Aperçu Marina</p>
          <h4>Ta flotte — Saison 2026</h4>

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
              <div className={styles.careerBoatStage}>Figaro III</div>
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
              <div className={styles.careerBoatStage}>IMOCA 60</div>
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
              <div className={styles.careerBoatStage}>Ultim · à débloquer</div>
            </div>
          </div>

          <div className={styles.careerTimeline}>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>Crédits</p>
              <p className={styles.careerStatValue}>
                4&nbsp;820<small>cr</small>
              </p>
            </div>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>Podiums</p>
              <p className={styles.careerStatValue}>
                07<small>saison</small>
              </p>
            </div>
            <div className={styles.careerStat}>
              <p className={styles.careerStatLabel}>Upgrades</p>
              <p className={styles.careerStatValue}>
                12<small>/18</small>
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
  return (
    <section className={styles.block}>
      <header className={styles.sectionHead}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowOnLight}`}>
            05 · Actualités · Saison 2026
          </p>
          <h2>Journal de bord.</h2>
        </div>
        <Link href={'/news' as LinkHref} className={styles.sectionLink}>
          Toutes les actualités <span>→</span>
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
            06 · Circuit Nemo
          </p>
          <h2>Ils sont en tête.</h2>
        </div>
        <Link href="/classement" className={styles.sectionLink}>
          Classement complet <span>→</span>
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
          title={`Drapeau ${skipper.country.toUpperCase()}`}
        />
      </div>
      <h3 className={styles.podiumName}>{skipper.username}</h3>
      <p className={styles.podiumCity}>
        {skipper.city} · {skipper.country.toUpperCase()}
      </p>
      <p className={styles.podiumPoints}>
        {skipper.rankingScore.toLocaleString('fr-FR')}
        <small>pts</small>
      </p>
    </article>
  );
}
