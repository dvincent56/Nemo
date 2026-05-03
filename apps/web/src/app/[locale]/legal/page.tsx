import { Fragment } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageLegal.meta');
  return { title: t('title'), description: t('description') };
}

export default async function LegalPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageLegal');
  const tb = await getTranslations('pageLegal.body');

  const richTags = {
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  };

  const editeurItems = tb.raw('editeur.items') as [string, string][];
  const hebergeurItems = tb.raw('hebergeur.items') as { term: string; lines: string[] }[];
  const contactItems = tb.raw('contact.items') as [string, string][];

  const sections: LegalSection[] = [
    {
      id: 'editeur',
      num: '01',
      title: t('sections.editeur'),
      body: (
        <dl>
          {editeurItems.map(([term, def]) => (
            <Fragment key={term}>
              <dt>{term}</dt>
              <dd>{def}</dd>
            </Fragment>
          ))}
          <dt>{tb('editeur.emailLabel')}</dt>
          <dd><a href="mailto:hello@nemo.sail">hello@nemo.sail</a></dd>
        </dl>
      ),
    },
    {
      id: 'directeur',
      num: '02',
      title: t('sections.directeur'),
      body: (
        <>
          <p>{tb('directeur.p1')}</p>
          <p>{tb('directeur.contactLabel')} <a href="mailto:hello@nemo.sail">hello@nemo.sail</a>.</p>
        </>
      ),
    },
    {
      id: 'hebergeur',
      num: '03',
      title: t('sections.hebergeur'),
      body: (
        <dl>
          {hebergeurItems.map(({ term, lines }) => (
            <Fragment key={term}>
              <dt>{term}</dt>
              <dd>
                {lines.map((line, i) => (
                  <span key={i}>
                    {line}
                    {i < lines.length - 1 && <br />}
                  </span>
                ))}
              </dd>
            </Fragment>
          ))}
        </dl>
      ),
    },
    {
      id: 'ip',
      num: '04',
      title: t('sections.ip'),
      body: (
        <>
          <p>{tb('ip.p1')}</p>
          <p>{tb('ip.p2')}</p>
          <p>{tb.rich('ip.p3', richTags)}</p>
        </>
      ),
    },
    {
      id: 'marques',
      num: '05',
      title: t('sections.marques'),
      body: <p>{tb.rich('marques.p1', richTags)}</p>,
    },
    {
      id: 'responsabilite',
      num: '06',
      title: t('sections.responsabilite'),
      body: (
        <>
          <p>{tb('responsabilite.p1')}</p>
          <p>{tb('responsabilite.p2')}</p>
        </>
      ),
    },
    {
      id: 'contact',
      num: '07',
      title: t('sections.contact'),
      body: (
        <>
          <p>{tb('contact.intro')}</p>
          <dl>
            {contactItems.map(([term, email]) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd><a href={`mailto:${email}`}>{email}</a></dd>
              </Fragment>
            ))}
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
