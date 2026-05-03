import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageCookies.meta');
  return { title: t('title'), description: t('description') };
}

export default async function CookiesPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageCookies');
  const tb = await getTranslations('pageCookies.body');

  const richTags = {
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    i: (chunks: React.ReactNode) => <em>{chunks}</em>,
  };

  const listeHeaders = tb.raw('liste.headers') as string[];
  const listeRows = tb.raw('liste.rows') as string[][];
  const trackingItems = tb.raw('pasDeTracking.items') as string[];
  const browsers = tb.raw('gestion.browsers') as [string, string][];

  const sections: LegalSection[] = [
    {
      id: 'definition',
      num: '01',
      title: t('sections.definition'),
      body: (
        <>
          <p>{tb('definition.p1')}</p>
          <p>{tb.rich('definition.p2', richTags)}</p>
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
                {listeHeaders.map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {listeRows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      {/* La 1re colonne contient un identifiant de cookie : on
                         le rend dans <code> pour suivre l'esthétique d'origine. */}
                      {j === 0 ? <code>{cell}</code> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>{tb('liste.p1')}</p>
          <p>{tb('liste.p2')}</p>
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
            {trackingItems.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p>{tb('pasDeTracking.outro')}</p>
        </>
      ),
    },
    {
      id: 'gestion',
      num: '04',
      title: t('sections.gestion'),
      body: (
        <>
          <p>{tb.rich('gestion.intro', richTags)}</p>
          <p>{tb('gestion.docsLabel')}</p>
          <ul>
            {browsers.map(([name, url]) => (
              <li key={name}><a href={url}>{name}</a></li>
            ))}
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
          <p>{tb('evolution.p1')}</p>
          <p>{tb('evolution.p2')}</p>
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
