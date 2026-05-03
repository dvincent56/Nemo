import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageCgu.meta');
  return { title: t('title'), description: t('description') };
}

// NB : les bodies des sections restent en JSX FR inline. Le texte juridique
// nécessite une traduction par juriste local — sera externalisé en messages
// JSON / MDX par locale dans une vague de "vraie traduction" ultérieure.

export default async function CGUPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageCgu');

  const sections: LegalSection[] = [
    {
      id: 'objet',
      num: '01',
      title: t('sections.objet'),
      body: (
        <>
          <p>
            Les présentes conditions générales d'utilisation (ci-après «&nbsp;<strong>CGU</strong>&nbsp;»)
            régissent l'accès et l'utilisation du service <strong>Nemo</strong>, jeu de course au large en
            ligne accessible sur <a href="https://nemo.sail">nemo.sail</a> et via l'application mobile
            associée.
          </p>
          <p>
            Le service est édité par la société éditrice identifiée dans les <Link href="/legal">mentions
            légales</Link>. L'utilisation du service implique l'acceptation pleine et entière des présentes CGU.
          </p>
        </>
      ),
    },
    {
      id: 'acceptation',
      num: '02',
      title: t('sections.acceptation'),
      body: (
        <>
          <p>
            L'acceptation des CGU est matérialisée par la création d'un compte joueur. Elle vaut pour toute la
            durée d'utilisation du service.
          </p>
          <p>
            L'éditeur peut modifier les présentes CGU à tout moment. Les nouvelles conditions s'appliquent
            dès publication sur le site. En cas de changement substantiel (tarification, données personnelles,
            règles de jeu), les utilisateurs actifs sont informés par email avec un préavis de 30 jours.
          </p>
        </>
      ),
    },
    {
      id: 'compte',
      num: '03',
      title: t('sections.compte'),
      body: (
        <>
          <p>
            La création d'un compte suppose de fournir une adresse email valide et de choisir un pseudo
            unique. Le joueur garantit l'exactitude des informations fournies et s'engage à les maintenir à
            jour dans son profil.
          </p>
          <p>
            Le compte est strictement personnel et non-cessible. Le partage des identifiants, la revente ou la
            création de multi-comptes sont interdits et constituent un motif de suspension immédiate.
          </p>
          <p>
            L'éditeur se réserve le droit de refuser ou modifier un pseudo contenant des propos haineux,
            racistes, sexistes, diffamatoires, ou usurpant l'identité d'un tiers.
          </p>
        </>
      ),
    },
    {
      id: 'regles',
      num: '04',
      title: t('sections.regles'),
      body: (
        <>
          <p>
            Le service est une compétition de régate simulée. Tous les joueurs utilisent les mêmes polaires
            réelles de bateaux, la même météo NOAA GFS et le même moteur de calcul. Aucun avantage payant
            n'est accessible dans le jeu&nbsp;: les crédits servant aux upgrades de bateau ne peuvent pas
            être achetés en euros et s'acquièrent uniquement par les résultats en course.
          </p>
          <p>Sont formellement interdits&nbsp;:</p>
          <ul>
            <li>L'utilisation de robots, scripts, ou modules d'automatisation non autorisés</li>
            <li>L'exploitation de bugs connus, d'injections de requêtes, ou tout contournement technique</li>
            <li>Les ententes entre comptes pour fausser un classement</li>
            <li>Les comportements toxiques, harcèlement ou propos discriminants dans les chats et équipes</li>
          </ul>
          <p>
            Les sanctions vont de l'avertissement à la suspension définitive, en passant par l'invalidation
            de résultats et la révocation de crédits frauduleusement obtenus.
          </p>
        </>
      ),
    },
    {
      id: 'abonnement',
      num: '05',
      title: t('sections.abonnement'),
      body: (
        <>
          <p>
            <strong>Toutes les courses du circuit sont accessibles à tous les joueurs</strong>, quel que
            soit leur palier. La différence Libre / Carrière porte sur le gameplay autour de la course,
            pas sur l'accès aux courses elles-mêmes.
          </p>
          <p>Le service propose deux paliers&nbsp;:</p>
          <dl>
            <dt>Mode Libre</dt>
            <dd>
              Gratuit. Courses one-shot, classement saison, broadcast temps réel toutes les 120&nbsp;s.
              Pas d'accès à la marina, pas de progression sur la saison.
            </dd>
            <dt>Mode Carrière</dt>
            <dd>
              Abonnement mensuel ou annuel. Marina complète (upgrades de bateau, customisation coque et
              voiles), broadcast temps réel toutes les 30&nbsp;s, outils de routage (isochrones),
              progression de carrière persistante sur la saison.
            </dd>
          </dl>
          <p>
            L'abonnement est prélevé par Stripe. Il est résiliable à tout moment depuis la page compte&nbsp;;
            la résiliation prend effet à la fin de la période en cours. Aucun remboursement au prorata n'est
            effectué pour une période déjà entamée, sauf cas prévus par la loi (droit de rétractation de
            14&nbsp;jours pour un premier abonnement).
          </p>
        </>
      ),
    },
    {
      id: 'ip',
      num: '06',
      title: t('sections.ip'),
      body: (
        <>
          <p>
            L'ensemble des éléments du service (code, graphismes, textes, marques, polaires calculées, modèle
            météo dérivé) est la propriété exclusive de l'éditeur ou de ses partenaires et est protégé par le
            droit d'auteur et le droit des marques.
          </p>
          <p>
            Le joueur conserve la propriété des noms de bateaux, devises et éléments de personnalisation qu'il
            saisit, mais concède à l'éditeur une licence non-exclusive pour les afficher dans le cadre du
            service (classement, replays, partage social).
          </p>
        </>
      ),
    },
    {
      id: 'responsabilite',
      num: '07',
      title: t('sections.responsabilite'),
      body: (
        <>
          <p>
            L'éditeur s'engage à maintenir le service accessible dans des conditions raisonnables. Des
            interruptions pour maintenance, incidents techniques, ou cas de force majeure (panne
            opérateur, coupure réseau, cyberattaque) peuvent survenir sans que la responsabilité de
            l'éditeur puisse être engagée.
          </p>
          <p>
            L'éditeur ne saurait être tenu responsable des pertes de crédits, positions ou statistiques
            résultant d'un cas de force majeure ou d'une intervention de sécurité. Des compensations
            raisonnables peuvent être accordées au cas par cas.
          </p>
        </>
      ),
    },
    {
      id: 'resiliation',
      num: '08',
      title: t('sections.resiliation'),
      body: (
        <>
          <p>
            Le joueur peut supprimer son compte à tout moment depuis la page Paramètres. La suppression est
            immédiate et irréversible&nbsp;: pseudo, flotte, historique et crédits sont supprimés sous 30 jours.
            Les données nécessaires aux obligations légales et comptables sont conservées pour la durée
            prévue par la loi.
          </p>
          <p>
            L'éditeur peut résilier unilatéralement un compte en cas de violation grave des CGU, avec
            préavis de 15 jours sauf fraude avérée ou atteinte à la sécurité du service.
          </p>
        </>
      ),
    },
    {
      id: 'loi',
      num: '09',
      title: t('sections.loi'),
      body: (
        <>
          <p>
            Les présentes CGU sont régies par le droit français. Tout litige relatif à leur interprétation ou
            à leur exécution relève, à défaut de résolution amiable, des tribunaux compétents du ressort du
            siège social de l'éditeur, sous réserve des dispositions légales impératives en faveur des
            consommateurs.
          </p>
          <p>
            Une procédure de médiation est accessible via la <a href="https://www.mediation-conso.fr">plateforme
            de médiation de la consommation</a> pour tout litige n'ayant pas trouvé d'issue amiable avec le
            service client.
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
