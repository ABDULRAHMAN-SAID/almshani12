import type { PersonDetail } from '@manassah/shared';
import type { Me } from '../../ui';

/** ما تحتاجه كل تبويبات صفحة الشخص: الطاقم الحالي، بطاقة الشخص، ومعرّفه */
export type TabProps = { me: Me; d: PersonDetail; id: number };
