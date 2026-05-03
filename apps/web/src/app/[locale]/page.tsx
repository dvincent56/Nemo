import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('common.actions');

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>{locale.toUpperCase()}</h1>
      <p>{t('save')}</p>
    </main>
  );
}
