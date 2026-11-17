import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { SchoolSetting, TimetableSlot } from '../types';
import { INITIAL_SCHOOL_SETTINGS, SAMPLE_TIMETABLE } from '../data/sampleData';
import { extractFriendlyError } from './schoolService';
import {
  buildFullSchoolSettingsPayload,
  buildPublicBrandingPayload,
} from './brandingService';

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
}

export function subscribeSchoolSettings(
  onData: (settings: SchoolSetting, isPersisted: boolean) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'settings', 'school'),
    (snap) => {
      if (!snap.exists()) {
        onData(INITIAL_SCHOOL_SETTINGS, false);
        return;
      }
      onData({ ...INITIAL_SCHOOL_SETTINGS, ...(snap.data() as SchoolSetting) }, true);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'settings/school');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load school settings.'));
      }
    }
  );
}

export async function saveSchoolSettingsToFirestore(settings: SchoolSetting): Promise<void> {
  const fullPayload = buildFullSchoolSettingsPayload(settings);
  const publicBranding = buildPublicBrandingPayload({
    ...INITIAL_SCHOOL_SETTINGS,
    ...settings,
  });

  try {
    await setDoc(doc(db, 'settings', 'school'), fullPayload);
    await setDoc(doc(db, 'branding', 'school'), publicBranding);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/school');
  }
}

export function subscribeTimetable(
  onData: (slots: TimetableSlot[], isSeededInFirestore: boolean) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'timetable'),
    (snap) => {
      if (snap.empty) {
        onData([], false);
        return;
      }
      const list = snap.docs.map((d) => ({ ...(d.data() as TimetableSlot), id: d.id }));
      list.sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period);
      onData(list, true);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'timetable');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load timetable.'));
      }
    }
  );
}

export async function saveTimetableSlotToFirestore(
  slot: Omit<TimetableSlot, 'id'> & { id?: string }
): Promise<TimetableSlot> {
  const docId =
    slot.id ||
    `tt_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
  const payload: TimetableSlot = {
    ...slot,
    id: docId,
    period: Number(slot.period),
    isBreak: Boolean(slot.isBreak),
  };
  try {
    await setDoc(doc(db, 'timetable', docId), stripUndefined(payload));
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `timetable/${docId}`);
  }
}

export async function deleteTimetableSlotFromFirestore(slotId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'timetable', slotId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `timetable/${slotId}`);
  }
}

export async function seedDefaultTimetableToFirestore(): Promise<void> {
  const batch = writeBatch(db);
  SAMPLE_TIMETABLE.forEach((slot) => {
    const cleanId = slot.id.replace(/[^a-zA-Z0-9_-]+/g, '_');
    batch.set(doc(db, 'timetable', cleanId), stripUndefined({ ...slot, id: cleanId }));
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'timetable');
  }
}
