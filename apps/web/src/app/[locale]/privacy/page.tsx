import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pagePrivacy.meta');
  return { title: t('title'), description: t('description') };
}

export default async function PrivacyPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pagePrivacy');
  const tb = await getTranslations('pagePrivacy.body');

  // Tags partagés pour t.rich — réutilisables d'une section à l'autre.
  const richTags = {
    legal: (chunks: React.ReactNode) => <Link href="/legal">{chunks}</Link>,
    mail: (chunks: React.ReactNode) => <a href={`mailto:${chunks}`}>{chunks}</a>,
    ext: (chunks: React.ReactNode) => <a href="https://www.cnil.fr">{chunks}</a>,
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  };

  // dl items: [term, def][] → t.raw renvoie le tableau brut.
  const donneesItems = tb.raw('donnees.items') as [string, string][];
  const finalitesHeaders = tb.raw('finalites.headers') as string[];
  const finalitesRows = tb.raw('finalites.rows') as string[][];
  const destinatairesItems = tb.raw('destinataires.items') as [string, string][];
  const droitsItems = tb.raw('droits.items') as [string, string][];
  const securiteMeasures = tb.raw('securite.measures') as string[];

  const sections: LegalSection[] = [
    {
      id: 'responsable',
      num: '01',
      title: t('sections.responsable'),
      body: (
        <>
          <p>{tb.rich('responsable.p1', richTags)}</p>
          <p>{tb.rich('responsable.p2', richTags)}</p>
        </>
      ),
    },
    {
      id: 'donnees',
      num: '02',
      title: t('sections.donnees'),
      body: (
        <>
          <p>{tb('donnees.intro')}</p>
          <dl>
            {donneesItems.map(([term, def]) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </Fragment>
            ))}
          </dl>
        </>
      ),
    },
    {
      id: 'finalites',
      num: '03',
      title: t('sections.finalites'),
      body: (
        <table>
          <thead>
            <tr>
              {finalitesHeaders.map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {finalitesRows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => <td key={j}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      id: 'destinataires',
      num: '04',
      title: t('sections.destinataires'),
      body: (
        <>
          <p>{tb.rich('destinataires.intro', richTags)}</p>
          <dl>
            {destinatairesItems.map(([term, def]) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </Fragment>
            ))}
          </dl>
          <p>{tb('destinataires.outro')}</p>
        </>
      ),
    },
    {
      id: 'droits',
      num: '05',
      title: t('sections.droits'),
      body: (
        <>
          <p>{tb('droits.intro')}</p>
          <dl>
            {droitsItems.map(([term, def]) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </Fragment>
            ))}
          </dl>
          <p>{tb.rich('droits.exercise', richTags)}</p>
          <p>{tb.rich('droits.complaint', richTags)}</p>
        </>
      ),
    },
    {
      id: 'securite',
      num: '06',
      title: t('sections.securite'),
      body: (
        <>
          <p>{tb('securite.intro')}</p>
          <ul>
            {securiteMeasures.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p>{tb('securite.breach')}</p>
        </>
      ),
    },
    {
      id: 'mineurs',
      num: '07',
      title: t('sections.mineurs'),
      body: (
        <>
          <p>{tb('mineurs.p1')}</p>
          <p>{tb('mineurs.p2')}</p>
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
