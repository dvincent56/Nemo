'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { readClientSession } from '@/lib/access';
import {
  fetchCities, fetchCountries, fetchSubdivisions,
  type City, type Country, type Subdivision,
} from '@/lib/places';
import {
  updateAccount, updateIdentity, updateNotifications, updatePreferences,
  type AccountPatch, type IdentityPatch, type NotificationsPatch, type PreferencesPatch,
} from './api';
import styles from './page.module.css';

const CURRENT_TEAM = 'La Rochelle Racing';

type SavedKey = 'identite' | 'compte' | 'preferences' | 'notifications';

function useSavedFlash(): [SavedKey | null, (k: SavedKey) => void] {
  const [saved, setSaved] = useState<SavedKey | null>(null);
  const flash = (k: SavedKey): void => {
    setSaved(k);
    setTimeout(() => setSaved((curr) => (curr === k ? null : curr)), 2400);
  };
  return [saved, flash];
}

type SectionId = 'identite' | 'compte' | 'preferences' | 'notifications' | 'danger';

const SECTIONS: ReadonlyArray<{ id: SectionId; num: string; label: string; danger?: boolean }> = [
  { id: 'identite',      num: '01', label: 'Identité publique' },
  { id: 'compte',        num: '02', label: 'Compte' },
  { id: 'preferences',   num: '03', label: 'Préférences' },
  { id: 'notifications', num: '04', label: 'Notifications' },
  { id: 'danger',        num: '05', label: 'Zone sensible', danger: true },
];

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const aKeys = Object.keys(a) as Array<keyof T>;
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => Object.is(a[k], b[k]));
}

interface ToggleRowProps {
  title: string;
  desc: string;
  children: React.ReactNode;
}
function ToggleRow({ title, desc, children }: ToggleRowProps): React.ReactElement {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <p className={styles.toggleTitle}>{title}</p>
        <p className={styles.toggleDesc}>{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}): React.ReactElement {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? styles.segOn : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.ReactElement {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className={styles.toggleSlider} />
    </label>
  );
}

// ── Valeurs initiales des 4 sections. Seront chargées depuis
//    l'API `/api/v1/me/*` en Phase 4 ; pour l'instant seed local.
const INITIAL_IDENTITY: IdentityPatch = {
  pseudo: 'Skipper',
  country: 'FR',
  dpt: '17',
  city: 'La Rochelle',
  tagline: "Je n'ai jamais autant appris à perdre que depuis ce circuit.",
};

const INITIAL_ACCOUNT: AccountPatch = {
  email: '',
  passwordOld: '',
  passwordNew: '',
};

const INITIAL_PREFERENCES: PreferencesPatch = {
  speedUnit: 'kts',
  distanceUnit: 'NM',
  timeFormat: '24',
  language: 'fr',
};

const INITIAL_NOTIFICATIONS: NotificationsPatch = {
  start: true,
  gate: false,
  podium: true,
  newRaces: true,
  weekly: false,
};

export default function SettingsView(): React.ReactElement {
  const [activeSection, setActiveSection] = useState<SectionId>('identite');
  const [saved, flashSaved] = useSavedFlash();
  const [pending, setPending] = useState<SavedKey | null>(null);

  // Identité — tracks initial pour détection de modif
  const [identity, setIdentity] = useState<IdentityPatch>(INITIAL_IDENTITY);
  const [identityBase, setIdentityBase] = useState<IdentityPatch>(INITIAL_IDENTITY);
  const identityDirty = !shallowEqual(identity, identityBase);

  // Compte — dirty si l'email a réellement changé (non vide) OU si le
  // couple mot-de-passe-actuel + nouveau mot-de-passe est rempli. Évite
  // le faux positif lié à l'auto-remplissage navigateur sur le champ email.
  const [account, setAccount] = useState<AccountPatch>(INITIAL_ACCOUNT);
  const [accountBase, setAccountBase] = useState<AccountPatch>(INITIAL_ACCOUNT);
  const emailChanged =
    (account.email ?? '').trim() !== ''
    && (account.email ?? '') !== (accountBase.email ?? '');
  const passwordProvided =
    (account.passwordOld ?? '') !== ''
    && (account.passwordNew ?? '') !== '';
  const accountDirty = emailChanged || passwordProvided;

  // Préférences
  const [preferences, setPreferences] = useState<PreferencesPatch>(INITIAL_PREFERENCES);
  const [preferencesBase, setPreferencesBase] = useState<PreferencesPatch>(INITIAL_PREFERENCES);
  const preferencesDirty = !shallowEqual(preferences, preferencesBase);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationsPatch>(INITIAL_NOTIFICATIONS);
  const [notificationsBase, setNotificationsBase] = useState<NotificationsPatch>(INITIAL_NOTIFICATIONS);
  const notificationsDirty = !shallowEqual(notifications, notificationsBase);

  // Hydrate le pseudo depuis la session côté client. Aligne aussi la
  // valeur "de base" pour que le champ ne soit pas marqué dirty tout seul.
  useEffect(() => {
    const s = readClientSession();
    if (s.username) {
      setIdentity((p) => ({ ...p, pseudo: s.username! }));
      setIdentityBase((p) => ({ ...p, pseudo: s.username! }));
    }
  }, []);

  // Scroll spy : active la section visible dans le sidenav
  useEffect(() => {
    const onScroll = (): void => {
      for (const s of [...SECTIONS].reverse()) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top < 120) {
          setActiveSection(s.id);
          return;
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Cascade Pays → Subdivision → Ville ──
  // Chaque liste est alimentée par un fetch vers /api/v1/places/* ; les
  // données brutes (Etalab + country-state-city) restent côté serveur.
  const [countries, setCountries] = useState<Country[]>([]);
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loadingSubdivisions, setLoadingSubdivisions] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  // 1. Liste des pays au montage
  useEffect(() => {
    fetchCountries().then(setCountries).catch(() => setCountries([]));
  }, []);

  // 2. Subdivisions quand le pays change. Si le dpt courant n'existe pas
  //    dans la nouvelle liste, on retombe sur le premier.
  useEffect(() => {
    let cancelled = false;
    setLoadingSubdivisions(true);
    fetchSubdivisions(identity.country)
      .then((list) => {
        if (cancelled) return;
        setSubdivisions(list);
        setIdentity((prev) => {
          if (list.some((s) => s.code === prev.dpt)) return prev;
          return { ...prev, dpt: list[0]?.code ?? '', city: '' };
        });
      })
      .catch(() => { if (!cancelled) setSubdivisions([]); })
      .finally(() => { if (!cancelled) setLoadingSubdivisions(false); });
    return () => { cancelled = true; };
  }, [identity.country]);

  // 3. Villes quand le dpt change. Même logique de retombée pour city.
  useEffect(() => {
    if (!identity.dpt) { setCities([]); return; }
    let cancelled = false;
    setLoadingCities(true);
    fetchCities(identity.country, identity.dpt)
      .then((list) => {
        if (cancelled) return;
        setCities(list);
        setIdentity((prev) => {
          if (list.some((c) => c.name === prev.city)) return prev;
          return { ...prev, city: list[0]?.name ?? '' };
        });
      })
      .catch(() => { if (!cancelled) setCities([]); })
      .finally(() => { if (!cancelled) setLoadingCities(false); });
    return () => { cancelled = true; };
  }, [identity.country, identity.dpt]);

  function selectCountry(newCountry: string): void {
    // Le useEffect [identity.country] remplira les subdivisions + réalignera dpt/city.
    setIdentity((prev) => ({ ...prev, country: newCountry }));
  }

  function selectSubdivision(newDpt: string): void {
    setIdentity((prev) => ({ ...prev, dpt: newDpt }));
  }

  // Handlers de sauvegarde — appels API stubs + mise à jour de la base
  async function saveIdentity(): Promise<void> {
    setPending('identite');
    try {
      await updateIdentity(identity);
      setIdentityBase(identity);
      flashSaved('identite');
    } finally {
      setPending(null);
    }
  }
  async function saveAccount(): Promise<void> {
    setPending('compte');
    try {
      await updateAccount(account);
      // Reset des champs mot de passe après sauvegarde réussie
      const cleared: AccountPatch = {
        email: account.email ?? '',
        passwordOld: '',
        passwordNew: '',
      };
      setAccount(cleared);
      setAccountBase(cleared);
      flashSaved('compte');
    } finally {
      setPending(null);
    }
  }
  async function savePreferences(): Promise<void> {
    setPending('preferences');
    try {
      await updatePreferences(preferences);
      setPreferencesBase(preferences);
      flashSaved('preferences');
    } finally {
      setPending(null);
    }
  }
  async function saveNotifications(): Promise<void> {
    setPending('notifications');
    try {
      await updateNotifications(notifications);
      setNotificationsBase(notifications);
      flashSaved('notifications');
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>Paramètres</h1>
        <p className={styles.sub}>
          Gère ton identité publique, ton compte, tes préférences de jeu et les notifications.
        </p>
      </header>

      <main className={styles.layout}>
        <aside className={styles.sidenav} aria-label="Sections">
          {SECTIONS.map((s) => {
            const cls = [
              styles.sidenavLink,
              s.id === activeSection ? styles.sidenavLinkActive : '',
              s.danger ? styles.sidenavDanger : '',
            ].filter(Boolean).join(' ');
            return (
              <a key={s.id} href={`#${s.id}`} className={cls}>
                <span>{s.label}</span>
                <span className={styles.sidenavNum}>{s.num}</span>
              </a>
            );
          })}
        </aside>

        <section className={styles.sections}>
          {/* 01 — Identité publique */}
          <article className={styles.card} id="identite">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>01</span>
              <h2 className={styles.cardTitle}>Identité publique</h2>
            </header>
            <p className={styles.cardAside}>
              Ces informations sont visibles par les autres skippers dans le classement,
              l'historique des courses et sur ta page profil.
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pseudo">Pseudo</label>
              <input
                id="pseudo" className={styles.fieldInput}
                value={identity.pseudo}
                onChange={(e) => setIdentity((p) => ({ ...p, pseudo: e.target.value }))}
                maxLength={24}
              />
              <p className={styles.fieldHint}>
                Entre 3 et 24 caractères. Lettres, chiffres, tirets et underscores.
              </p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pays">Pays</label>
                <select id="pays" className={styles.fieldSelect}
                        value={identity.country}
                        onChange={(e) => selectCountry(e.target.value)}
                        disabled={countries.length === 0}>
                  {countries.length === 0 && <option value={identity.country}>Chargement…</option>}
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="dpt">
                  {identity.country === 'FR' ? 'Département' : 'Région / État'}
                </label>
                <select id="dpt" className={styles.fieldSelect}
                        value={identity.dpt}
                        onChange={(e) => selectSubdivision(e.target.value)}
                        disabled={loadingSubdivisions || subdivisions.length === 0}>
                  {loadingSubdivisions && <option value={identity.dpt}>Chargement…</option>}
                  {!loadingSubdivisions && subdivisions.length === 0 && (
                    <option value="">Aucune subdivision disponible</option>
                  )}
                  {subdivisions.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="ville">Ville</label>
                <select id="ville" className={styles.fieldSelect}
                        value={identity.city}
                        onChange={(e) => setIdentity((p) => ({ ...p, city: e.target.value }))}
                        disabled={loadingCities || cities.length === 0}>
                  {loadingCities && <option value={identity.city}>Chargement…</option>}
                  {!loadingCities && cities.length === 0 && (
                    <option value="">Aucune commune trouvée</option>
                  )}
                  {cities.map((c) => (
                    <option key={c.code} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <p className={styles.fieldHint}>
                  {identity.country === 'FR'
                    ? `${cities.length.toLocaleString('fr-FR')} communes INSEE — tri par population`
                    : 'Source : subdivisions ISO 3166-2'}
                </p>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Équipe</span>
              <div className={styles.teamReadonly}>
                <p className={styles.teamReadonlyName}>{CURRENT_TEAM}</p>
                <Link
                  href={'/profile/social' as Parameters<typeof Link>[0]['href']}
                  className={styles.teamManageLink}
                >
                  Gérer dans Social →
                </Link>
              </div>
              <p className={styles.fieldHint}>
                La création, l'invitation et la gestion d'équipe se font sur la page Social.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="devise">
                Devise sur ton profil (optionnel)
              </label>
              <textarea id="devise" className={styles.fieldTextarea}
                        value={identity.tagline}
                        onChange={(e) => setIdentity((p) => ({ ...p, tagline: e.target.value }))}
                        maxLength={120}
                        placeholder="Une phrase d'accroche visible sur ta page profil." />
              <p className={styles.fieldHint}>
                120 caractères max. Laisse vide pour masquer la section sur ton profil.
              </p>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'identite' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button
                variant="primary"
                onClick={saveIdentity}
                disabled={!identityDirty || pending === 'identite'}
              >
                {pending === 'identite' ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </article>

          {/* 02 — Compte */}
          <article className={styles.card} id="compte">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>02</span>
              <h2 className={styles.cardTitle}>Compte</h2>
            </header>
            <p className={styles.cardAside}>
              Adresse email utilisée pour la connexion et mot de passe.
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="email">Adresse email</label>
              <input id="email" className={styles.fieldInput} type="email"
                     value={account.email ?? ''}
                     onChange={(e) => setAccount((p) => ({ ...p, email: e.target.value }))}
                     placeholder="votre@email.fr" />
              <p className={styles.fieldHint}>
                Un lien de confirmation est envoyé à chaque changement.
              </p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-old">Mot de passe actuel</label>
                <input id="pwd-old" className={styles.fieldInput} type="password"
                       value={account.passwordOld ?? ''}
                       onChange={(e) => setAccount((p) => ({ ...p, passwordOld: e.target.value }))}
                       placeholder="••••••••" autoComplete="current-password" />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-new">Nouveau mot de passe</label>
                <input id="pwd-new" className={styles.fieldInput} type="password"
                       value={account.passwordNew ?? ''}
                       onChange={(e) => setAccount((p) => ({ ...p, passwordNew: e.target.value }))}
                       placeholder="••••••••" autoComplete="new-password" />
              </div>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'compte' && <span className={styles.savedFlash}>✓ Mis à jour</span>}
              <Button
                variant="primary"
                onClick={saveAccount}
                disabled={!accountDirty || pending === 'compte'}
              >
                {pending === 'compte' ? 'Mise à jour…' : 'Mettre à jour'}
              </Button>
            </div>
          </article>

          {/* 03 — Préférences */}
          <article className={styles.card} id="preferences">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>03</span>
              <h2 className={styles.cardTitle}>Préférences de jeu</h2>
            </header>
            <p className={styles.cardAside}>
              Unités, format d'affichage et langue de l'interface.
            </p>

            <ToggleRow title="Unité de vitesse"
                       desc="Utilisée sur le HUD, la boussole et les polaires.">
              <Segmented
                value={preferences.speedUnit}
                onChange={(v) => setPreferences((p) => ({ ...p, speedUnit: v }))}
                label="Unité de vitesse"
                options={[{value:'kts',label:'Nœuds'},{value:'kmh',label:'km/h'},{value:'mph',label:'mph'}]} />
            </ToggleRow>

            <ToggleRow title="Unité de distance"
                       desc="Utilisée pour DTF, tracés, statistiques.">
              <Segmented
                value={preferences.distanceUnit}
                onChange={(v) => setPreferences((p) => ({ ...p, distanceUnit: v }))}
                label="Unité de distance"
                options={[{value:'NM',label:'NM'},{value:'km',label:'km'},{value:'mi',label:'mi'}]} />
            </ToggleRow>

            <ToggleRow title="Format d'heure"
                       desc="Utilisé partout sur l'interface.">
              <Segmented
                value={preferences.timeFormat}
                onChange={(v) => setPreferences((p) => ({ ...p, timeFormat: v }))}
                label="Format d'heure"
                options={[{value:'24',label:'24 h'},{value:'12',label:'12 h (am/pm)'}]} />
            </ToggleRow>

            <ToggleRow title="Langue de l'interface"
                       desc="Texte du menu, des pages et des notifications.">
              <Segmented
                value={preferences.language}
                onChange={(v) => setPreferences((p) => ({ ...p, language: v }))}
                label="Langue"
                options={[{value:'fr',label:'FR'},{value:'en',label:'EN'},{value:'es',label:'ES'},{value:'de',label:'DE'}]} />
            </ToggleRow>

            <div className={styles.cardFoot}>
              {saved === 'preferences' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button
                variant="primary"
                onClick={savePreferences}
                disabled={!preferencesDirty || pending === 'preferences'}
              >
                {pending === 'preferences' ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </article>

          {/* 04 — Notifications */}
          <article className={styles.card} id="notifications">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>04</span>
              <h2 className={styles.cardTitle}>Notifications</h2>
            </header>
            <p className={styles.cardAside}>
              Canal email. Les notifications in-app sont toujours actives pendant une course.
            </p>

            <ToggleRow title="Départ imminent (H−1 h)"
                       desc="Rappel une heure avant le départ d'une course à laquelle tu es inscrit.">
              <Toggle
                checked={notifications.start}
                onChange={(v) => setNotifications((p) => ({ ...p, start: v }))}
                label="Départ imminent" />
            </ToggleRow>
            <ToggleRow title="Passage de porte / waypoint"
                       desc="Email à chaque franchissement d'une porte obligatoire.">
              <Toggle
                checked={notifications.gate}
                onChange={(v) => setNotifications((p) => ({ ...p, gate: v }))}
                label="Passage de porte" />
            </ToggleRow>
            <ToggleRow title="Podium amis / équipe"
                       desc="Un skipper que tu suis termine dans le top 3 d'une course.">
              <Toggle
                checked={notifications.podium}
                onChange={(v) => setNotifications((p) => ({ ...p, podium: v }))}
                label="Podium amis" />
            </ToggleRow>
            <ToggleRow title="Nouvelles courses ouvertes"
                       desc="Annonce des nouvelles dates de course dans les classes que tu possèdes.">
              <Toggle
                checked={notifications.newRaces}
                onChange={(v) => setNotifications((p) => ({ ...p, newRaces: v }))}
                label="Nouvelles courses" />
            </ToggleRow>
            <ToggleRow title="Résumé hebdomadaire"
                       desc="Email chaque lundi avec tes résultats et l'actualité du circuit.">
              <Toggle
                checked={notifications.weekly}
                onChange={(v) => setNotifications((p) => ({ ...p, weekly: v }))}
                label="Résumé hebdomadaire" />
            </ToggleRow>

            <div className={styles.cardFoot}>
              {saved === 'notifications' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button
                variant="primary"
                onClick={saveNotifications}
                disabled={!notificationsDirty || pending === 'notifications'}
              >
                {pending === 'notifications' ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </article>

          {/* 05 — Danger zone */}
          <article className={`${styles.card} ${styles.cardDanger}`} id="danger">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>05</span>
              <h2 className={styles.cardTitle}>Zone sensible</h2>
            </header>
            <p className={styles.cardAside}>Actions irréversibles. Lis bien avant d'agir.</p>

            <ToggleRow title="Se déconnecter de tous les appareils"
                       desc="Termine toutes les sessions actives (web, mobile). Tu devras te reconnecter partout.">
              <Button variant="danger">Déconnecter tout</Button>
            </ToggleRow>
            <ToggleRow title="Exporter mes données"
                       desc="Archive ZIP avec ton historique de courses, ta flotte et tes paramètres. RGPD.">
              <Button variant="secondary">Demander l'export</Button>
            </ToggleRow>
            <ToggleRow title="Supprimer mon compte"
                       desc="Suppression définitive de ton skipper, ta flotte et ton historique. Aucun retour possible.">
              <Button variant="dangerSolid">Supprimer mon compte</Button>
            </ToggleRow>
          </article>

        </section>
      </main>
    </>
  );
}
