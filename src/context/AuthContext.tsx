import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  User as FirebaseUser,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, testFirestoreConnection } from '../firebase/config';
import { PublicSchoolBranding, SchoolSetting, StaffInvite, UserProfile, UserRole } from '../types';
import { INITIAL_SCHOOL_SETTINGS } from '../data/sampleData';
import { subscribeSchoolSettings } from '../services/settingsAndTimetableService';
import { subscribePublicBranding } from '../services/brandingService';
import { syncStandardClassesToFirestore } from '../services/academicService';
import { getProfileSubjects } from '../utils/classUtils';

// Director primary master email
export const DIRECTOR_MASTER_EMAIL = 'patrickpercy1989@gmail.com';

export function toInviteDocId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  Object.entries(obj).forEach(([key, val]) => {
    if (val !== undefined) {
      result[key] = val;
    }
  });
  return result as T;
}

interface AuthContextType {
  currentUser: UserProfile | null;
  firebaseUser: FirebaseUser | null;
  role: UserRole;
  isActive: boolean;
  isLoading: boolean;
  isFirebaseConnected: boolean;
  needsEmailVerification: boolean;
  registeredUsers: UserProfile[];
  staffInvites: StaffInvite[];
  authNotice: string | null;
  clearAuthNotice: () => void;
  schoolSettings: SchoolSetting;
  isSchoolSettingsPersisted: boolean;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string; cancelled?: boolean }>;
  signInWithEmail: (
    email: string,
    pass: string
  ) => Promise<{ success: boolean; error?: string; needsVerification?: boolean }>;
  signUpWithEmail: (
    email: string,
    pass: string,
    displayName: string,
    role?: UserRole,
    extra?: Partial<UserProfile>
  ) => Promise<{
    success: boolean;
    error?: string;
    assignedRole?: UserRole;
    needsVerification?: boolean;
  }>;
  resendVerificationEmail: () => Promise<{ success: boolean; error?: string }>;
  refreshAuthVerification: () => Promise<{
    success: boolean;
    verified: boolean;
    error?: string;
  }>;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  signOutUser: () => Promise<void>;
  // Director-only management methods
  createStaffAccount: (
    staffData: Omit<UserProfile, 'uid'> & { password?: string }
  ) => Promise<{ success: boolean; error?: string; targetCollection?: 'users' | 'staffInvites' }>;
  updateUserRoleAndStatus: (
    targetUid: string,
    updates: Partial<UserProfile>
  ) => Promise<{ success: boolean; error?: string }>;
  toggleAccountStatus: (
    targetUid: string,
    newStatus: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  updateStaffInvite: (
    inviteId: string,
    updates: Partial<StaffInvite>
  ) => Promise<{ success: boolean; error?: string }>;
  toggleStaffInviteStatus: (
    inviteId: string,
    newStatus: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  deleteStaffInvite: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState<boolean>(false);
  const [registeredUsers, setRegisteredUsers] = useState<UserProfile[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [publicBranding, setPublicBranding] = useState<PublicSchoolBranding | null>(null);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSetting>(INITIAL_SCHOOL_SETTINGS);
  const [isSchoolSettingsPersisted, setIsSchoolSettingsPersisted] = useState<boolean>(false);

  const pendingDisplayNameRef = useRef<string | null>(null);
  const pendingPhoneRef = useRef<string | null>(null);
  const inFlightProvisionRef = useRef<Map<string, Promise<UserProfile | null>>>(new Map());
  const googleSignInInFlightRef = useRef<boolean>(false);
  const syncedClassesUidRef = useRef<string | null>(null);

  const clearAuthNotice = () => setAuthNotice(null);

  // Ensure browser local persistence and verify Firestore connection on initial boot
  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn('Firebase Auth persistence configuration warning:', err);
    });

    async function initConnection() {
      const connected = await testFirestoreConnection();
      setIsFirebaseConnected(connected);
    }
    initConnection();
  }, []);

  // Resolve or provision /users/{uid} securely against Firestore rules & staffInvites
  // Strictly requires user.emailVerified === true
  const resolveOrCreateUserProfile = async (
    user: FirebaseUser,
    preferredDisplayName?: string,
    preferredPhone?: string
  ): Promise<UserProfile | null> => {
    if (!user.emailVerified) {
      return null;
    }

    const existingPromise = inFlightProvisionRef.current.get(user.uid);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async (): Promise<UserProfile | null> => {
      const userDocRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userDocRef);

      if (docSnap.exists()) {
        const data = docSnap.data() as UserProfile;
        if (data.isActive === false) {
          await signOut(auth);
          setFirebaseUser(null);
          setCurrentUser(null);
          setAuthNotice(
            'This account has been deactivated by the School Director. Please contact school administration.'
          );
          return null;
        }
        return data;
      }

      const normalizedEmail = (user.email || '').trim().toLowerCase();
      const isMasterDirector = normalizedEmail === DIRECTOR_MASTER_EMAIL.toLowerCase();
      const resolvedName =
        (preferredDisplayName || pendingDisplayNameRef.current || user.displayName || '').trim() ||
        normalizedEmail.split('@')[0] ||
        'SchoolDesk User';
      const resolvedPhone = (preferredPhone || pendingPhoneRef.current || user.phoneNumber || '').trim();

      let assignedRole: UserRole = 'parent';
      let inviteId: string | undefined;
      let title = 'Parent / Guardian';
      let assignedClasses: string[] = [];
      let assignedSubjects: string[] = [];
      let subjects: string[] = [];
      let primarySubject: string | undefined;
      let linkedStudentIds: string[] = [];
      let linkedStudentNames: string[] = [];
      let wardName: string | undefined;
      let wardAdmissionNo: string | undefined;
      let phone = resolvedPhone;

      if (isMasterDirector) {
        assignedRole = 'director';
        title = 'Proprietor & Director';
      } else if (normalizedEmail) {
        const candidateInviteId = toInviteDocId(normalizedEmail);
        if (candidateInviteId) {
          try {
            const inviteSnap = await getDoc(doc(db, 'staffInvites', candidateInviteId));
            if (inviteSnap.exists()) {
              const invite = inviteSnap.data() as StaffInvite;
              if (invite.isActive === false) {
                await signOut(auth);
                setFirebaseUser(null);
                setCurrentUser(null);
                setAuthNotice(
                  'Your pre-provisioned staff/parent account invite has been deactivated by the School Director.'
                );
                return null;
              }
              inviteId = inviteSnap.id;
              assignedRole = invite.role;
              title =
                invite.title ||
                (invite.role === 'director'
                  ? 'School Director'
                  : invite.role === 'principal'
                    ? 'Principal'
                    : invite.role === 'head_teacher'
                      ? (schoolSettings.headTeacherTitle || 'Headmaster')
                      : invite.role === 'teacher'
                        ? 'Form / Subject Teacher'
                        : 'Parent / Guardian');
              assignedClasses = invite.assignedClasses || [];
              subjects = getProfileSubjects(invite);
              assignedSubjects = subjects;
              primarySubject = invite.primarySubject || subjects[0] || undefined;
              linkedStudentIds = invite.linkedStudentIds || [];
              linkedStudentNames = invite.linkedStudentNames || [];
              wardName = invite.wardName;
              wardAdmissionNo = invite.wardAdmissionNo;
              if (!phone && invite.phone) {
                phone = invite.phone;
              }
            }
          } catch (inviteErr: any) {
            // Expected when no staffInvite exists for a normal parent due to anti-enumeration rules
            if (inviteErr?.code !== 'permission-denied') {
              console.warn('Staff invite lookup notice:', inviteErr);
            }
          }
        }
      }

      const now = new Date().toISOString();
      const newProfile: UserProfile = stripUndefined({
        uid: user.uid,
        email: normalizedEmail,
        displayName: resolvedName.slice(0, 100),
        role: assignedRole,
        isActive: true,
        inviteId,
        phone: phone ? phone.slice(0, 30) : undefined,
        avatar: user.photoURL || undefined,
        title: title.slice(0, 100),
        assignedClasses,
        assignedSubjects,
        subjects,
        primarySubject,
        linkedStudentIds,
        linkedStudentNames,
        wardName,
        wardAdmissionNo,
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(userDocRef, newProfile);
      pendingDisplayNameRef.current = null;
      pendingPhoneRef.current = null;
      return newProfile;
    })();

    inFlightProvisionRef.current.set(user.uid, promise);
    try {
      return await promise;
    } finally {
      inFlightProvisionRef.current.delete(user.uid);
    }
  };

  // Monitor Firebase Auth session state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setFirebaseUser(user);
        if (!user.emailVerified) {
          setCurrentUser(null);
          setIsLoading(false);
          return;
        }
        try {
          const profile = await resolveOrCreateUserProfile(user);
          if (profile) {
            setCurrentUser(profile);
          }
        } catch (err: any) {
          console.error('Failed to load or provision Firestore user profile:', err);
          setAuthNotice(
            err?.message ||
              'Signed into Firebase Authentication, but Firestore profile verification failed.'
          );
          setCurrentUser(null);
        }
      } else {
        setFirebaseUser(null);
        setCurrentUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to non-PII public branding (school name, motto, logo URL) even before login
  useEffect(() => {
    const unsub = subscribePublicBranding((branding) => {
      setPublicBranding(branding);
    });
    return () => unsub();
  }, []);

  // Keep browser tab title synchronized with configured school name
  useEffect(() => {
    if (schoolSettings.schoolName) {
      document.title = `${schoolSettings.schoolName} — SchoolDesk`;
    }
  }, [schoolSettings.schoolName]);

  // Ensure all standard classes (Creche – SS 3) exist in Firestore without duplicating or deleting existing ones
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
      if (!firebaseUser) {
        syncedClassesUidRef.current = null;
      }
      return;
    }
    if (
      currentUser.isActive === false ||
      (currentUser.role !== 'director' && currentUser.role !== 'principal')
    ) {
      return;
    }
    if (syncedClassesUidRef.current === firebaseUser.uid) {
      return;
    }
    syncedClassesUidRef.current = firebaseUser.uid;
    syncStandardClassesToFirestore().catch((err) => {
      console.warn('Automatic class structure sync skipped:', err);
    });
  }, [firebaseUser, currentUser]);

  // Subscribe to full school settings in Firestore when signed in, verified, and profiled;
  // otherwise expose public branding overlay on top of defaults so LoginPage shows uploaded school logo
  useEffect(() => {
    const brandingOverlay: Partial<SchoolSetting> = publicBranding
      ? {
          schoolName: publicBranding.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName,
          motto: publicBranding.motto ?? INITIAL_SCHOOL_SETTINGS.motto,
          logoDataUrl: publicBranding.logoDataUrl ?? '',
          website: publicBranding.website ?? INITIAL_SCHOOL_SETTINGS.website,
        }
      : {};

    if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
      setSchoolSettings({ ...INITIAL_SCHOOL_SETTINGS, ...brandingOverlay });
      setIsSchoolSettingsPersisted(false);
      return;
    }

    const unsub = subscribeSchoolSettings(
      (liveSettings, persisted) => {
        if (persisted) {
          setSchoolSettings(liveSettings);
        } else {
          setSchoolSettings({ ...liveSettings, ...brandingOverlay });
        }
        setIsSchoolSettingsPersisted(persisted);
      },
      (errMsg) => {
        console.warn('School settings sync warning:', errMsg);
      }
    );
    return () => unsub();
  }, [firebaseUser, currentUser, publicBranding]);

  // Sync registered users & invites from Firestore for Director / Principal
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
      setRegisteredUsers([]);
      setStaffInvites([]);
      return;
    }

    const isMaster =
      firebaseUser.email?.toLowerCase() === DIRECTOR_MASTER_EMAIL.toLowerCase();
    const canListUsers =
      currentUser.role === 'director' || currentUser.role === 'principal' || isMaster;

    if (!canListUsers) {
      setRegisteredUsers([currentUser]);
      setStaffInvites([]);
      return;
    }

    const unsubs: Array<() => void> = [];

    try {
      const usersUnsub = onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
          const list: UserProfile[] = [];
          snapshot.forEach((d) => {
            list.push(d.data() as UserProfile);
          });
          setRegisteredUsers(list);
        },
        (error) => {
          console.warn('Live users list sync warning:', error.message);
        }
      );
      unsubs.push(usersUnsub);

      if (currentUser.role === 'director' || isMaster) {
        const invitesUnsub = onSnapshot(
          collection(db, 'staffInvites'),
          (snapshot) => {
            const list: StaffInvite[] = [];
            snapshot.forEach((d) => {
              list.push({ id: d.id, ...(d.data() as Omit<StaffInvite, 'id'>) });
            });
            setStaffInvites(list);
          },
          (error) => {
            console.warn('Live staff invites sync warning:', error.message);
          }
        );
        unsubs.push(invitesUnsub);
      } else {
        setStaffInvites([]);
      }
    } catch (err) {
      console.warn('Error setting up users/invites listeners:', err);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, currentUser]);

  // Translate Firebase auth error codes to clear human messages
  const parseAuthError = (code: string, originalMessage: string): string => {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email address or password. Please verify your credentials or reset your password.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is not yet enabled in the Firebase Console for this project. Enable Authentication > Sign-in method > Email/Password, or use Google Sign-In.';
      case 'auth/email-already-in-use':
        return 'An account with this email address already exists in Firebase Authentication. Switch to Sign In instead.';
      case 'auth/weak-password':
        return 'The password is too weak. Please choose a password with at least 6 characters.';
      case 'auth/invalid-email':
        return 'The email address format is invalid. Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled in Firebase Authentication.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts or verification requests. Please wait a few minutes before trying again.';
      case 'auth/popup-blocked':
        return 'Pop-up sign-in was blocked by your browser. Please allow pop-ups for this site and try again, or sign in using Email & Password.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Google sign-in window was closed before completing authentication. Please try again and keep the popup open until sign-in finishes.';
      case 'auth/unauthorized-domain':
        return 'This app domain is not yet added under Firebase Console > Authentication > Settings > Authorized domains.';
      case 'auth/network-request-failed':
        return 'Network connection failure. Please check your internet connection.';
      default:
        return originalMessage || 'Authentication failed. Please try again.';
    }
  };

  // 1. Email & Password Sign In
  const signInWithEmail = async (email: string, pass: string) => {
    setAuthNotice(null);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), pass);
      const user = userCredential.user;
      setFirebaseUser(user);

      if (!user.emailVerified) {
        setCurrentUser(null);
        return {
          success: false,
          needsVerification: true,
          error:
            'Your email address has not been verified yet. Please click the verification link in your inbox or request a new link below.',
        };
      }

      const profile = await resolveOrCreateUserProfile(user);
      if (!profile) {
        return {
          success: false,
          error: 'This account has been deactivated by the School Director.',
        };
      }
      setCurrentUser(profile);
      return { success: true };
    } catch (err: any) {
      console.error('Email sign-in error:', err);
      return { success: false, error: parseAuthError(err.code || '', err.message) };
    }
  };

  // 2. Email & Password Registration (enforces verification before Firestore access)
  const signUpWithEmail = async (
    email: string,
    pass: string,
    displayName: string,
    _requestedRole?: UserRole,
    extra?: Partial<UserProfile>
  ) => {
    setAuthNotice(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();
    pendingDisplayNameRef.current = trimmedName;
    pendingPhoneRef.current = extra?.phone?.trim() || null;

    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, pass);
      const user = userCredential.user;

      if (trimmedName) {
        await updateProfile(user, { displayName: trimmedName });
      }

      await sendEmailVerification(user);
      setFirebaseUser(user);
      setCurrentUser(null);

      return {
        success: true,
        needsVerification: true,
      };
    } catch (err: any) {
      pendingDisplayNameRef.current = null;
      pendingPhoneRef.current = null;
      console.error('Email signup error:', err);
      return { success: false, error: parseAuthError(err.code || '', err.message) };
    }
  };

  // Resend verification email for currently signed-in unverified account
  const resendVerificationEmail = async (): Promise<{ success: boolean; error?: string }> => {
    const active = auth.currentUser;
    if (!active) {
      return { success: false, error: 'No active account session found. Please sign in again.' };
    }
    try {
      await sendEmailVerification(active);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: parseAuthError(err.code || '', err.message) };
    }
  };

  // Reload Firebase Auth token & provision Firestore profile once verified
  const refreshAuthVerification = async (): Promise<{
    success: boolean;
    verified: boolean;
    error?: string;
  }> => {
    const active = auth.currentUser;
    if (!active) {
      return {
        success: false,
        verified: false,
        error: 'Session expired. Please sign in again.',
      };
    }
    try {
      await active.reload();
      await active.getIdToken(true);
      const refreshed = auth.currentUser;
      if (!refreshed || !refreshed.emailVerified) {
        return {
          success: true,
          verified: false,
          error:
            'Your email address is not marked as verified yet. Please click the verification link in your inbox (check Spam/Junk too), then try again.',
        };
      }
      setFirebaseUser(refreshed);
      const profile = await resolveOrCreateUserProfile(refreshed);
      if (!profile) {
        return {
          success: false,
          verified: true,
          error: 'This account or invite has been deactivated by the School Director.',
        };
      }
      setCurrentUser(profile);
      return { success: true, verified: true };
    } catch (err: any) {
      return {
        success: false,
        verified: false,
        error: parseAuthError(err.code || '', err.message),
      };
    }
  };

  // 3. Password Reset Email
  const sendPasswordReset = async (email: string) => {
    const trimmed = email.trim();
    if (!trimmed) {
      return { success: false, error: 'Please enter your email address first.' };
    }
    try {
      await sendPasswordResetEmail(auth, trimmed);
      return { success: true };
    } catch (err: any) {
      console.error('Password reset error:', err);
      return { success: false, error: parseAuthError(err.code || '', err.message) };
    }
  };

  // 4. Google Sign-In via Firebase Auth (must invoke signInWithPopup synchronously in user gesture)
  const signInWithGoogle = async (): Promise<{
    success: boolean;
    error?: string;
    cancelled?: boolean;
  }> => {
    if (googleSignInInFlightRef.current) {
      return {
        success: false,
        cancelled: true,
        error: 'A Google sign-in window is already open. Please complete or close it first.',
      };
    }

    setAuthNotice(null);
    googleSignInInFlightRef.current = true;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      setFirebaseUser(user);
      if (!user.emailVerified) {
        setCurrentUser(null);
        return {
          success: false,
          error: 'Google account email must be verified before accessing SchoolDesk.',
        };
      }
      const profile = await resolveOrCreateUserProfile(user);
      if (!profile) {
        return {
          success: false,
          error: 'This account has been deactivated by the School Director.',
        };
      }
      setCurrentUser(profile);
      return { success: true };
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return {
          success: false,
          cancelled: true,
          error:
            'Google sign-in window was closed before completing authentication. Please try again, or sign in with Email & Password.',
        };
      }
      console.warn('Google Sign-in warning:', code || error?.message);
      return {
        success: false,
        error: parseAuthError(code, error?.message || 'Google sign-in failed.'),
      };
    } finally {
      googleSignInInFlightRef.current = false;
    }
  };

  // 5. Logout Function
  const signOutUser = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch (err) {
      console.error('Error signing out:', err);
    } finally {
      setFirebaseUser(null);
      setCurrentUser(null);
    }
  };

  const isCallerDirector =
    Boolean(firebaseUser?.emailVerified) &&
    (currentUser?.role === 'director' ||
      firebaseUser?.email?.toLowerCase() === DIRECTOR_MASTER_EMAIL.toLowerCase());

  // 6. Director-Only Action: Provision User / Invite in Firestore
  const createStaffAccount = async (
    staffData: Omit<UserProfile, 'uid'> & { password?: string }
  ): Promise<{ success: boolean; error?: string; targetCollection?: 'users' | 'staffInvites' }> => {
    if (!isCallerDirector) {
      return {
        success: false,
        error:
          'Unauthorized: Only an authenticated School Director can provision staff or parent accounts.',
      };
    }

    const normalizedEmail = staffData.email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { success: false, error: 'A valid email address is required.' };
    }

    try {
      const now = new Date().toISOString();
      const existingUser = registeredUsers.find(
        (u) => u.email.trim().toLowerCase() === normalizedEmail
      );

      const teacherSubjects =
        staffData.role === 'teacher' ? getProfileSubjects(staffData) : [];
      const primarySub =
        staffData.role === 'teacher' ? teacherSubjects[0] || '' : '';

      if (existingUser) {
        const updates = stripUndefined({
          displayName: staffData.displayName.trim(),
          role: staffData.role,
          title: staffData.title?.trim() || existingUser.title,
          phone: staffData.phone?.trim() || existingUser.phone,
          assignedClasses: staffData.role === 'teacher' ? staffData.assignedClasses || [] : [],
          assignedSubjects: teacherSubjects,
          subjects: teacherSubjects,
          primarySubject: primarySub,
          linkedStudentIds: staffData.role === 'parent' ? staffData.linkedStudentIds || [] : [],
          linkedStudentNames: staffData.role === 'parent' ? staffData.linkedStudentNames || [] : [],
          wardName: staffData.role === 'parent' ? staffData.wardName : undefined,
          wardAdmissionNo: staffData.role === 'parent' ? staffData.wardAdmissionNo : undefined,
          updatedAt: now,
        });

        await updateDoc(doc(db, 'users', existingUser.uid), updates);
        return { success: true, targetCollection: 'users' };
      }

      const inviteId = toInviteDocId(normalizedEmail);
      if (!inviteId) {
        return { success: false, error: 'Email could not produce a valid Firestore invite ID.' };
      }

      const inviteDoc: StaffInvite = stripUndefined({
        id: inviteId,
        email: normalizedEmail,
        displayName: staffData.displayName.trim(),
        role: staffData.role,
        isActive: true,
        phone: staffData.phone?.trim() || undefined,
        title: staffData.title?.trim() || 'Staff Member',
        assignedClasses: staffData.role === 'teacher' ? staffData.assignedClasses || [] : [],
        assignedSubjects: teacherSubjects,
        subjects: teacherSubjects,
        primarySubject: primarySub || undefined,
        linkedStudentIds: staffData.role === 'parent' ? staffData.linkedStudentIds || [] : [],
        linkedStudentNames: staffData.role === 'parent' ? staffData.linkedStudentNames || [] : [],
        wardName: staffData.role === 'parent' ? staffData.wardName : undefined,
        wardAdmissionNo: staffData.role === 'parent' ? staffData.wardAdmissionNo : undefined,
        provisionedBy: currentUser?.displayName || 'School Director',
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'staffInvites', inviteId), inviteDoc);
      return { success: true, targetCollection: 'staffInvites' };
    } catch (err: any) {
      console.error('Error provisioning staff invite in Firestore:', err);
      return {
        success: false,
        error: err.message || 'Failed to save staff provisioning record to Firestore.',
      };
    }
  };

  // 7. Director-Only Action: Update User Role, Assigned Classes & Ward Linkage
  const updateUserRoleAndStatus = async (targetUid: string, updates: Partial<UserProfile>) => {
    if (!isCallerDirector) {
      return {
        success: false,
        error:
          'Unauthorized: Only an authenticated School Director can assign roles or modify staff permissions.',
      };
    }

    try {
      const userRef = doc(db, 'users', targetUid);
      const normalizedUpdates = { ...updates };
      if (normalizedUpdates.email) {
        normalizedUpdates.email = normalizedUpdates.email.trim().toLowerCase();
      }
      const payload = stripUndefined({
        ...normalizedUpdates,
        updatedAt: new Date().toISOString(),
      });
      await updateDoc(userRef, payload);

      setRegisteredUsers((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, ...payload } : u))
      );
      if (currentUser?.uid === targetUid) {
        setCurrentUser({ ...currentUser, ...payload });
      }

      return { success: true };
    } catch (err: any) {
      console.error('Error updating user role in Firestore:', err);
      return {
        success: false,
        error: err.message || 'Failed to update user profile in database.',
      };
    }
  };

  // 8. Director-Only Action: Activate / Deactivate Account
  const toggleAccountStatus = async (targetUid: string, newStatus: boolean) => {
    if (!isCallerDirector) {
      return {
        success: false,
        error:
          'Unauthorized: Only an authenticated School Director can activate or deactivate accounts.',
      };
    }

    try {
      const userRef = doc(db, 'users', targetUid);
      const updates = {
        isActive: newStatus,
        updatedAt: new Date().toISOString(),
        ...(newStatus === false
          ? {
              deactivatedAt: new Date().toISOString(),
              deactivatedBy: currentUser?.displayName || 'Director',
            }
          : {}),
      };

      await updateDoc(userRef, updates);

      setRegisteredUsers((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, ...updates } : u))
      );
      if (currentUser?.uid === targetUid) {
        setCurrentUser({ ...currentUser, ...updates });
      }

      return { success: true };
    } catch (err: any) {
      console.error('Error toggling account status:', err);
      return {
        success: false,
        error: err.message || 'Failed to update account status in database.',
      };
    }
  };

  // 9. Director-Only Invite Management Actions
  const updateStaffInvite = async (inviteId: string, updates: Partial<StaffInvite>) => {
    if (!isCallerDirector) {
      return { success: false, error: 'Unauthorized: Director permission required.' };
    }
    try {
      const normalizedUpdates = { ...updates };
      if (normalizedUpdates.email) {
        normalizedUpdates.email = normalizedUpdates.email.trim().toLowerCase();
      }
      const payload = stripUndefined({
        ...normalizedUpdates,
        updatedAt: new Date().toISOString(),
      });
      await updateDoc(doc(db, 'staffInvites', inviteId), payload);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update staff invite.' };
    }
  };

  const toggleStaffInviteStatus = async (inviteId: string, newStatus: boolean) => {
    return updateStaffInvite(inviteId, { isActive: newStatus });
  };

  const deleteStaffInvite = async (inviteId: string) => {
    if (!isCallerDirector) {
      return { success: false, error: 'Unauthorized: Director permission required.' };
    }
    try {
      await deleteDoc(doc(db, 'staffInvites', inviteId));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to delete staff invite.' };
    }
  };

  const role: UserRole = currentUser?.role || 'parent';
  const isActive: boolean = currentUser?.isActive !== false;
  const needsEmailVerification = Boolean(firebaseUser && !firebaseUser.emailVerified);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        firebaseUser,
        role,
        isActive,
        isLoading,
        isFirebaseConnected,
        needsEmailVerification,
        registeredUsers,
        staffInvites,
        authNotice,
        clearAuthNotice,
        schoolSettings,
        isSchoolSettingsPersisted,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        resendVerificationEmail,
        refreshAuthVerification,
        sendPasswordReset,
        signOutUser,
        createStaffAccount,
        updateUserRoleAndStatus,
        toggleAccountStatus,
        updateStaffInvite,
        toggleStaffInviteStatus,
        deleteStaffInvite,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
