'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { readClientSession } from '@/lib/access';
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

export default function SettingsView(): React.ReactElement {
  const [activeSection, setActiveSection] = useState<SectionId>('identite');
  const [pseudo, setPseudo] = useState('Skipper');
  const [country, setCountry] = useState('France');
  const [city, setCity] = useState('La Rochelle (17)');
  const [tagline, setTagline] = useState("Je n'ai jamais autant appris à perdre que depuis ce circuit.");
  const [saved, flashSaved] = useSavedFlash();

  const [email, setEmail] = useState('');
  const [pwdOld, setPwdOld] = useState('');
  const [pwdNew, setPwdNew] = useState('');

  const [speedUnit, setSpeedUnit] = useState<'kts' | 'kmh' | 'mph'>('kts');
  const [distUnit, setDistUnit] = useState<'NM' | 'km' | 'mi'>('NM');
  const [timeFmt, setTimeFmt] = useState<'24' | '12'>('24');
  const [lang, setLang] = useState<'fr' | 'en' | 'es' | 'de'>('fr');

  const [notifStart, setNotifStart] = useState(true);
  const [notifGate, setNotifGate] = useState(false);
  const [notifPodium, setNotifPodium] = useState(true);
  const [notifNewRaces, setNotifNewRaces] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(false);

  // Hydrate les valeurs depuis la session côté client
  useEffect(() => {
    const s = readClientSession();
    if (s.username) setPseudo(s.username);
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
                value={pseudo} onChange={(e) => setPseudo(e.target.value)}
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
                        value={country} onChange={(e) => setCountry(e.target.value)}>
                  {['France', 'Belgique', 'Suisse', 'Royaume-Uni', 'Pays-Bas', 'Italie',
                    'Allemagne', 'Espagne', 'Portugal'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="ville">Ville</label>
                <select id="ville" className={styles.fieldSelect}
                        value={city} onChange={(e) => setCity(e.target.value)}>
                  {['La Rochelle (17)', 'La Trinité-sur-Mer (56)', 'Lorient (56)', 'Brest (29)',
                    'Saint-Malo (35)', 'Marseille (13)', 'Nice (06)',
                    "Les Sables-d'Olonne (85)"].map((c) => <option key={c}>{c}</option>)}
                </select>
                <p className={styles.fieldHint}>Recherche par nom ou code postal.</p>
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
                        value={tagline} onChange={(e) => setTagline(e.target.value)}
                        maxLength={120}
                        placeholder="Une phrase d'accroche visible sur ta page profil." />
              <p className={styles.fieldHint}>
                120 caractères max. Laisse vide pour masquer la section sur ton profil.
              </p>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'identite' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button variant="secondary">Annuler</Button>
              <Button variant="primary" onClick={() => flashSaved('identite')}>Enregistrer</Button>
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
                     value={email} onChange={(e) => setEmail(e.target.value)}
                     placeholder="votre@email.fr" />
              <p className={styles.fieldHint}>
                Un lien de confirmation est envoyé à chaque changement.
              </p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-old">Mot de passe actuel</label>
                <input id="pwd-old" className={styles.fieldInput} type="password"
                       value={pwdOld} onChange={(e) => setPwdOld(e.target.value)}
                       placeholder="••••••••" autoComplete="current-password" />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pwd-new">Nouveau mot de passe</label>
                <input id="pwd-new" className={styles.fieldInput} type="password"
                       value={pwdNew} onChange={(e) => setPwdNew(e.target.value)}
                       placeholder="••••••••" autoComplete="new-password" />
              </div>
            </div>

            <div className={styles.cardFoot}>
              {saved === 'compte' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button variant="secondary">Annuler</Button>
              <Button variant="primary" onClick={() => flashSaved('compte')}>Mettre à jour</Button>
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
              <Segmented value={speedUnit} onChange={setSpeedUnit} label="Unité de vitesse"
                         options={[{value:'kts',label:'Nœuds'},{value:'kmh',label:'km/h'},{value:'mph',label:'mph'}]} />
            </ToggleRow>

            <ToggleRow title="Unité de distance"
                       desc="Utilisée pour DTF, tracés, statistiques.">
              <Segmented value={distUnit} onChange={setDistUnit} label="Unité de distance"
                         options={[{value:'NM',label:'NM'},{value:'km',label:'km'},{value:'mi',label:'mi'}]} />
            </ToggleRow>

            <ToggleRow title="Format d'heure"
                       desc="Utilisé partout sur l'interface.">
              <Segmented value={timeFmt} onChange={setTimeFmt} label="Format d'heure"
                         options={[{value:'24',label:'24 h'},{value:'12',label:'12 h (am/pm)'}]} />
            </ToggleRow>

            <ToggleRow title="Langue de l'interface"
                       desc="Texte du menu, des pages et des notifications.">
              <Segmented value={lang} onChange={setLang} label="Langue"
                         options={[{value:'fr',label:'FR'},{value:'en',label:'EN'},{value:'es',label:'ES'},{value:'de',label:'DE'}]} />
            </ToggleRow>

            <div className={styles.cardFoot}>
              {saved === 'preferences' && <span className={styles.savedFlash}>✓ Enregistré</span>}
              <Button variant="primary" onClick={() => flashSaved('preferences')}>Enregistrer</Button>
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
              <Toggle checked={notifStart} onChange={setNotifStart} label="Départ imminent" />
            </ToggleRow>
            <ToggleRow title="Passage de porte / waypoint"
                       desc="Email à chaque franchissement d'une porte obligatoire.">
              <Toggle checked={notifGate} onChange={setNotifGate} label="Passage de porte" />
            </ToggleRow>
            <ToggleRow title="Podium amis / équipe"
                       desc="Un skipper que tu suis termine dans le top 3 d'une course.">
              <Toggle checked={notifPodium} onChange={setNotifPodium} label="Podium amis" />
            </ToggleRow>
            <ToggleRow title="Nouvelles courses ouvertes"
                       desc="Annonce des nouvelles dates de course dans les classes que tu possèdes.">
              <Toggle checked={notifNewRaces} onChange={setNotifNewRaces} label="Nouvelles courses" />
            </ToggleRow>
            <ToggleRow title="Résumé hebdomadaire"
                       desc="Email chaque lundi avec tes résultats et l'actualité du circuit.">
              <Toggle checked={notifWeekly} onChange={setNotifWeekly} label="Résumé hebdomadaire" />
            </ToggleRow>

            <div className={styles.cardFoot}>
              <Button variant="primary" disabled>Enregistrer</Button>
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
