import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pagePrivacy.meta');
  return { title: t('title'), description: t('description') };
}

// NB : les bodies des sections restent en JSX FR inline. Le texte juridique
// nécessite une traduction par juriste local — sera externalisé en messages
// JSON / MDX par locale dans une vague de "vraie traduction" ultérieure.

export default async function PrivacyPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pagePrivacy');

  const sections: LegalSection[] = [
    {
      id: 'responsable',
      num: '01',
      title: t('sections.responsable'),
      body: (
        <>
          <p>
            Le responsable du traitement des données à caractère personnel est la société éditrice identifiée
            dans les <Link href="/legal">mentions légales</Link>.
          </p>
          <p>
            Pour toute question relative au traitement de tes données ou à l'exercice de tes droits, tu peux
            contacter notre délégué à la protection des données&nbsp;: <a href="mailto:dpo@nemo.sail">
            dpo@nemo.sail</a>.
          </p>
        </>
      ),
    },
    {
      id: 'donnees',
      num: '02',
      title: t('sections.donnees'),
      body: (
        <>
          <p>Nemo collecte uniquement les données strictement nécessaires au fonctionnement du service&nbsp;:</p>
          <dl>
            <dt>Compte</dt>
            <dd>Email, mot de passe hashé (bcrypt), pseudo, date d'inscription</dd>
            <dt>Profil</dt>
            <dd>Pays, département, ville, devise (optionnelle), équipe (optionnelle)</dd>
            <dt>Gameplay</dt>
            <dd>
              Historique des courses, positions GPS simulées, résultats, bateaux et upgrades de la flotte,
              crédits acquis
            </dd>
            <dt>Social</dt>
            <dd>Relations d'amitié, appartenance d'équipe, invitations envoyées et reçues</dd>
            <dt>Technique</dt>
            <dd>Adresse IP, user-agent, résolution d'écran, timezone — pour la détection de fraude et
            l'adaptation responsive</dd>
            <dt>Paiement (Mode Carrière)</dt>
            <dd>ID client Stripe uniquement. Les numéros de carte ne transitent <strong>jamais</strong> par
            nos serveurs</dd>
          </dl>
        </>
      ),
    },
    {
      id: 'finalites',
      num: '03',
      title: t('sections.finalites'),
      body: (
        <>
          <table>
            <thead>
              <tr>
                <th>Finalité</th>
                <th>Base légale</th>
                <th>Durée de conservation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Fourniture du service (authentification, gameplay, classement)</td>
                <td>Exécution du contrat</td>
                <td>Durée du compte + 12 mois après résiliation</td>
              </tr>
              <tr>
                <td>Facturation Mode Carrière</td>
                <td>Obligation légale (comptable)</td>
                <td>10 ans</td>
              </tr>
              <tr>
                <td>Détection de fraude et sécurité</td>
                <td>Intérêt légitime</td>
                <td>12 mois</td>
              </tr>
              <tr>
                <td>Statistiques d'usage agrégées</td>
                <td>Intérêt légitime</td>
                <td>Anonymisées, conservation indéfinie</td>
              </tr>
              <tr>
                <td>Newsletter et communication marketing</td>
                <td>Consentement (opt-in explicite)</td>
                <td>Jusqu'à retrait du consentement</td>
              </tr>
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'destinataires',
      num: '04',
      title: t('sections.destinataires'),
      body: (
        <>
          <p>
            Tes données ne sont <strong>jamais revendues</strong>. Elles sont accessibles uniquement aux
            équipes techniques de l'éditeur et aux sous-traitants suivants, strictement liés par contrat
            conforme au RGPD&nbsp;:
          </p>
          <dl>
            <dt>AWS (Amazon Web Services)</dt>
            <dd>Hébergement des serveurs de jeu et bases de données, région eu-west-3 (Paris)</dd>
            <dt>Cognito</dt>
            <dd>Authentification, gestion des mots de passe</dd>
            <dt>Stripe</dt>
            <dd>Traitement des paiements, abonnements Mode Carrière</dd>
            <dt>Cloudflare</dt>
            <dd>Protection anti-DDoS, CDN</dd>
            <dt>Sentry</dt>
            <dd>Collecte anonyme des erreurs applicatives pour debug</dd>
          </dl>
          <p>
            L'ensemble de ces sous-traitants héberge ou traite les données dans l'Union européenne. Aucun
            transfert hors UE n'est effectué sans ton consentement explicite.
          </p>
        </>
      ),
    },
    {
      id: 'droits',
      num: '05',
      title: t('sections.droits'),
      body: (
        <>
          <p>Conformément au RGPD et à la loi Informatique et Libertés, tu disposes des droits suivants&nbsp;:</p>
          <dl>
            <dt>Accès</dt>
            <dd>Obtenir une copie de tes données traitées</dd>
            <dt>Rectification</dt>
            <dd>Corriger des données inexactes depuis la page Paramètres, ou sur demande</dd>
            <dt>Effacement</dt>
            <dd>Supprimer ton compte et tes données (bouton Supprimer mon compte en Paramètres)</dd>
            <dt>Portabilité</dt>
            <dd>Recevoir tes données dans un format structuré (archive ZIP JSON) via le bouton
            «&nbsp;Demander l'export&nbsp;»</dd>
            <dt>Opposition</dt>
            <dd>T'opposer à un traitement fondé sur l'intérêt légitime</dd>
            <dt>Limitation</dt>
            <dd>Geler temporairement un traitement en cas de contestation</dd>
          </dl>
          <p>
            Pour exercer ces droits&nbsp;: <a href="mailto:dpo@nemo.sail">dpo@nemo.sail</a>. Nous répondons
            dans un délai d'un mois.
          </p>
          <p>
            Tu peux aussi introduire une réclamation auprès de la <a href="https://www.cnil.fr">CNIL</a> si
            tu estimes que le traitement de tes données enfreint le RGPD.
          </p>
        </>
      ),
    },
    {
      id: 'securite',
      num: '06',
      title: t('sections.securite'),
      body: (
        <>
          <p>
            Nous mettons en œuvre les mesures techniques et organisationnelles suivantes pour protéger tes
            données&nbsp;:
          </p>
          <ul>
            <li>Chiffrement TLS 1.3 pour toutes les communications</li>
            <li>Mots de passe hashés avec bcrypt (coût 12)</li>
            <li>Isolation réseau des bases de données (VPC privé)</li>
            <li>Sauvegarde chiffrée quotidienne, rétention 30 jours</li>
            <li>Audit de sécurité annuel</li>
            <li>Principe du moindre privilège pour les accès internes</li>
          </ul>
          <p>
            En cas de violation de données susceptible d'engendrer un risque pour tes droits et libertés,
            nous informons la CNIL dans les 72 heures et communiquons avec les personnes concernées dans les
            meilleurs délais.
          </p>
        </>
      ),
    },
    {
      id: 'mineurs',
      num: '07',
      title: t('sections.mineurs'),
      body: (
        <>
          <p>
            Le service est accessible aux mineurs de 13 ans et plus. Pour les joueurs âgés de moins de 15
            ans, le consentement d'un titulaire de l'autorité parentale est requis lors de l'inscription,
            conformément à la loi française.
          </p>
          <p>
            Aucune donnée n'est utilisée à des fins de profilage publicitaire ciblé sur les joueurs mineurs.
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
