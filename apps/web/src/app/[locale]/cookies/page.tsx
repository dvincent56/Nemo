import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageCookies.meta');
  return { title: t('title'), description: t('description') };
}

// NB : les bodies des sections restent en JSX FR inline. Le texte juridique
// nécessite une traduction par juriste local — sera externalisé en messages
// JSON / MDX par locale dans une vague de "vraie traduction" ultérieure.

export default async function CookiesPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageCookies');

  const sections: LegalSection[] = [
    {
      id: 'definition',
      num: '01',
      title: t('sections.definition'),
      body: (
        <>
          <p>
            Un cookie est un petit fichier texte stocké par ton navigateur lorsque tu visites un site web. Il
            permet au site de te reconnaître lors de tes visites suivantes, de mémoriser tes préférences et
            parfois d'analyser ton usage.
          </p>
          <p>
            Nemo utilise <strong>uniquement des cookies strictement nécessaires</strong> au fonctionnement du
            service. Nous n'utilisons aucun cookie publicitaire, aucun cookie de tracking tiers, et nous ne
            vendons aucune donnée à des régies publicitaires.
          </p>
        </>
      ),
    },
    {
      id: 'liste',
      num: '02',
      title: t('sections.liste'),
      body: (
        <>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Finalité</th>
                <th>Durée</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>nemo_access_token</code></td>
                <td>Jeton d'authentification de session (obligatoire pour jouer)</td>
                <td>1 heure, renouvelé à chaque connexion</td>
                <td>Nécessaire</td>
              </tr>
              <tr>
                <td><code>NEMO_LOCALE</code></td>
                <td>Mémorise la langue d'affichage choisie (français, anglais, espagnol, allemand)</td>
                <td>1 an, renouvelé à chaque changement de langue</td>
                <td>Fonctionnel</td>
              </tr>
            </tbody>
          </table>
          <p>
            Ce cookie est strictement nécessaire au fonctionnement du service. Conformément à la
            législation française, il ne requiert pas de consentement préalable.
          </p>
          <p>
            Cette liste sera mise à jour au fur et à mesure de l'arrivée des fonctionnalités (jeton
            anti-CSRF pour les actions sensibles, mémorisation des préférences d'affichage, protection
            anti-bots Cloudflare). Toute évolution sera annoncée selon la procédure décrite à
            l'article 05.
          </p>
        </>
      ),
    },
    {
      id: 'pas-de-tracking',
      num: '03',
      title: t('sections.pas-de-tracking'),
      body: (
        <>
          <ul>
            <li>Aucun cookie publicitaire (Google Ads, Meta Pixel, etc.)</li>
            <li>Aucun traceur tiers à des fins marketing</li>
            <li>Aucun partage de données comportementales à des régies</li>
            <li>Aucune empreinte de navigateur (<em>fingerprinting</em>)</li>
            <li>Aucun pixel invisible dans les emails transactionnels</li>
          </ul>
          <p>
            Les analytics internes (temps de session, taux de complétion des courses) sont agrégés côté
            serveur sans cookie ni identifiant persistant associé à ton compte.
          </p>
        </>
      ),
    },
    {
      id: 'gestion',
      num: '04',
      title: t('sections.gestion'),
      body: (
        <>
          <p>
            Tu peux à tout moment supprimer ou bloquer les cookies via les paramètres de ton navigateur.
            <strong> Attention&nbsp;:</strong> bloquer les cookies strictement nécessaires empêche la
            connexion au compte et rend le service inutilisable.
          </p>
          <p>Documentation constructeur&nbsp;:</p>
          <ul>
            <li><a href="https://support.mozilla.org/fr/kb/effacer-cookies-donnees-sites-firefox">Firefox</a></li>
            <li><a href="https://support.google.com/chrome/answer/95647">Chrome</a></li>
            <li><a href="https://support.apple.com/fr-fr/guide/safari/sfri11471/mac">Safari</a></li>
            <li><a href="https://support.microsoft.com/fr-fr/microsoft-edge/supprimer-les-cookies-dans-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09">Edge</a></li>
          </ul>
        </>
      ),
    },
    {
      id: 'evolution',
      num: '05',
      title: t('sections.evolution'),
      body: (
        <>
          <p>
            Si Nemo venait à introduire un cookie analytique soumis à consentement (par exemple pour mesurer
            la performance d'un nouveau mode), un bandeau de consentement explicite serait déployé, conforme
            aux recommandations de la CNIL. Aucun cookie non nécessaire ne sera déposé sans ton accord clair
            et préalable.
          </p>
          <p>
            Les évolutions de cette politique seront communiquées par email aux utilisateurs actifs et
            signalées en haut de cette page avec un préavis de 15 jours.
          </p>
        </>
      ),
    },
  ];

  return (
    <SiteShell>
      <LegalLayout
        eyebrow={t('eyebrow')}
        trailing={t('trailing')}
        title={t('title')}
        intro={t('intro')}
        lastUpdated={t('lastUpdated')}
        sections={sections}
      />
    </SiteShell>
  );
}
