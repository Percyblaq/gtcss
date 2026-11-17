import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  MapPin,
  User,
  Printer,
  Plus,
  Pencil,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
  Database,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SchoolClass, Teacher, TimetableSlot } from '../types';
import {
  NIGERIAN_SUBJECTS_LIST,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { subscribeClasses } from '../services/academicService';
import { getActiveClasses, groupClassesBySection } from '../utils/classUtils';
import { extractFriendlyError, subscribeTeachers } from '../services/schoolService';
import {
  deleteTimetableSlotFromFirestore,
  saveTimetableSlotToFirestore,
  seedDefaultTimetableToFirestore,
  subscribeTimetable,
} from '../services/settingsAndTimetableService';
import { SchoolLogo } from '../components/common/SchoolLogo';

const WEEKDAYS: ('Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday')[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
];

export const TimetablePage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const canManage = role === 'director' || role === 'principal';

  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [isSeededInFirestore, setIsSeededInFirestore] = useState(false);
  const [isLoading, setIsLoading] = useState(isLiveFirestore);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSeeding, setIsSeeding] = useState(false);

  const [selectedClass, setSelectedClass] = useState<string>(SAMPLE_CLASSES[0]?.name || 'JSS 1A');
  const [selectedDay, setSelectedDay] = useState<
    'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday'
  >('Monday');

  // Add / Edit Slot Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | undefined>(undefined);
  const [slotForm, setSlotForm] = useState<{
    day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
    period: number;
    timeRange: string;
    className: string;
    subject: string;
    teacherName: string;
    room: string;
    isBreak: boolean;
  }>({
    day: 'Monday',
    period: 1,
    timeRange: '08:00 AM - 08:45 AM',
    className: SAMPLE_CLASSES[0]?.name || 'JSS 1A',
    subject: 'Mathematics',
    teacherName: '',
    room: 'Room 101',
    isBreak: false,
  });

  useEffect(() => {
    if (!firebaseUser) {
      setTeachersList([]);
      setSlots([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    const u1 = subscribeClasses(
      (cls) => setClassesList(cls.length > 0 ? cls : SAMPLE_CLASSES),
      setErrorMsg
    );
    const u2 =
      role !== 'parent'
        ? subscribeTeachers(setTeachersList, setErrorMsg)
        : (() => {
            setTeachersList([]);
            return () => {};
          })();
    const u3 = subscribeTimetable(
      (liveSlots, seeded) => {
        setSlots(liveSlots);
        setIsSeededInFirestore(seeded);
        setIsLoading(false);
      },
      (err) => {
        setErrorMsg(err);
        setIsLoading(false);
      }
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [firebaseUser, role]);

  // Accessible active classes for selection
  const visibleClasses = useMemo(() => {
    const active = getActiveClasses(classesList);
    if (role === 'teacher' && (currentUser?.assignedClasses || []).length > 0) {
      const assigned = active.filter((c) => currentUser?.assignedClasses?.includes(c.name));
      if (assigned.length > 0) return assigned;
    }
    return active;
  }, [classesList, role, currentUser]);

  useEffect(() => {
    if (
      visibleClasses.length > 0 &&
      !visibleClasses.some((c) => c.name === selectedClass)
    ) {
      setSelectedClass(visibleClasses[0].name);
    }
  }, [visibleClasses, selectedClass]);

  const selectedClassMeta = useMemo(
    () => classesList.find((c) => c.name === selectedClass),
    [classesList, selectedClass]
  );

  // Filter slots for selected day AND selected class (matching slots for this class or starter slots)
  const filteredSlots = useMemo(() => {
    return slots
      .filter(
        (slot) =>
          slot.day === selectedDay &&
          slot.className.toLowerCase() === selectedClass.toLowerCase()
      )
      .sort((a, b) => a.period - b.period);
  }, [slots, selectedDay, selectedClass]);

  const openAddModal = () => {
    const nextPeriod =
      filteredSlots.length > 0
        ? Math.max(...filteredSlots.map((s) => s.period)) + 1
        : 1;
    setEditingSlotId(undefined);
    setSlotForm({
      day: selectedDay,
      period: nextPeriod,
      timeRange: '08:00 AM - 08:45 AM',
      className: selectedClass,
      subject: NIGERIAN_SUBJECTS_LIST[0],
      teacherName:
        selectedClassMeta?.formTeacherName || teachersList[0]?.fullName || 'Subject Teacher',
      room: selectedClassMeta?.roomNumber || 'Main Block',
      isBreak: false,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (slot: TimetableSlot) => {
    setEditingSlotId(slot.id);
    setSlotForm({
      day: slot.day,
      period: slot.period,
      timeRange: slot.timeRange,
      className: slot.className,
      subject: slot.subject,
      teacherName: slot.teacherName,
      room: slot.room,
      isBreak: Boolean(slot.isBreak),
    });
    setIsModalOpen(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!slotForm.subject.trim() || !slotForm.timeRange.trim() || !slotForm.room.trim()) {
      setErrorMsg('Please fill in subject/break label, time range, and room.');
      return;
    }

    const payload: Omit<TimetableSlot, 'id'> & { id?: string } = {
      id: editingSlotId,
      day: slotForm.day,
      period: Number(slotForm.period),
      timeRange: slotForm.timeRange.trim(),
      className: slotForm.className,
      subject: slotForm.subject.trim(),
      teacherName: slotForm.isBreak
        ? 'All Staff'
        : slotForm.teacherName.trim() || 'Assigned Teacher',
      room: slotForm.room.trim(),
      isBreak: slotForm.isBreak,
    };

    if (!isLiveFirestore) {
      setErrorMsg('You must be signed in to update the timetable.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    try {
      await saveTimetableSlotToFirestore(payload);
      setSuccessMsg(
        editingSlotId
          ? 'Timetable slot updated in Cloud Firestore.'
          : 'New timetable period saved to Cloud Firestore.'
      );
      setIsModalOpen(false);
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to save timetable slot.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (!canManage || !isLiveFirestore) return;
    try {
      await deleteTimetableSlotFromFirestore(slotId);
      setSuccessMsg('Timetable period removed.');
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to remove timetable slot.'));
    }
  };

  const handleSeedStarter = async () => {
    if (!canManage || !isLiveFirestore) return;
    setIsSeeding(true);
    setErrorMsg('');
    try {
      await seedDefaultTimetableToFirestore();
      setSuccessMsg('Starter weekly timetable seeded into Cloud Firestore.');
      setSelectedClass('SS 2A');
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to seed starter timetable.'));
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              Class Academic Timetable
            </h1>
            <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full">
              {schoolSettings.currentTerm}
            </span>
          </div>
          <p className="text-xs text-[#6E6A63] mt-1">
            Weekly subject schedule, laboratories, periods, and staff allocations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && isLiveFirestore && !isSeededInFirestore && (
            <button
              type="button"
              onClick={handleSeedStarter}
              disabled={isSeeding}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] hover:bg-[#F4E9D0] text-[#7D5A18] text-xs font-medium transition-colors duration-150 disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              {isSeeding ? 'Seeding...' : 'Seed Sample Timetable'}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Period
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium shadow-xs transition-colors duration-150"
          >
            <Printer className="w-3.5 h-3.5 text-[#5E5B56]" />
            Print Timetable
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-center gap-2 no-print">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#86222E]" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] flex items-center gap-2 no-print">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2A583B]" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Class Selector & Day Tabs */}
      <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="w-full sm:w-72">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Select Class / Arm
            </label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] font-semibold text-[#2A2A2E]"
            >
              {groupClassesBySection(visibleClasses).map((g) => (
                <optgroup key={g.section} label={g.label}>
                  {g.classes.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} ({c.arm})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="text-xs text-[#6E6A63]">
            Form Tutor:{' '}
            <strong className="text-[#2A2A2E] font-semibold">
              {selectedClassMeta?.formTeacherName || 'Assigned Faculty'}
            </strong>{' '}
            • {selectedClassMeta?.section || 'General'}
          </div>
        </div>

        {/* Days of Week Tab Bar */}
        <div className="flex p-1 bg-[#FAF8F4] border border-[#E6DFD3] rounded-[8px] overflow-x-auto gap-1">
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              className={`flex-1 min-w-[90px] py-2 text-xs font-medium rounded-[6px] transition-colors duration-150 text-center ${
                selectedDay === day
                  ? 'bg-[#6B1020] text-white shadow-xs'
                  : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-[#EFE9DF]/60'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Timetable Period Schedule */}
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
        <div className="p-4 bg-[#FAF8F4] border-b border-[#E6DFD3] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="sm"
              variant="print"
            />
            <div>
              <h3 className="font-semibold text-sm text-[#2A2A2E]">
                {selectedDay}&apos;s Daily Schedule — {selectedClass}
              </h3>
              <p className="text-[11px] text-[#6E6A63]">
                {schoolSettings.schoolName} • {schoolSettings.currentSession} ({schoolSettings.currentTerm})
              </p>
            </div>
          </div>
          <span className="text-xs text-[#6E6A63]">Assembly commences at 07:45 AM daily</span>
        </div>

        <div className="p-4 sm:p-6 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-[#6E6A63] text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#6B1020]" />
              Loading timetable from Cloud Firestore...
            </div>
          ) : filteredSlots.length === 0 ? (
            <div className="py-12 text-center text-[#6E6A63] text-xs space-y-2">
              <p>
                No periods scheduled for <strong className="text-[#2A2A2E]">{selectedClass}</strong> on{' '}
                <strong className="text-[#2A2A2E]">{selectedDay}</strong>.
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FAF0F2] border border-[#DFC7CA] text-[#6B1020] font-medium hover:bg-[#F3E1E5] transition-colors duration-150 no-print"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Schedule First Period for {selectedClass}
                </button>
              )}
            </div>
          ) : (
            filteredSlots.map((slot) => {
              if (slot.isBreak) {
                return (
                  <div
                    key={slot.id}
                    className="p-3 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] flex items-center justify-between text-xs text-[#7D5A18] gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#B8913A]" />
                      <span className="font-semibold">{slot.subject}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[#7D5A18] font-medium tabular-nums">
                        {slot.timeRange}
                      </span>
                      {canManage && (
                        <div className="flex items-center gap-1 no-print">
                          <button
                            type="button"
                            onClick={() => openEditModal(slot)}
                            className="p-1 text-[#7D5A18] hover:bg-[#F4E9D0] rounded-[6px] transition-colors duration-150"
                            title="Edit break"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSlot(slot.id)}
                            className="p-1 text-[#86222E] hover:bg-[#FAF0F2] rounded-[6px] transition-colors duration-150"
                            title="Delete break"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={slot.id}
                  className="p-4 rounded-[8px] border border-[#E6DFD3] hover:border-[#B8913A]/70 hover:bg-[#FAF8F4] transition-colors duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[8px] bg-[#FAF0F2] text-[#6B1020] font-semibold flex items-center justify-center shrink-0 border border-[#DFC7CA] tabular-nums">
                      P{slot.period}
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#2A2A2E] text-sm">{slot.subject}</h4>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#6E6A63] mt-0.5">
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-[#7F7A72]" />
                          {slot.teacherName}
                        </span>
                        <span className="text-[#DDD5C7]">•</span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#7F7A72]" />
                          {slot.room}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2">
                    <span className="inline-block px-3 py-1 rounded-[6px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#2A2A2E] font-mono text-xs font-medium tabular-nums">
                      {slot.timeRange}
                    </span>
                    {canManage && (
                      <div className="flex items-center gap-1 no-print">
                        <button
                          type="button"
                          onClick={() => openEditModal(slot)}
                          className="p-1.5 text-[#5E5B56] hover:text-[#6B1020] hover:bg-[#FAF0F2] rounded-[6px] transition-colors duration-150"
                          title="Edit period"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(slot.id)}
                          className="p-1.5 text-[#5E5B56] hover:text-[#86222E] hover:bg-[#FAF0F2] rounded-[6px] transition-colors duration-150"
                          title="Delete period"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Add / Edit Slot Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3]">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-base text-[#2A2A2E]">
                {editingSlotId ? 'Edit Timetable Period' : 'Add Timetable Period'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSlot} className="pt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Class *</label>
                  <select
                    value={slotForm.className}
                    onChange={(e) => setSlotForm({ ...slotForm, className: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white font-medium text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {groupClassesBySection(getActiveClasses(classesList)).map((g) => (
                      <optgroup key={g.section} label={g.label}>
                        {g.classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Day *</label>
                  <select
                    value={slotForm.day}
                    onChange={(e) =>
                      setSlotForm({
                        ...slotForm,
                        day: e.target.value as TimetableSlot['day'],
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white font-medium text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Period # *</label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    required
                    value={slotForm.period}
                    onChange={(e) => setSlotForm({ ...slotForm, period: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Time Range *</label>
                  <input
                    type="text"
                    required
                    placeholder="08:00 AM - 08:45 AM"
                    value={slotForm.timeRange}
                    onChange={(e) => setSlotForm({ ...slotForm, timeRange: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] cursor-pointer">
                <input
                  type="checkbox"
                  checked={slotForm.isBreak}
                  onChange={(e) =>
                    setSlotForm({
                      ...slotForm,
                      isBreak: e.target.checked,
                      subject: e.target.checked ? 'Short Break / Recess' : NIGERIAN_SUBJECTS_LIST[0],
                    })
                  }
                  className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                />
                <span className="font-medium text-[#7D5A18]">
                  Mark as Break / Assembly / Recess Period
                </span>
              </label>

              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">
                  {slotForm.isBreak ? 'Break Label *' : 'Subject *'}
                </label>
                <input
                  type="text"
                  required
                  list="timetable-subjects"
                  value={slotForm.subject}
                  onChange={(e) => setSlotForm({ ...slotForm, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                />
                <datalist id="timetable-subjects">
                  {NIGERIAN_SUBJECTS_LIST.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {!slotForm.isBreak && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-[#2A2A2E] mb-1">Teacher</label>
                    <input
                      type="text"
                      list="timetable-teachers"
                      value={slotForm.teacherName}
                      onChange={(e) => setSlotForm({ ...slotForm, teacherName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                    <datalist id="timetable-teachers">
                      {teachersList.map((t) => (
                        <option key={t.id} value={t.fullName} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block font-medium text-[#2A2A2E] mb-1">Room / Lab *</label>
                    <input
                      type="text"
                      required
                      value={slotForm.room}
                      onChange={(e) => setSlotForm({ ...slotForm, room: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSaving ? 'Saving...' : 'Save Period'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
