'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Pagination } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import styles from './page.module.css';

const PAGE_SIZE = 12;

type CountryCode = 'fr' | 'nl' | 'it' | 'uk' | 'no' | 'es' | 'ie' | 'pt';

interface Person {
  pseudo: string;
  city: string;
  rank: number;
  country: CountryCode;
  isMe?: boolean;
  role?: string;
}

const FRIENDS: Person[] = [
  { pseudo: 'laperouse',     city: 'La Trinité',  rank:  1, country: 'fr' },
  { pseudo: 'northwind',     city: 'Amsterdam',   rank: 42, country: 'nl' },
  { pseudo: 'bora_c',        city: 'Trieste',     rank: 11, country: 'it' },
  { pseudo: 'finistère',     city: 'Brest',       rank: 28, country: 'fr' },
  { pseudo: 'tradewind',     city: 'Cowes',       rank: 19, country: 'uk' },
  { pseudo: 'mistral',       city: 'Marseille',   rank: 53, country: 'fr' },
  { pseudo: 'aurora',        city: 'Tromsø',      rank: 64, country: 'no' },
  { pseudo: 'bay_of_biscay', city: 'Bilbao',      rank: 31, country: 'es' },
  { pseudo: 'ribeira',       city: 'Porto',       rank: 47, country: 'pt' },
  { pseudo: 'shamrock',      city: 'Cork',        rank: 38, country: 'ie' },
  { pseudo: 'palma_loop',    city: 'Palma',       rank: 92, country: 'es' },
  { pseudo: 'arctic_swan',   city: 'Bergen',      rank: 56, country: 'no' },
  { pseudo: 'thames_run',    city: 'Greenwich',   rank: 81, country: 'uk' },
  { pseudo: 'genova_blue',   city: 'Gênes',       rank: 73, country: 'it' },
  { pseudo: 'rotterdam_ne',  city: 'Rotterdam',   rank: 105, country: 'nl' },
  { pseudo: 'breizh_5',      city: 'Saint-Malo',  rank: 22, country: 'fr' },
  { pseudo: 'cap_sicie',     city: 'Toulon',      rank: 60, country: 'fr' },
  { pseudo: 'killybegs',     city: 'Killybegs',   rank: 88, country: 'ie' },
  { pseudo: 'algarve_wind',  city: 'Lagos',       rank: 49, country: 'pt' },
];

const TEAM_MEMBERS: Person[] = [
  { pseudo: 'laperouse',  city: 'La Trinité',  rank:  1, country: 'fr', role: 'Capitaine' },
  { pseudo: 'vous',       city: 'La Rochelle', rank: 12, country: 'fr', isMe: true, role: 'Modérateur' },
  { pseudo: 'finistère',  city: 'Brest',       rank: 28, country: 'fr' },
  { pseudo: 'meridian',   city: 'Lorient',     rank: 67, country: 'fr' },
  { pseudo: 'ouest_pure', city: 'Quimper',     rank: 95, country: 'fr' },
  { pseudo: 'sablais',    city: "Les Sables-d'Olonne", rank: 41, country: 'fr' },
  { pseudo: 'iroise',     city: 'Brest',       rank: 33, country: 'fr' },
  { pseudo: 'cap_ferret', city: 'Arcachon',    rank: 78, country: 'fr' },
];

interface Invitation {
  pseudo: string;
  meta: string;
  message?: string;
  country: CountryCode;
  pending: boolean;
  outgoing?: boolean;
}

const INVITATIONS_RECEIVED: Invitation[] = [
  {
    pseudo: 'hebrides',
    meta: 'Stornoway · Veut te suivre',
    message: '« Je t\'ai vu passer devant sur la Fastnet l\'année dernière, on partage la même obsession pour les dépressions atlantiques. »',
    country: 'uk', pending: true,
  },
  {
    pseudo: 'Écurie Bretagne Offshore',
    meta: 'Équipe · 12 membres · T\'invite à rejoindre',
    message: '« On cherche un skipper régulier en Class40 pour compléter notre effectif. Ton profil nous intéresse. »',
    country: 'fr', pending: true,
  },
];

const INVITATIONS_SENT: Invitation[] = [
  {
    pseudo: 'portofino',
    meta: 'Portofino · Tu l\'as invité il y a 3 jours',
    country: 'it', pending: false, outgoing: true,
  },
];

function PersonCard({ p, meUsername }: { p: Person; meUsername: string | null }): React.ReactElement {
  const display = p.isMe && meUsername ? meUsername : p.pseudo;
  const body = (
    <>
      <span className={`${styles.flag} ${styles[p.country]}`} aria-hidden />
      <div className={styles.personInfo}>
        <p className={styles.personName}>
          {display}
          {p.role && <span className={styles.personRole}>· {p.role}</span>}
        </p>
        <p className={styles.personMeta}>
          {p.city} · Rang {String(p.rank).padStart(2, '0')}
        </p>
      </div>
      {p.isMe
        ? <span className={styles.personMeBadge}>Moi</span>
        : <span className={styles.personIconBtn} aria-hidden>→</span>}
    </>
  );
  if (p.isMe) {
    return (
      <article className={`${styles.person} ${styles.personMe}`}>{body}</article>
    );
  }
  return (
    <Link
      href={`/profile/${encodeURIComponent(p.pseudo)}` as Parameters<typeof Link>[0]['href']}
      className={styles.person}
      aria-label={`Profil de ${display}`}
    >
      {body}
    </Link>
  );
}

function InvitationCard({
  inv, onAccept, onRefuse, onCancel,
}: {
  inv: Invitation;
  onAccept: () => void;
  onRefuse: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <article className={`${styles.invitation} ${inv.pending ? styles.invitationPending : ''}`}>
      <span className={`${styles.flag} ${styles[inv.country]}`} aria-hidden />
      <div className={styles.personInfo}>
        <p className={styles.personName}>
          <Link
            href={`/profile/${encodeURIComponent(inv.pseudo)}` as Parameters<typeof Link>[0]['href']}
            className={styles.personLink}
          >
            {inv.pseudo}
          </Link>
        </p>
        <p className={styles.personMeta}>{inv.meta}</p>
        {inv.message && <p className={styles.invitationMsg}>{inv.message}</p>}
      </div>
      <div className={styles.invActions}>
        {inv.outgoing ? (
          <Button variant="danger" onClick={onCancel}>Annuler l'invitation</Button>
        ) : (
          <>
            <Button variant="primary" onClick={onAccept}>Accepter</Button>
            <Button variant="ghost" onClick={onRefuse}>Refuser</Button>
          </>
        )}
      </div>
    </article>
  );
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export default function SocialView(): React.ReactElement {
  const [meUsername, setMeUsername] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [invTab, setInvTab] = useState<'received' | 'sent'>('received');
  const [friendsPage, setFriendsPage] = useState(1);
  const [teamPage, setTeamPage] = useState(1);

  // State local : on stocke les pseudos rejetés/acceptés/annulés pour pouvoir
  // les retirer de la liste sans re-render des seeds (Phase 4 : RPC backend).
  const [removedReceived, setRemovedReceived] = useState<Set<string>>(new Set());
  const [removedSent, setRemovedSent] = useState<Set<string>>(new Set());
  const [acceptedFriends, setAcceptedFriends] = useState<string[]>([]);

  useEffect(() => {
    const s = readClientSession();
    setMeUsername(s.username);
  }, []);

  function handleAccept(inv: Invitation): void {
    setRemovedReceived((prev) => new Set(prev).add(inv.pseudo));
    setAcceptedFriends((prev) => [...prev, inv.pseudo]);
  }
  function handleRefuse(inv: Invitation): void {
    setRemovedReceived((prev) => new Set(prev).add(inv.pseudo));
  }
  function handleCancel(inv: Invitation): void {
    setRemovedSent((prev) => new Set(prev).add(inv.pseudo));
  }

  // Liste des amis incluant ceux acceptés depuis les invitations.
  const allFriends = useMemo<Person[]>(() => {
    const accepted: Person[] = acceptedFriends.map((pseudo, i) => ({
      pseudo,
      city: '—',
      rank: 999 + i,
      country: 'fr', // Phase 4 : récupéré depuis le profil acceptant l'invit.
    }));
    return [...FRIENDS, ...accepted];
  }, [acceptedFriends]);

  const filteredFriends = useMemo(() => {
    if (!search.trim()) return allFriends;
    const q = search.toLowerCase().trim();
    return allFriends.filter((f) =>
      f.pseudo.toLowerCase().includes(q) || f.city.toLowerCase().includes(q),
    );
  }, [search, allFriends]);

  // Reset à la page 1 si la recherche change le périmètre
  useEffect(() => { setFriendsPage(1); }, [search]);

  const friendsPages = Math.max(1, Math.ceil(filteredFriends.length / PAGE_SIZE));
  const visibleFriends = paginate(filteredFriends, friendsPage, PAGE_SIZE);

  const teamPages = Math.max(1, Math.ceil(TEAM_MEMBERS.length / PAGE_SIZE));
  const visibleTeam = paginate(TEAM_MEMBERS, teamPage, PAGE_SIZE);

  const visibleInvitations = invTab === 'received'
    ? INVITATIONS_RECEIVED.filter((i) => !removedReceived.has(i.pseudo))
    : INVITATIONS_SENT.filter((i) => !removedSent.has(i.pseudo));
  const receivedCount = INVITATIONS_RECEIVED.filter((i) => !removedReceived.has(i.pseudo)).length;
  const sentCount = INVITATIONS_SENT.filter((i) => !removedSent.has(i.pseudo)).length;

  return (
    <>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Social</h1>
          <p className={styles.sub}>
            Suis d'autres skippers, rejoins une équipe, gère tes invitations.
          </p>
        </div>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden>⌕</span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Rechercher un skipper…"
            aria-label="Rechercher un skipper"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {/* ── Amis ── */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Skippers que tu suis</p>
            <h2 className={styles.sectionTitle}>
              Amis <span className={styles.count}>{String(filteredFriends.length).padStart(2, '0')}</span>
            </h2>
          </div>
          <a href="#" className={styles.sectionLink}>Suggestions →</a>
        </header>
        <div className={styles.peopleGrid}>
          {visibleFriends.map((p) => (
            <PersonCard key={p.pseudo} p={p} meUsername={meUsername} />
          ))}
        </div>
        <Pagination
          page={friendsPage}
          totalPages={friendsPages}
          totalItems={filteredFriends.length}
          pageSize={PAGE_SIZE}
          onChange={setFriendsPage}
          label="Pagination amis"
        />
      </section>

      {/* ── Équipe ── */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>Écurie</p>
            <h2 className={styles.sectionTitle}>Mon équipe</h2>
          </div>
          <Link
            href={'/team/la-rochelle-racing' as Parameters<typeof Link>[0]['href']}
            className={styles.sectionLink}
          >Voir la page équipe →</Link>
        </header>

        <div className={styles.teamHero}>
          <div>
            <p className={styles.teamEyebrow}>
              Capitaine{' '}
              <Link
                href={'/profile/laperouse' as Parameters<typeof Link>[0]['href']}
                className={styles.personLink}
              >laperouse</Link>
            </p>
            <h3 className={styles.teamName}>
              <Link
                href={'/team/la-rochelle-racing' as Parameters<typeof Link>[0]['href']}
                className={styles.teamNameLink}
              >La Rochelle Racing</Link>
            </h3>
            <p className={styles.teamMeta}>
              <span>Fondée en <strong>2024</strong></span>
              <span>Base <strong>La Rochelle</strong></span>
              <span><strong>{String(TEAM_MEMBERS.length).padStart(2, '0')}</strong> membres</span>
            </p>
          </div>
          <div className={styles.teamStats}>
            <div className={styles.teamStat}>
              <p className={styles.teamStatLabel}>Classement</p>
              <p className={`${styles.teamStatValue} ${styles.teamStatValueGold}`}>03<sup>e</sup></p>
            </div>
            <div className={styles.teamStat}>
              <p className={styles.teamStatLabel}>Courses courues</p>
              <p className={styles.teamStatValue}>214</p>
            </div>
            <div className={styles.teamStat}>
              <p className={styles.teamStatLabel}>Podiums</p>
              <p className={`${styles.teamStatValue} ${styles.teamStatValueGold}`}>34</p>
            </div>
          </div>
        </div>

        <div className={styles.peopleGrid}>
          {visibleTeam.map((p) => (
            <PersonCard key={p.pseudo + (p.isMe ? '-me' : '')} p={p} meUsername={meUsername} />
          ))}
        </div>
        <Pagination
          page={teamPage}
          totalPages={teamPages}
          totalItems={TEAM_MEMBERS.length}
          pageSize={PAGE_SIZE}
          onChange={setTeamPage}
          label="Pagination membres équipe"
        />
      </section>

      {/* ── Invitations ── */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <div>
            <p className={styles.sectionEyebrow}>En attente</p>
            <h2 className={styles.sectionTitle}>
              Invitations <span className={styles.count}>
                {String(receivedCount + sentCount).padStart(2, '0')}
              </span>
            </h2>
          </div>
        </header>

        <div className={styles.invTabs} role="tablist">
          <button
            type="button"
            className={`${styles.invTab} ${invTab === 'received' ? styles.invTabActive : ''}`}
            onClick={() => setInvTab('received')}
          >
            Reçues <span className={styles.invTabCount}>{String(receivedCount).padStart(2, '0')}</span>
          </button>
          <button
            type="button"
            className={`${styles.invTab} ${invTab === 'sent' ? styles.invTabActive : ''}`}
            onClick={() => setInvTab('sent')}
          >
            Envoyées <span className={styles.invTabCount}>{String(sentCount).padStart(2, '0')}</span>
          </button>
        </div>

        <div className={styles.invitations}>
          {visibleInvitations.length === 0 && (
            <p className={styles.invitationsEmpty}>Aucune invitation en attente</p>
          )}
          {visibleInvitations.map((inv) => (
            <InvitationCard
              key={inv.pseudo}
              inv={inv}
              onAccept={() => handleAccept(inv)}
              onRefuse={() => handleRefuse(inv)}
              onCancel={() => handleCancel(inv)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
