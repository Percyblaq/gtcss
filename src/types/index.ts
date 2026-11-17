export type UserRole = 'director' | 'principal' | 'bursar' | 'head_teacher' | 'teacher' | 'parent';

export type HeadTeacherTitle = 'Headmaster' | 'Headmistress';

export type AcademicTerm = 'First Term' | 'Second Term' | 'Third Term';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  inviteId?: string;
  phone?: string;
  avatar?: string;
  title?: string;
  assignedClasses?: string[]; // Classes assigned to a teacher
  assignedSubjects?: string[]; // Subjects assigned to a teacher
  subjects?: string[]; // Full list of subjects (first entry is Primary Subject)
  primarySubject?: string; // Primary Subject (first selected subject)
  linkedStudentIds?: string[]; // Student IDs linked to a parent user
  linkedStudentNames?: string[]; // Ward names for quick display
  wardName?: string; // Legacy/Quick single ward reference
  wardAdmissionNo?: string;
  createdAt?: string;
  updatedAt?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
}

export interface StaffInvite {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  phone?: string;
  title?: string;
  assignedClasses?: string[];
  assignedSubjects?: string[];
  subjects?: string[];
  primarySubject?: string;
  linkedStudentIds?: string[];
  linkedStudentNames?: string[];
  wardName?: string;
  wardAdmissionNo?: string;
  provisionedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Student {
  id: string;
  admissionNo: string;
  firstName: string;
  middleName?: string;
  surname: string;
  fullName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female';
  classId: string;
  className: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  address: string;
  admissionDate: string;
  passportPhoto?: string;
  status: 'Active' | 'Graduated' | 'Withdrawn';
  feeStatus: 'Paid' | 'Partial' | 'Pending';
  stateOfOrigin: string;
  lga?: string;
  bloodGroup?: string;
  termAverageScore?: number;
  overallPosition?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Teacher {
  id: string;
  staffId: string;
  fullName: string;
  gender: 'Male' | 'Female';
  phone: string;
  email: string;
  address: string;
  qualifications: string; // e.g. B.Ed (Hons) Mathematics, M.Sc Education
  subjects: string[]; // e.g. ["Mathematics", "Further Mathematics"]
  assignedClasses: string[]; // e.g. ["JSS 1A", "JSS 2B", "SS 1A"]
  roleType: 'Head of Department' | 'Form Teacher' | 'Subject Teacher' | 'Vice Principal';
  employmentDate: string;
  employmentStatus: 'Active' | 'On Leave' | 'Deactivated';
  createdAt?: string;
  updatedAt?: string;
}

export type SchoolSection =
  | 'Creche'
  | 'Nursery'
  | 'Primary'
  | 'Junior Secondary'
  | 'Senior Secondary';

export interface SchoolClass {
  id: string;
  name: string; // e.g. "Creche", "Nursery 1", "Primary 3", "JSS 1A", "SS 2A"
  section?: SchoolSection;
  level: string; // e.g. "Creche", "Nursery 1", "Primary 3", "JSS 1", "SS 2"
  arm: string; // e.g. "Standard", "A", "B"
  formTeacherName: string;
  formTeacherId: string;
  capacity: number;
  totalStudents: number;
  roomNumber: string;
  subjects?: string[];
  isActive?: boolean;
  sortOrder?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionTermConfig {
  name: AcademicTerm;
  isActive: boolean;
  startDate: string;
  endDate: string;
  nextTermResumption: string;
}

export interface AcademicSession {
  id: string;
  name: string; // e.g. "2026/2027 Session"
  isActive: boolean;
  startDate: string;
  endDate: string;
  terms: SessionTermConfig[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AssessmentComponent {
  id: string;
  key: string; // e.g. "ca1", "ca2", "exam"
  label: string; // e.g. "CA 1", "CA 2", "Terminal Exam"
  maxMark: number;
  isExam?: boolean;
}

export interface GradeBoundary {
  grade: string; // e.g. "A1", "B2", ...
  minScore: number; // percentage 0..100
  maxScore: number; // percentage 0..100
  remark: string;
}

export type RankingPolicy = 'standard_competition' | 'dense';

export interface AcademicConfig {
  id: string;
  components: AssessmentComponent[];
  gradingScale: GradeBoundary[];
  rankingPolicy: RankingPolicy;
  updatedBy?: string;
  updatedAt?: string;
}

export interface SubjectTeacherAssignment {
  id: string;
  className: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  teacherEmail?: string;
  updatedAt?: string;
}

export type ResultApprovalStatus =
  | 'Draft'
  | 'Submitted for Review'
  | 'Approved'
  | 'Returned for Correction';

export interface StudentResultReview {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  className: string;
  term: AcademicTerm;
  session: string;
  status: ResultApprovalStatus;
  teacherComment: string;
  teacherCommentBy?: string;
  teacherCommentAt?: string;
  headComment?: string;
  headCommentBy?: string;
  headCommentTitle?: HeadTeacherTitle;
  headCommentAt?: string;
  headSignature?: string;
  principalComment: string;
  principalCommentBy?: string;
  principalCommentAt?: string;
  principalSignature?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  returnNote?: string;
  updatedAt?: string;
}

export interface AttendanceCorrectionLog {
  correctedBy: string;
  correctedByUid?: string;
  correctedAt: string;
  reason: string;
  oldStatus: 'Present' | 'Absent' | 'Late' | 'Excused';
  newStatus: 'Present' | 'Absent' | 'Late' | 'Excused';
  oldRemark?: string;
  newRemark?: string;
}

export interface AttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  classId: string;
  className: string;
  term: AcademicTerm;
  session: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  status: 'Present' | 'Absent' | 'Late' | 'Excused';
  remark?: string;
  markedBy?: string;
  markedByUid?: string;
  updatedBy?: string;
  updatedByUid?: string;
  correctionReason?: string;
  correctionHistory?: AttendanceCorrectionLog[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademicRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  className: string;
  term: AcademicTerm;
  session: string;
  subject: string;
  ca1: number;
  ca2: number;
  exam: number;
  componentScores?: Record<string, number>;
  total: number;
  maxTotal?: number;
  percentage?: number;
  grade: string;
  remark: string;
  enteredBy?: string;
  isApproved?: boolean;
  updatedAt?: string;
}

export interface FeeInvoice {
  id: string;
  invoiceNo: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  term: AcademicTerm;
  session: string;
  feeType: 'Tuition Fee' | 'PTA Development Levy' | 'ICT & STEM Fee' | 'Books & Uniform' | 'Science Lab Fee';
  amountDue: number; // In Naira (₦)
  amountPaid: number; // In Naira (₦)
  balance: number; // In Naira (₦)
  status: 'Paid' | 'Partial' | 'Pending';
  paymentMethod?: 'Bank Transfer' | 'POS' | 'Cash' | 'Remita / Paystack';
  transactionRef?: string;
  dueDate: string;
  lastPaymentDate?: string;
}

export type ManualPaymentMethod =
  | 'Bank Transfer'
  | 'POS'
  | 'Cash'
  | 'Cheque'
  | 'Bank Teller / Deposit';

export interface FeeCategory {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeeScheduleItem {
  id: string;
  session: string;
  term: AcademicTerm;
  className: string;
  categoryId: string;
  categoryName: string;
  amount: number; // In Naira (₦)
  dueDate: string;
  isMandatory: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface StudentFee {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  className: string;
  session: string;
  term: AcademicTerm;
  categoryId: string;
  categoryName: string;
  amountDue: number; // In Naira (₦)
  amountPaid: number; // In Naira (₦) - derived strictly from saved FeePayment records
  balance: number; // In Naira (₦)
  status: 'Paid' | 'Partial' | 'Pending';
  dueDate: string;
  assignedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeePayment {
  id: string;
  receiptNo: string;
  studentFeeId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  className: string;
  session: string;
  term: AcademicTerm;
  categoryId: string;
  categoryName: string;
  amount: number; // In Naira (₦)
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: ManualPaymentMethod;
  transactionRef: string;
  notes?: string;
  recordedBy: string;
  recordedByUid: string;
  createdAt: string;
  isEdited?: boolean;
  editedAt?: string;
  editedBy?: string;
  editReason?: string;
  isVoided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidedByUid?: string;
  voidReason?: string;
}

export interface FeeDeletionLog {
  id: string;
  deletionType: 'payment' | 'fee_item';
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  session: string;
  term: AcademicTerm;
  studentFeeId: string;
  categoryId: string;
  categoryName: string;
  paymentId?: string;
  receiptNo: string;
  amount: number;
  expectedAmount?: number;
  paidAmount?: number;
  paymentMethod?: ManualPaymentMethod;
  paymentDate?: string;
  reason: string;
  deletedBy: string;
  deletedByUid: string;
  deletedAt: string;
}

export type FeeAuditActionType =
  | 'edit_payment'
  | 'edit_expected_amount'
  | 'edit_due_date'
  | 'void_payment'
  | 'delete_fee_item';

export interface FeeAuditValueSnapshot {
  expectedAmount?: number;
  paidAmount?: number;
  balance?: number;
  status?: string;
  dueDate?: string;
  amount?: number;
  paymentDate?: string;
  paymentMethod?: ManualPaymentMethod;
  notes?: string;
  receiptNo?: string;
}

export interface FeeAuditLog {
  id: string;
  actionType: FeeAuditActionType;
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  session: string;
  term: AcademicTerm;
  studentFeeId: string;
  categoryId: string;
  categoryName: string;
  paymentId?: string;
  receiptNo: string;
  reason: string;
  oldValues: FeeAuditValueSnapshot;
  newValues: FeeAuditValueSnapshot;
  performedBy: string;
  performedByUid: string;
  performedAt: string;
}

export interface TimetableSlot {
  id: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
  period: number;
  timeRange: string; // e.g., "08:15 AM - 09:00 AM"
  className: string;
  subject: string;
  teacherName: string;
  room: string;
  isBreak?: boolean;
}

export type AnnouncementCategory =
  | 'Academic'
  | 'PTA Meeting'
  | 'Finance'
  | 'Holiday'
  | 'Resumption Date'
  | 'Examination Schedule'
  | 'Sports & Events'
  | 'General Notice';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  targetAudience: 'All' | 'Teachers' | 'Parents' | 'Students' | 'Specific Classes';
  targetClasses?: string[];
  priority: 'Normal' | 'High' | 'Urgent';
  authorName: string;
  authorRole: string;
  term: AcademicTerm;
  session: string;
  date: string; // Publication date YYYY-MM-DD
  publishDate?: string; // Scheduled publication date YYYY-MM-DD
  status?: 'Published' | 'Scheduled' | 'Archived';
  category: AnnouncementCategory;
  eventStartDate?: string;
  eventEndDate?: string;
  createdByUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CalendarEventType =
  | 'Examination Schedule'
  | 'Resumption Date'
  | 'Holiday'
  | 'Mid-Term Break'
  | 'PTA Meeting'
  | 'School Event';

export interface SchoolCalendarEvent {
  id: string;
  title: string;
  eventType: CalendarEventType;
  session: string;
  term: AcademicTerm;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  targetAudience: 'All' | 'Parents' | 'Specific Classes';
  targetClasses?: string[];
  description?: string;
  publishedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SchoolSetting {
  schoolName: string;
  schoolTagline: string;
  motto: string;
  address: string;
  state: string;
  phone: string;
  email: string;
  website: string;
  currentTerm: AcademicTerm;
  currentSession: string;
  termBegins: string;
  termEnds: string;
  nextTermResumption: string;
  currency: string;
  currencySymbol: string;
  directorName: string;
  principalName: string;
  headTeacherTitle?: HeadTeacherTitle;
  headTeacherName?: string;
  headTeacherSignature?: string;
  principalSignature?: string;
  enableTeacherComment?: boolean;
  enableHeadComment?: boolean;
  enablePrincipalComment?: boolean;
  logoDataUrl?: string;
  logoUpdatedAt?: string;
  logoUpdatedBy?: string;
  updatedAt?: string;
}

export interface PublicSchoolBranding {
  schoolName: string;
  motto?: string;
  logoDataUrl?: string;
  website?: string;
  updatedAt?: string;
}
