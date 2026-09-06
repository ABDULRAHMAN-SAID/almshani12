import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TeacherStudentRow, PageMeta } from '@manassah/shared';
import { api, when } from '../../api';
import { DataTable, PersonLink, LearnerChip, type Column } from '../../ui';

/** طلاب المعلّم: المتعلّم (اسم + صف فقط) وحساب وليّ الأمر برابط صفحة الشخص، عدد الحصص وآخرها */
export function StudentsTab({ teacherId }: { teacherId: number }) {
  const [page, setPage] = useState(1);
  const s = useQuery({ queryKey: ['adm-teacher-students', teacherId, page], queryFn: () => api.get<{ data: TeacherStudentRow[]; meta: PageMeta }>(`/admin/teachers/${teacherId}/students`, { page, limit: 30 }) });
  const cols: Column<TeacherStudentRow>[] = [
    { key: 'learner', label: 'المتعلّم', render: r => <LearnerChip learner={r.learner} size={26} /> },
    { key: 'account', label: 'الحساب', render: r => <PersonLink id={r.account.id} name={r.account.name} /> },
    { key: 'lessons', label: 'الحصص', className: 'num', render: r => r.lessons },
    { key: 'last', label: 'آخر حصة', className: 'num small', render: r => when(r.lastAt) },
  ];
  return <div className="card"><DataTable columns={cols} rows={s.data?.data} meta={s.data?.meta} onPage={setPage} loading={s.isLoading} rowKey={r => `${r.account.id}-${r.learner.id}`} empty="لا طلاب بعد" /></div>;
}
