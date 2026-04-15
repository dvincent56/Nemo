import { SiteShell } from '@/components/ui';
import ClassementView from './ClassementView';
import { TOTAL_SKIPPERS } from './data';

export default function ClassementPage(): React.ReactElement {
  return (
    <SiteShell>
      <ClassementView totalSkippers={TOTAL_SKIPPERS} />
    </SiteShell>
  );
}
