import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LegalLayout, type LegalSection } from '@/components/ui';
import { SiteShell } from '@/components/ui/SiteShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pageCgu.meta');
  return { title: t('title'), description: t('description') };
}

export default async function CGUPage(): Promise<React.ReactElement> {
  const t = await getTranslations('pageCgu');
  const tb = await getTranslations('pageCgu.body');

  // Tags partagés pour t.rich. Les liens externes sont contextuels :
  // chaque section qui en utilise un passe l'override correspondant.
  const baseTags = {
    legal: (chunks: React.ReactNode) => <Link href="/legal">{chunks}</Link>,
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  };
  const objetTags = {
    ...baseTags,
    ext: (chunks: React.ReactNode) => <a href="https://nemo.sail">{chunks}</a>,
  };
  const loiTags = {
    ...baseTags,
    ext: (chunks: React.ReactNode) => <a href="https://www.mediation-conso.fr">{chunks}</a>,
  };

  const reglesForbidden = tb.raw('regles.forbidden') as string[];
  const abonnementTiers = tb.raw('abonnement.tiers') as [string, string][];

  const sections: LegalSection[] = [
    {
      id: 'objet',
      num: '01',
      title: t('sections.objet'),
      body: (
        <>
          <p>{tb.rich('objet.p1', objetTags)}</p>
          <p>{tb.rich('objet.p2', objetTags)}</p>
        </>
      ),
    },
    {
      id: 'acceptation',
      num: '02',
      title: t('sections.acceptation'),
      body: (
        <>
          <p>{tb('acceptation.p1')}</p>
          <p>{tb('acceptation.p2')}</p>
        </>
      ),
    },
    {
      id: 'compte',
      num: '03',
      title: t('sections.compte'),
      body: (
        <>
          <p>{tb('compte.p1')}</p>
          <p>{tb('compte.p2')}</p>
          <p>{tb('compte.p3')}</p>
        </>
      ),
    },
    {
      id: 'regles',
      num: '04',
      title: t('sections.regles'),
      body: (
        <>
          <p>{tb('regles.intro')}</p>
          <p>{tb('regles.forbiddenIntro')}</p>
          <ul>
            {reglesForbidden.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p>{tb('regles.sanctions')}</p>
        </>
      ),
    },
    {
      id: 'abonnement',
      num: '05',
      title: t('sections.abonnement'),
      body: (
        <>
          <p>{tb.rich('abonnement.intro', baseTags)}</p>
          <p>{tb('abonnement.tiersIntro')}</p>
          <dl>
            {abonnementTiers.map(([term, def]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </div>
            ))}
          </dl>
          <p>{tb('abonnement.billing')}</p>
        </>
      ),
    },
    {
      id: 'ip',
      num: '06',
      title: t('sections.ip'),
      body: (
        <>
          <p>{tb('ip.p1')}</p>
          <p>{tb('ip.p2')}</p>
        </>
      ),
    },
    {
      id: 'responsabilite',
      num: '07',
      title: t('sections.responsabilite'),
      body: (
        <>
          <p>{tb('responsabilite.p1')}</p>
          <p>{tb('responsabilite.p2')}</p>
        </>
      ),
    },
    {
      id: 'resiliation',
      num: '08',
      title: t('sections.resiliation'),
      body: (
        <>
          <p>{tb('resiliation.p1')}</p>
          <p>{tb('resiliation.p2')}</p>
        </>
      ),
    },
    {
      id: 'loi',
      num: '09',
      title: t('sections.loi'),
      body: (
        <>
          <p>{tb('loi.p1')}</p>
          <p>{tb.rich('loi.p2', loiTags)}</p>
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
