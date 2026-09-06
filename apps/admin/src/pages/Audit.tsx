import { Page } from '../ui';
import { AuditTable } from './parts/AuditTable';

/** سجلّ العمليات الحسّاسة — من فعل ماذا ومتى وعلى مَن، مع مرشّحات وترقيم */
export default function Audit() {
  return <Page title="سجلّ العمليات" sub="كل عملية كتابة من اللوحة تُسجَّل باسم منفّذها والمستهدَف بها"><AuditTable filters limit={100} /></Page>;
}
