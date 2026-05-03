'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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

const SECTION_DEFS: ReadonlyArray<{ id: SectionId; num: string; danger?: boolean }> = [
  { id: 'identite',      num: '01' },
  { id: 'compte',        num: '02' },
  { id: 'preferences',   num: '03' },
  { id: 'notifications', num: '04' },
  { id: 'danger',        num: '05', danger: true },
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

// Valeurs initiales des 4 sections. Seront chargées depuis
// l'API `/api/v1/me/*` en Phase 4 ; pour l'instant seed local.
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
  const t = useTranslations('profile.settings');
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

  // Hydrate le pseudo depuis la session côté client.
  useEffect(() => {
    const s = readClientSession();
    if (s.username) {
      setIdentity((p) => ({ ...p, pseudo: s.username! }));
      setIdentityBase((p) => ({ ...p, pseudo: s.username! }));
    }
  }, []);

  // Scroll spy : active la section visible dans le sidenav.
  useEffect(() => {
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) {
          let bestId: SectionId | null = null;
          let bestTop = Infinity;
          visible.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const top = el.getBoundingClientRect().top;
            if (top < bestTop) { bestTop = top; bestId = id as SectionId; }
          });
          if (bestId !== null) setActiveSection(bestId);
          return;
        }
        const firstEl = document.getElementById(SECTION_DEFS[0]!.id);
        if (firstEl && firstEl.getBoundingClientRect().top > 0) {
          setActiveSection(SECTION_DEFS[0]!.id);
        } else {
          setActiveSection(SECTION_DEFS[SECTION_DEFS.length - 1]!.id);
        }
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: 0 },
    );
    for (const s of SECTION_DEFS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  // Cascade Pays → Subdivision → Ville
  const [countries, setCountries] = useState<Country[]>([]);
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loadingSubdivisions, setLoadingSubdivisions] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  useEffect(() => {
    fetchCountries().then(setCountries).catch(() => setCountries([]));
  }, []);

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
    setIdentity((prev) => ({ ...prev, country: newCountry }));
  }

  function selectSubdivision(newDpt: string): void {
    setIdentity((prev) => ({ ...prev, dpt: newDpt }));
  }

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
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.sub}>{t('sub')}</p>
      </header>

      <main className={styles.layout}>
        <aside className={styles.sidenav} aria-label={t('ariaSections')}>
          {SECTION_DEFS.map((s) => {
            const cls = [
              styles.sidenavLink,
              s.id === activeSection ? styles.sidenavLinkActive : '',
              s.danger ? styles.sidenavDanger : '',
            ].filter(Boolean).join(' ');
            return (
              <a key={s.id} href={`#${s.id}`} className={cls}>
                <span>{t(`sections.${s.id}`)}</span>
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
              <h2 className={styles.cardTitle}>{t('identity.title')}</h2>
            </header>
            <p className={styles.cardAside}>{t('identity.aside')}</p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pseudo">{t('identity.pseudoLabel')}</label>
              <input
                id="pseudo" className={styles.fieldInput}
                value={identity.pseudo}
                onChange={(e) => setIdentity((p) => ({ ...p, pseudo: e.target.value }))}
                maxLength={24}
              />
              <p className={styles.fieldHint}>{t('identity.pseudoHint')}</p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pays">{t('identity.countryLabel')}</label>
                <select id="pays" className={styles.fieldSelect}
                        value={identity.country}
                        onChange={(e) => selectCountry(e.target.value)}
                        disabled={countries.length === 0}>
                  {countries.length === 0 && <option value={identity.country}>{t('identity.loading')}</option>}
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="dpt">
                  {identity.country === 'FR' ? t('identity.subdivisionLabelFR') : t('identity.subdivisionLabelOther')}
                </label>
                <select id="dpt" className={styles.fieldSelect}
                        value={identity.dpt}
                        onChange={(e) => selectSubdivision(e.target.value)}
                        disabled={loadingSubdivisions || subdivisions.length === 0}>
                  {loadingSubdivisions && <option value={identity.dpt}>{t('identity.loading')}</option>}
                  {!loadingSubdivisions && subdivisions.length === 0 && (
                    <option value="">{t('identity.noSubdivision')}</option>
                  )}
                  {subdivisions.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="ville">{t('identity.cityLabel')}</label>
                <select id="ville" className={styles.fieldSelect}
                        value={identity.city}
                        onChange={(e) => setIdentity((p) => ({ ...p, city: e.target.value }))}
                        disabled={loadingCities || cities.length === 0}>
                  {loadingCities && <option value={identity.city}>{t('identity.loading')}</option>}
                  {!loadingCities && cities.length === 0 && (
                    <option value="">{t('identity.noCity')}</option>
                  )}
                  {cities.map((c) => (
                    <option key={c.code} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <p className={styles.fieldHint}>
                  {identity.country === 'FR'
                    ? t('identity.cityHintFR', { n: cities.length.toLocaleString('fr-FR') })
                    : t('identity.cityHintOther')}
                </p>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('identity.teamLabel')}</span>
              <div className={styles.teamReadonly}>
                <p className={styles.teamReadonlyName}>{CURRENT_TEAM}</p>
                <Link
                  href={'/profile/social' as Parameters<typeof Link>[0]['href']}
                  className={styles.teamManageLink}
                >
                  {t('identity.manageInSocial')}
                </Link>
              </div>
              <p className={styles.fieldHint}>{t('identity.teamHint')}</p>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="devise">
                {t('identity.taglineLabel')}
              </label>
              <textarea id="devise" className={styles.fieldTextarea}
                        value={identity.tagline}
                        onChange={(e) => setIdentity((p) => ({ ...p, tagline: e.target.value }))}
                        maxLength={120}
                        placeholder={t('identity.taglinePlaceholder')} />
              <p className={styles.fieldHint}>{t('identity.taglineHint')}</p>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'identite' && <span className={styles.savedFlash}>{t('savedFlash.saved')}</span>}
              <Button
                variant="primary"
                onClick={saveIdentity}
                disabled={!identityDirty || pending === 'identite'}
              >
                {pending === 'identite' ? t('buttons.saving') : t('buttons.save')}
              </Button>
            </div>
          </article>

          {/* 02 — Compte */}
          <article className={styles.card} id="compte">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>02</span>
              <h2 className={styles.cardTitle}>{t('account.title')}</h2>
            </header>
            <p className={styles.cardAside}>{t('account.aside')}</p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="email">{t('account.emailLabel')}</label>
              <input id="email" className={styles.fieldInput} type="email"
                     value={account.email ?? ''}
                     onChange={(e) => setAccount((p) => ({ ...p, email: e.target.value }))}
                     placeholder={t('account.emailPlaceholder')} />
              <p className={styles.fieldHint}>{t('account.emailHint')}</p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-old">{t('account.passwordOldLabel')}</label>
                <input id="pwd-old" className={styles.fieldInput} type="password"
                       value={account.passwordOld ?? ''}
                       onChange={(e) => setAccount((p) => ({ ...p, passwordOld: e.target.value }))}
                       placeholder={t('account.passwordPlaceholder')} autoComplete="current-password" />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-new">{t('account.passwordNewLabel')}</label>
                <input id="pwd-new" className={styles.fieldInput} type="password"
                       value={account.passwordNew ?? ''}
                       onChange={(e) => setAccount((p) => ({ ...p, passwordNew: e.target.value }))}
                       placeholder={t('account.passwordPlaceholder')} autoComplete="new-password" />
              </div>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'compte' && <span className={styles.savedFlash}>{t('savedFlash.updated')}</span>}
              <Button
                variant="primary"
                onClick={saveAccount}
                disabled={!accountDirty || pending === 'compte'}
              >
                {pending === 'compte' ? t('buttons.updating') : t('buttons.update')}
              </Button>
            </div>
          </article>

          {/* 03 — Préférences */}
          <article className={styles.card} id="preferences">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>03</span>
              <h2 className={styles.cardTitle}>{t('preferences.title')}</h2>
            </header>
            <p className={styles.cardAside}>{t('preferences.aside')}</p>

            <ToggleRow title={t('preferences.speedTitle')} desc={t('preferences.speedDesc')}>
              <Segmented
                value={preferences.speedUnit}
                onChange={(v) => setPreferences((p) => ({ ...p, speedUnit: v }))}
                label={t('preferences.speedAria')}
                options={[
                  { value: 'kts', label: t('preferences.speedKts') },
                  { value: 'kmh', label: t('preferences.speedKmh') },
                  { value: 'mph', label: t('preferences.speedMph') },
                ]} />
            </ToggleRow>

            <ToggleRow title={t('preferences.distanceTitle')} desc={t('preferences.distanceDesc')}>
              <Segmented
                value={preferences.distanceUnit}
                onChange={(v) => setPreferences((p) => ({ ...p, distanceUnit: v }))}
                label={t('preferences.distanceAria')}
                options={[
                  { value: 'NM', label: t('preferences.distanceNM') },
                  { value: 'km', label: t('preferences.distanceKm') },
                  { value: 'mi', label: t('preferences.distanceMi') },
                ]} />
            </ToggleRow>

            <ToggleRow title={t('preferences.timeTitle')} desc={t('preferences.timeDesc')}>
              <Segmented
                value={preferences.timeFormat}
                onChange={(v) => setPreferences((p) => ({ ...p, timeFormat: v }))}
                label={t('preferences.timeAria')}
                options={[
                  { value: '24', label: t('preferences.time24') },
                  { value: '12', label: t('preferences.time12') },
                ]} />
            </ToggleRow>

            <ToggleRow title={t('preferences.languageTitle')} desc={t('preferences.languageDesc')}>
              <Segmented
                value={preferences.language}
                onChange={(v) => setPreferences((p) => ({ ...p, language: v }))}
                label={t('preferences.languageAria')}
                options={[
                  { value: 'fr', label: t('preferences.languageFR') },
                  { value: 'en', label: t('preferences.languageEN') },
                  { value: 'es', label: t('preferences.languageES') },
                  { value: 'de', label: t('preferences.languageDE') },
                ]} />
            </ToggleRow>

            <div className={styles.cardFoot}>
              {saved === 'preferences' && <span className={styles.savedFlash}>{t('savedFlash.saved')}</span>}
              <Button
                variant="primary"
                onClick={savePreferences}
                disabled={!preferencesDirty || pending === 'preferences'}
              >
                {pending === 'preferences' ? t('buttons.saving') : t('buttons.save')}
              </Button>
            </div>
          </article>

          {/* 04 — Notifications */}
          <article className={styles.card} id="notifications">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>04</span>
              <h2 className={styles.cardTitle}>{t('notifications.title')}</h2>
            </header>
            <p className={styles.cardAside}>{t('notifications.aside')}</p>

            <ToggleRow title={t('notifications.startTitle')} desc={t('notifications.startDesc')}>
              <Toggle
                checked={notifications.start}
                onChange={(v) => setNotifications((p) => ({ ...p, start: v }))}
                label={t('notifications.startAria')} />
            </ToggleRow>
            <ToggleRow title={t('notifications.gateTitle')} desc={t('notifications.gateDesc')}>
              <Toggle
                checked={notifications.gate}
                onChange={(v) => setNotifications((p) => ({ ...p, gate: v }))}
                label={t('notifications.gateAria')} />
            </ToggleRow>
            <ToggleRow title={t('notifications.podiumTitle')} desc={t('notifications.podiumDesc')}>
              <Toggle
                checked={notifications.podium}
                onChange={(v) => setNotifications((p) => ({ ...p, podium: v }))}
                label={t('notifications.podiumAria')} />
            </ToggleRow>
            <ToggleRow title={t('notifications.newRacesTitle')} desc={t('notifications.newRacesDesc')}>
              <Toggle
                checked={notifications.newRaces}
                onChange={(v) => setNotifications((p) => ({ ...p, newRaces: v }))}
                label={t('notifications.newRacesAria')} />
            </ToggleRow>
            <ToggleRow title={t('notifications.weeklyTitle')} desc={t('notifications.weeklyDesc')}>
              <Toggle
                checked={notifications.weekly}
                onChange={(v) => setNotifications((p) => ({ ...p, weekly: v }))}
                label={t('notifications.weeklyAria')} />
            </ToggleRow>

            <div className={styles.cardFoot}>
              {saved === 'notifications' && <span className={styles.savedFlash}>{t('savedFlash.saved')}</span>}
              <Button
                variant="primary"
                onClick={saveNotifications}
                disabled={!notificationsDirty || pending === 'notifications'}
              >
                {pending === 'notifications' ? t('buttons.saving') : t('buttons.save')}
              </Button>
            </div>
          </article>

          {/* 05 — Danger zone */}
          <article className={`${styles.card} ${styles.cardDanger}`} id="danger">
            <header className={styles.cardHead}>
              <span className={styles.cardNum}>05</span>
              <h2 className={styles.cardTitle}>{t('danger.title')}</h2>
            </header>
            <p className={styles.cardAside}>{t('danger.aside')}</p>

            <ToggleRow title={t('danger.logoutAllTitle')} desc={t('danger.logoutAllDesc')}>
              <Button variant="danger">{t('danger.logoutAllButton')}</Button>
            </ToggleRow>
            <ToggleRow title={t('danger.exportTitle')} desc={t('danger.exportDesc')}>
              <Button variant="secondary">{t('danger.exportButton')}</Button>
            </ToggleRow>
            <ToggleRow title={t('danger.deleteTitle')} desc={t('danger.deleteDesc')}>
              <Button variant="dangerSolid">{t('danger.deleteButton')}</Button>
            </ToggleRow>
          </article>

        </section>
      </main>
    </>
  );
}
