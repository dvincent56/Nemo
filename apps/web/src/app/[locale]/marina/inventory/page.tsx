import { SiteShell } from '@/components/ui/SiteShell';
import InventoryClient from './InventoryClient';

export default function MarinaInventoryPage(): React.ReactElement {
  return (
    <SiteShell>
      <InventoryClient />
    </SiteShell>
  );
}
