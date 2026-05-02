import { useTranslations } from 'next-intl';
export function Foo(): React.ReactElement {
  const t = useTranslations('marina');
  return <div>{t('title')}</div>;
}
