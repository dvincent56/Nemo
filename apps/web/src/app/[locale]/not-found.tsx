import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Hors carte — Nemo',
  description: 'Cette page n’apparaît sur aucune de nos cartes.',
};

export default function NotFound(): React.ReactElement {
  return (
    <div className={styles.root}>
      <Link href="/" className={styles.brand} aria-label="Nemo — accueil">
        NE<span>M</span>O
      </Link>

      <main className={styles.page}>
        <div className={styles.chart} aria-hidden="true">
          <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
            <defs>
              <pattern id="nf-grid" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#1a2840" strokeWidth="0.5" strokeOpacity="0.18" />
              </pattern>
            </defs>

            <rect x="60" y="60" width="1080" height="680" fill="none" stroke="#1a2840" strokeWidth="1" strokeOpacity="0.5" />
            <rect x="68" y="68" width="1064" height="664" fill="none" stroke="#1a2840" strokeWidth="0.5" strokeOpacity="0.3" />

            <rect x="68" y="68" width="1064" height="664" fill="url(#nf-grid)" />

            <g fontFamily="Space Mono, monospace" fontSize="9" fill="#1a2840" fillOpacity="0.55" letterSpacing="0.1em">
              <text x="74" y="55">47°N</text>
              <text x="1100" y="55">04°W</text>
              <text x="74" y="752">45°N</text>
              <text x="1100" y="752">02°W</text>
            </g>

            <g className={styles.coastMark} stroke="#1a2840" strokeOpacity="0.35" strokeWidth="0.8" fill="none">
              <path d="M 68 220 L 130 240 L 95 280 L 145 320 L 90 360 L 130 410 L 80 460 L 120 510" />
            </g>

            <g fill="none" stroke="#1a2840" strokeOpacity="0.22" strokeWidth="0.8" strokeDasharray="2 4">
              <path d="M 200 200 Q 480 280 720 240 T 1100 320" />
              <path className={styles.isobathSecondary} d="M 220 350 Q 500 430 740 400 T 1120 480" strokeOpacity="0.18" />
              <path className={styles.isobathSecondary} d="M 180 540 Q 450 600 700 580 T 1110 640" strokeOpacity="0.15" />
            </g>

            <g className={styles.compass} stroke="#1a2840" strokeOpacity="0.4" fill="#1a2840" fillOpacity="0.4">
              <circle cx="1080" cy="140" r="46" fill="none" strokeWidth="0.8" />
              <circle cx="1080" cy="140" r="34" fill="none" strokeWidth="0.5" />
              <circle cx="1080" cy="140" r="2.5" stroke="none" />
              <path d="M 1080 90 L 1085 138 L 1080 140 L 1075 138 Z" stroke="none" />
              <path d="M 1080 190 L 1085 142 L 1080 140 L 1075 142 Z" fillOpacity="0.25" stroke="none" />
              <path d="M 1130 140 L 1082 145 L 1080 140 L 1082 135 Z" fillOpacity="0.25" stroke="none" />
              <path d="M 1030 140 L 1078 145 L 1080 140 L 1078 135 Z" fillOpacity="0.25" stroke="none" />
              <line x1="1045" y1="105" x2="1115" y2="175" strokeWidth="0.4" strokeOpacity="0.3" />
              <line x1="1115" y1="105" x2="1045" y2="175" strokeWidth="0.4" strokeOpacity="0.3" />
              <text x="1080" y="80" textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="10" fillOpacity="0.65" stroke="none" letterSpacing="0.1em">N</text>
              <text x="1080" y="208" textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="9" fillOpacity="0.4" stroke="none">S</text>
              <text x="1148" y="144" textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="9" fillOpacity="0.4" stroke="none">E</text>
              <text x="1012" y="144" textAnchor="middle" fontFamily="Space Mono, monospace" fontSize="9" fillOpacity="0.4" stroke="none">O</text>
            </g>

            <path
              className={styles.route}
              d="M 280 640 Q 460 540 580 520 T 820 380 Q 920 320 1010 240 Q 1080 180 1170 50"
              fill="none"
              stroke="#c9a227"
              strokeWidth="1.6"
              strokeLinecap="round"
            />

            <g fill="#c9a227" fillOpacity="0.6">
              <circle cx="280" cy="640" r="2.5" />
              <circle cx="580" cy="520" r="2.5" />
              <circle cx="820" cy="380" r="2.5" />
            </g>

            <g className={styles.herePt}>
              <circle cx="1170" cy="50" r="6" fill="#c9a227" />
              <circle cx="1170" cy="50" r="11" fill="none" stroke="#c9a227" strokeWidth="0.8" strokeOpacity="0.5" />
            </g>
            <text
              className={styles.hereLabel}
              x="1158"
              y="34"
              textAnchor="end"
              fontFamily="Space Mono, monospace"
              fontSize="11"
              fontWeight="700"
              letterSpacing="0.18em"
              fill="#a8871e"
            >
              ICI
            </text>
          </svg>
        </div>

        <section className={styles.hero}>
          <div className={styles.kicker}>404 — Hors carte</div>
          <h1 className={styles.title}>
            Vous êtes perdu
            <br />
            en mer ?
          </h1>
          <hr className={styles.rule} />
          <p className={styles.lede}>
            Cette page n&rsquo;apparaît sur aucune de nos cartes.
            <br />
            Aucune côte connue à cette position.
          </p>
          <Link href="/" className={styles.cta}>
            <span className={styles.arrow}>←</span>
            Retour au port
          </Link>
        </section>
      </main>

      <div className={styles.hudPos}>
        POS · <b>UNKNOWN</b>
      </div>
    </div>
  );
}
