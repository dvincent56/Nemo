import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageLegal.meta');
  return { title: t('title'), description: t('description') };
}

// NB : les bodies des sections restent en JSX FR inline. Le texte juridique
// nécessite une traduction par juriste local — sera externalisé en messages
// JSON / MDX par locale dans une vague de "vraie traduction" ultérieure.
// Les valeurs entre < > sont des placeholders à remplacer dès que la société
// éditrice est immatriculée (RCS, SIREN, adresse). Conforme LCEN art. 6-III.

export default async function LegalPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageLegal');

  const sections: LegalSection[] = [
    {
      id: 'editeur',
      num: '01',
      title: t('sections.editeur'),
      body: (
        <>
          <dl>
            <dt>Dénomination sociale</dt>
            <dd>&lt;À compléter — nom de la société&gt;</dd>
            <dt>Forme juridique</dt>
            <dd>&lt;SAS / SARL / EURL&gt;</dd>
            <dt>Capital social</dt>
            <dd>&lt;Montant en €&gt;</dd>
            <dt>Siège social</dt>
            <dd>&lt;Adresse complète&gt;</dd>
            <dt>RCS</dt>
            <dd>&lt;Ville&gt; &lt;Numéro&gt;</dd>
            <dt>SIREN</dt>
            <dd>&lt;9 chiffres&gt;</dd>
            <dt>TVA intracommunautaire</dt>
            <dd>FR &lt;Numéro&gt;</dd>
            <dt>Email</dt>
            <dd><a href="mailto:hello@nemo.sail">hello@nemo.sail</a></dd>
          </dl>
        </>
      ),
    },
    {
      id: 'directeur',
      num: '02',
      title: t('sections.directeur'),
      body: (
        <>
          <p>
            &lt;Prénom Nom&gt;, en qualité de &lt;fonction — gérant, président, directeur général&gt;.
          </p>
          <p>Contact&nbsp;: <a href="mailto:hello@nemo.sail">hello@nemo.sail</a>.</p>
        </>
      ),
    },
    {
      id: 'hebergeur',
      num: '03',
      title: t('sections.hebergeur'),
      body: (
        <>
          <dl>
            <dt>Hébergeur principal</dt>
            <dd>
              Amazon Web Services EMEA SARL<br />
              38 Avenue John F. Kennedy, L-1855 Luxembourg<br />
              Région eu-west-3 (Paris, France)
            </dd>
            <dt>CDN / Proxy</dt>
            <dd>
              Cloudflare, Inc.<br />
              101 Townsend St, San Francisco, CA 94107, USA<br />
              Point de présence&nbsp;: Paris, Francfort, Londres
            </dd>
          </dl>
        </>
      ),
    },
    {
      id: 'ip',
      num: '04',
      title: t('sections.ip'),
      body: (
        <>
          <p>
            La structure générale, les textes, graphismes, sons, vidéos et animations composant le site sont
            la propriété exclusive de l'éditeur ou de ses partenaires, et sont protégés par les lois en
            vigueur sur la propriété intellectuelle.
          </p>
          <p>
            Toute reproduction, représentation ou exploitation, totale ou partielle, des contenus et
            services du site, par quelque procédé que ce soit, sans autorisation écrite préalable de
            l'éditeur, est prohibée et constituerait une contrefaçon sanctionnée par le Code de la propriété
            intellectuelle.
          </p>
          <p>
            Les polaires de bateaux utilisées dans le moteur de jeu sont soit des données publiques certifiées
            par les constructeurs, soit acquises sous licence commerciale auprès de ces derniers. Les données
            météorologiques proviennent du modèle <strong>NOAA GFS</strong>, distribué gratuitement par
            l'agence américaine NOAA.
          </p>
        </>
      ),
    },
    {
      id: 'marques',
      num: '05',
      title: t('sections.marques'),
      body: (
        <>
          <p>
            «&nbsp;<strong>Nemo</strong>&nbsp;», le logo, et les noms des modes de jeu sont des marques
            déposées par l'éditeur. Les marques de bateaux et constructeurs (Figaro, Class40, IMOCA, Ultim,
            Ocean Fifty) appartiennent à leurs propriétaires respectifs et sont utilisées sous licence ou
            dans le cadre d'un usage informatif.
          </p>
        </>
      ),
    },
    {
      id: 'responsabilite',
      num: '06',
      title: t('sections.responsabilite'),
      body: (
        <>
          <p>
            Les informations et contenus diffusés sur le site sont fournis à titre indicatif. L'éditeur
            s'efforce d'assurer l'exactitude et la mise à jour des informations mais ne saurait garantir leur
            exhaustivité.
          </p>
          <p>
            L'éditeur décline toute responsabilité quant à l'interprétation qui pourrait être faite des
            informations présentes sur le site, et aux conséquences de leur utilisation.
          </p>
        </>
      ),
    },
    {
      id: 'contact',
      num: '07',
      title: t('sections.contact'),
      body: (
        <>
          <p>
            Pour toute question, demande ou signalement relatif au service&nbsp;:
          </p>
          <dl>
            <dt>Support général</dt>
            <dd><a href="mailto:hello@nemo.sail">hello@nemo.sail</a></dd>
            <dt>Données personnelles / RGPD</dt>
            <dd><a href="mailto:dpo@nemo.sail">dpo@nemo.sail</a></dd>
            <dt>Signalement de contenu illicite</dt>
            <dd><a href="mailto:abuse@nemo.sail">abuse@nemo.sail</a></dd>
            <dt>Presse</dt>
            <dd><a href="mailto:press@nemo.sail">press@nemo.sail</a></dd>
          </dl>
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
