import { useTranslations } from 'next-intl';

export function Foo(): React.ReactElement {
  const t = useTranslations('marina');
  const tCommon = useTranslations('common');
  return <div>{t('title')} - {tCommon('save')}</div>;
}
