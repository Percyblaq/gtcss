import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import {
  AcademicTerm,
  Announcement,
  AnnouncementComment,
  CalendarEventType,
  SchoolCalendarEvent,
  UserRole,
} from '../types';
import { extractFriendlyError } from './schoolService';

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
}

export function getTodayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ==================== SUBSCRIPTIONS ====================

export function subscribeAnnouncements(
  role: UserRole,
  onData: (announcements: Announcement[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, 'announcements');

  let targetQuery;
  if (role === 'director' || role === 'principal') {
    targetQuery = colRef;
  } else if (role === 'teacher' || role === 'head_teacher' || role === 'bursar') {
    targetQuery = query(
      colRef,
      where('status', '==', 'Published'),
      where('targetAudience', 'in', ['All', 'Teachers', 'Specific Classes'])
    );
  } else {
    // Parent role: strictly excluded from Teachers-only, Scheduled, and Archived notices
    targetQuery = query(
      colRef,
      where('status', '==', 'Published'),
      where('targetAudience', 'in', ['All', 'Parents', 'Students', 'Specific Classes'])
    );
  }

  return onSnapshot(
    targetQuery,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Announcement), id: d.id }));
      list.sort((a, b) => {
        const da = a.publishDate || a.date || '';
        const dbDate = b.publishDate || b.date || '';
        return dbDate.localeCompare(da) || (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'announcements');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load announcements.'));
      }
    }
  );
}

export function subscribeCalendarEvents(
  onData: (events: SchoolCalendarEvent[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'schoolCalendarEvents'),
    (snap) => {
      const list = snap.docs.map((d) => ({
        ...(d.data() as SchoolCalendarEvent),
        id: d.id,
      }));
      list.sort((a, b) => a.startDate.localeCompare(b.startDate));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'schoolCalendarEvents');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load school calendar events.'));
      }
    }
  );
}

// Filter announcements by publication date, status, and class targeting
export function filterVisibleAnnouncements(
  announcements: Announcement[],
  role: UserRole,
  userClassNames: string[]
): Announcement[] {
  const isAdmin = role === 'director' || role === 'principal';
  const today = getTodayIsoDate();

  return announcements.filter((item) => {
    const pubDate = item.publishDate || item.date;
    const status = item.status || 'Published';

    if (!isAdmin) {
      if (status !== 'Published') return false;
      if (pubDate && pubDate > today) return false;
      if (role === 'parent' && item.targetAudience === 'Teachers') return false;
      if ((role === 'teacher' || role === 'head_teacher') && item.targetAudience === 'Parents') return false;

      if (item.targetAudience === 'Specific Classes') {
        if (role === 'head_teacher') return true;
        const targets = item.targetClasses || [];
        if (targets.length === 0) return false;
        return targets.some((cls) => userClassNames.includes(cls));
      }
    }

    return true;
  });
}

export function filterVisibleCalendarEvents(
  events: SchoolCalendarEvent[],
  role: UserRole,
  userClassNames: string[]
): SchoolCalendarEvent[] {
  const isAdmin = role === 'director' || role === 'principal';
  if (isAdmin) return events;

  return events.filter((ev) => {
    if (ev.targetAudience === 'Specific Classes') {
      const targets = ev.targetClasses || [];
      return targets.some((cls) => userClassNames.includes(cls));
    }
    return true;
  });
}

// ==================== MUTATIONS ====================

export async function saveAnnouncementToFirestore(params: {
  announcement: Omit<Announcement, 'id'> & { id?: string };
  actorUid: string;
  alsoCreateCalendarEvent?: boolean;
  calendarEventType?: CalendarEventType;
}): Promise<Announcement> {
  const { announcement, actorUid, alsoCreateCalendarEvent, calendarEventType } = params;
  const now = new Date().toISOString();
  const today = getTodayIsoDate();
  const docId = announcement.id || `ann_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

  const pubDate = announcement.publishDate || announcement.date || today;
  const computedStatus: Announcement['status'] =
    announcement.status === 'Archived'
      ? 'Archived'
      : pubDate > today
      ? 'Scheduled'
      : 'Published';

  const payload: Announcement = {
    ...announcement,
    id: docId,
    date: pubDate,
    publishDate: pubDate,
    status: computedStatus,
    targetClasses:
      announcement.targetAudience === 'Specific Classes'
        ? announcement.targetClasses || []
        : [],
    createdByUid: actorUid,
    createdAt: announcement.createdAt || now,
    updatedAt: now,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'announcements', docId), stripUndefined(payload));

    if (alsoCreateCalendarEvent && announcement.eventStartDate) {
      const evId = `cal_${docId}`;
      const evType: CalendarEventType =
        calendarEventType ||
        (announcement.category === 'Examination Schedule'
          ? 'Examination Schedule'
          : announcement.category === 'Resumption Date'
          ? 'Resumption Date'
          : announcement.category === 'Holiday'
          ? 'Holiday'
          : announcement.category === 'PTA Meeting'
          ? 'PTA Meeting'
          : 'School Event');

      const calPayload: SchoolCalendarEvent = {
        id: evId,
        title: announcement.title,
        eventType: evType,
        session: announcement.session,
        term: announcement.term,
        startDate: announcement.eventStartDate,
        endDate: announcement.eventEndDate || announcement.eventStartDate,
        targetAudience:
          announcement.targetAudience === 'Specific Classes'
            ? 'Specific Classes'
            : announcement.targetAudience === 'Parents'
            ? 'Parents'
            : 'All',
        targetClasses:
          announcement.targetAudience === 'Specific Classes'
            ? announcement.targetClasses || []
            : [],
        description: announcement.body.slice(0, 900),
        publishedBy: announcement.authorName,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(doc(db, 'schoolCalendarEvents', evId), stripUndefined(calPayload));
    }

    await batch.commit();
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `announcements/${docId}`);
  }
}

export async function updateAnnouncementStatusInFirestore(
  announcementId: string,
  newStatus: 'Published' | 'Archived'
): Promise<void> {
  const updates: Record<string, any> = {
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
  if (newStatus === 'Published') {
    updates.publishDate = getTodayIsoDate();
    updates.date = getTodayIsoDate();
  }
  try {
    await updateDoc(doc(db, 'announcements', announcementId), updates);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `announcements/${announcementId}`);
  }
}

export async function deleteAnnouncementFromFirestore(announcementId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', announcementId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `announcements/${announcementId}`);
  }
}

// ==================== ANNOUNCEMENT COMMENTS ====================

export function subscribeAnnouncementComments(
  announcementId: string,
  onData: (comments: AnnouncementComment[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const commentsRef = collection(db, 'announcements', announcementId, 'comments');
  return onSnapshot(
    commentsRef,
    (snap) => {
      const list = snap.docs.map((d) => ({
        ...(d.data() as AnnouncementComment),
        id: d.id,
      }));
      list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, `announcements/${announcementId}/comments`);
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load announcement comments.'));
      }
    }
  );
}

export async function addAnnouncementCommentToFirestore(params: {
  announcementId: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  body: string;
}): Promise<AnnouncementComment> {
  const trimmedBody = params.body.trim();
  if (!trimmedBody) {
    throw new Error('Please enter a comment before posting.');
  }
  if (trimmedBody.length > 1000) {
    throw new Error('Comments must be 1,000 characters or fewer.');
  }
  if (!params.authorUid) {
    throw new Error('You must be signed in to post a comment.');
  }

  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 8) || 'cmt';
  const commentId = `cmt_${Date.now()}_${suffix}`.slice(0, 128);
  const safeName = (params.authorName || 'Portal User').trim().slice(0, 100) || 'Portal User';

  const payload: AnnouncementComment = {
    id: commentId,
    announcementId: params.announcementId,
    authorUid: params.authorUid,
    authorName: safeName,
    authorRole: params.authorRole,
    body: trimmedBody,
    createdAt: now,
  };

  try {
    await setDoc(doc(db, 'announcements', params.announcementId, 'comments', commentId), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `announcements/${params.announcementId}/comments/${commentId}`
    );
  }
}

export async function deleteAnnouncementCommentFromFirestore(
  announcementId: string,
  commentId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', announcementId, 'comments', commentId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `announcements/${announcementId}/comments/${commentId}`
    );
  }
}

export async function saveCalendarEventToFirestore(
  event: Omit<SchoolCalendarEvent, 'id' | 'publishedBy'> & { id?: string },
  publishedBy: string
): Promise<SchoolCalendarEvent> {
  const now = new Date().toISOString();
  const docId = event.id || `cal_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
  const payload: SchoolCalendarEvent = {
    ...event,
    id: docId,
    targetClasses:
      event.targetAudience === 'Specific Classes' ? event.targetClasses || [] : [],
    publishedBy,
    createdAt: event.createdAt || now,
    updatedAt: now,
  };
  try {
    await setDoc(doc(db, 'schoolCalendarEvents', docId), stripUndefined(payload));
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schoolCalendarEvents/${docId}`);
  }
}

export async function deleteCalendarEventFromFirestore(eventId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'schoolCalendarEvents', eventId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `schoolCalendarEvents/${eventId}`);
  }
}

export async function seedDefaultCommunicationToFirestore(
  authorName: string,
  actorUid: string,
  session: string,
  term: AcademicTerm
): Promise<void> {
  const now = new Date().toISOString();
  const today = getTodayIsoDate();
  const batch = writeBatch(db);

  const starterEvents: SchoolCalendarEvent[] = [
    {
      id: 'cal_starter_exam_t1',
      title: 'First Term Terminal Examinations',
      eventType: 'Examination Schedule',
      session,
      term,
      startDate: '2026-12-01',
      endDate: '2026-12-11',
      targetAudience: 'All',
      targetClasses: [],
      description: 'End-of-term examinations across Creche, Nursery, Primary, JSS, and SS classes.',
      publishedBy: authorName,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cal_starter_holiday_t1',
      title: 'End of First Term Vacation',
      eventType: 'Holiday',
      session,
      term,
      startDate: '2026-12-19',
      endDate: '2027-01-10',
      targetAudience: 'All',
      targetClasses: [],
      description: 'School closes for Christmas & New Year holiday break.',
      publishedBy: authorName,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cal_starter_resumption_t2',
      title: 'Second Term Resumption Date',
      eventType: 'Resumption Date',
      session,
      term: 'Second Term',
      startDate: '2027-01-11',
      endDate: '2027-01-11',
      targetAudience: 'All',
      targetClasses: [],
      description: 'All day and boarding pupils resume for Second Term academic activities.',
      publishedBy: authorName,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const starterAnn: Announcement = {
    id: 'ann_starter_welcome',
    title: 'First Term Academic Calendar, Exams & Resumption Schedule',
    body: 'Dear Parents and Guardians, please review the published First Term examination dates (1st–11th December 2026), Christmas holiday break, and Second Term resumption date (Monday, 11th January 2027) on the School Calendar tab.',
    targetAudience: 'Parents',
    targetClasses: [],
    priority: 'High',
    status: 'Published',
    authorName,
    authorRole: 'School Administration',
    term,
    session,
    date: today,
    publishDate: today,
    category: 'Resumption Date',
    createdByUid: actorUid,
    createdAt: now,
    updatedAt: now,
  };

  starterEvents.forEach((ev) => {
    batch.set(doc(db, 'schoolCalendarEvents', ev.id), stripUndefined(ev));
  });
  batch.set(doc(db, 'announcements', starterAnn.id), stripUndefined(starterAnn));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'announcements');
  }
}
