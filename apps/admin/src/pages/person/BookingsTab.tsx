import { useState } from 'react';
import { BookingsTable } from '../parts/BookingsTable';
import type { TabProps } from './types';

/** الحجوزات: كطالب (studentId) أو كمعلّم (teacherId) عندما يحمل دور المعلّم */
export function BookingsTab({ me, d, id }: TabProps) {
  const [asTeacher, setAsTeacher] = useState(false);
  const isTeacher = d.roles.some(r => r.role === 'teacher');
  return (
    <>
      {isTeacher ? <div className="toolbar"><button className={`chip ${!asTeacher ? 'on' : ''}`} onClick={() => setAsTeacher(false)}>كطالب</button><button className={`chip ${asTeacher ? 'on' : ''}`} onClick={() => setAsTeacher(true)}>كمعلّم</button></div> : null}
      <BookingsTable key={String(asTeacher)} me={me} params={asTeacher ? { teacherId: id } : { studentId: id }} hideStudent={!asTeacher} hideTeacher={asTeacher} />
    </>
  );
}
