import { SiteShell } from '@/components/ui/SiteShell';
import MarinaClient from './MarinaClient';

export default function MarinaPage(): React.ReactElement {
  return (
    <SiteShell>
      <MarinaClient />
    </SiteShell>
  );
}
