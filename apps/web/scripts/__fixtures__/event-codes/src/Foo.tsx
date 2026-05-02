import { tEvent } from '@/lib/i18n-helpers';

export function Foo(): React.ReactElement {
  return <div>{tEvent('wind-shift')}</div>;
}
