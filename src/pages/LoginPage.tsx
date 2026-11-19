import React, { useState } from 'react';
import {
  GraduationCap,
  Lock,
  Mail,
  Database,
  CheckCircle2,
  AlertCircle,
  UserPlus,
  LogIn,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Send,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SchoolLogo } from '../components/common/SchoolLogo';

export const LoginPage: React.FC<{ onLoginSuccess: () => void }> = ({ onLoginSuccess }) => {
  const {
    currentUser,
    role,
    needsEmailVerification,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    resendVerificationEmail,
    refreshAuthVerification,
    sendPasswordReset,
    firebaseUser,
    signOutUser,
    isFirebaseConnected,
    authNotice,
    clearAuthNotice,
    schoolSettings,
  } = useAuth();

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');

  // Form Fields
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Feedback State
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGoogleAuth = async () => {
    if (isSubmitting) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    clearAuthNotice();
    setIsSubmitting(true);
    try {
      const res = await signInWithGoogle();
      if (res.success) {
        onLoginSuccess();
      } else if (res.error) {
        setErrorMsg(res.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Firebase Google Sign-in could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    const res = await resendVerificationEmail();
    setIsSubmitting(false);
    if (res.success) {
      setSuccessMsg(
        `Verification link re-sent to ${firebaseUser?.email}. Check your inbox and spam folder.`
      );
    } else {
      setErrorMsg(res.error || 'Could not send verification email.');
    }
  };

  const handleCheckVerification = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    const res = await refreshAuthVerification();
    setIsSubmitting(false);
    if (res.success && res.verified) {
      setSuccessMsg('Email verified! Opening SchoolDesk...');
      setTimeout(() => onLoginSuccess(), 250);
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    clearAuthNotice();

    if (!emailInput.trim()) {
      setErrorMsg('Please enter your email address.');
      return;
    }

    if (authMode === 'reset') {
      setIsSubmitting(true);
      const resetRes = await sendPasswordReset(emailInput);
      setIsSubmitting(false);
      if (resetRes.success) {
        setSuccessMsg(
          `Password reset link sent to ${emailInput.trim()}. Please check your inbox and spam folder.`
        );
      } else {
        setErrorMsg(resetRes.error || 'Could not send password reset email.');
      }
      return;
    }

    if (!passwordInput) {
      setErrorMsg('Please enter your password.');
      return;
    }

    if (passwordInput.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);

    if (authMode === 'login') {
      const result = await signInWithEmail(emailInput, passwordInput);
      if (result.success) {
        setSuccessMsg('Authenticated with Firebase Authentication.');
        setTimeout(() => onLoginSuccess(), 250);
      } else if (result.needsVerification) {
        setSuccessMsg(
          'Your account requires email verification. Click the verification link sent to your email or resend below.'
        );
      } else {
        setErrorMsg(result.error || 'Login failed. Please verify your email and password.');
      }
    } else {
      if (!displayNameInput.trim()) {
        setErrorMsg('Please enter your full name.');
        setIsSubmitting(false);
        return;
      }

      if (passwordInput !== confirmPasswordInput) {
        setErrorMsg('Passwords do not match. Please re-enter your password.');
        setIsSubmitting(false);
        return;
      }

      const result = await signUpWithEmail(
        emailInput,
        passwordInput,
        displayNameInput,
        'parent',
        { phone: phoneInput.trim() || undefined }
      );

      if (result.success && result.needsVerification) {
        setSuccessMsg(
          `Account created! A verification email has been sent to ${emailInput.trim()}. Verify your email to activate access.`
        );
      } else if (result.success) {
        onLoginSuccess();
      } else {
        setErrorMsg(result.error || 'Registration failed.');
      }
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-[88vh] flex items-center justify-center p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white rounded-[10px] shadow-[0_2px_6px_rgba(42,42,46,0.05),0_12px_32px_rgba(42,42,46,0.07)] border border-[#E6DFD3] overflow-hidden">
        {/* Left Brand Panel */}
        <div className="lg:col-span-5 bg-gradient-to-br from-[#6B1020] via-[#630E1D] to-[#4E0A16] p-8 text-[#F7F4EF] flex flex-col justify-between relative overflow-hidden">
          {schoolSettings.logoDataUrl && (
            <img
              src={schoolSettings.logoDataUrl}
              alt=""
              aria-hidden="true"
              className="pointer-events-none select-none absolute -right-10 -bottom-10 w-52 h-52 object-contain opacity-[0.06]"
            />
          )}

          <div className="relative z-10">
            <div className="flex items-center gap-3.5 pb-5 border-b border-[#B8913A]/45 mb-6">
              <SchoolLogo
                logoDataUrl={schoolSettings.logoDataUrl}
                schoolName={schoolSettings.schoolName}
                size="lg"
                variant="light"
              />
              <div className="min-w-0">
                <h1 className="font-serif text-lg sm:text-xl font-semibold tracking-tight leading-snug text-white">
                  {schoolSettings.schoolName}
                </h1>
                <p className="text-xs italic text-[#DFC484] truncate mt-0.5">
                  {schoolSettings.motto || 'SchoolDesk Management Portal'}
                </p>
              </div>
            </div>

            <div className="space-y-4 my-6">
              <div className="bg-[#4E0A16]/55 p-4 rounded-[10px] border border-[#B8913A]/35">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#DFC484]">
                  Role-Based Access Control (RBAC)
                </p>
                <p className="text-sm font-semibold text-white mt-1">
                  Director • Principal • Teacher • Parent
                </p>
                <p className="text-xs text-[#F7F4EF]/75 mt-1 leading-relaxed">
                  Enforced cryptographically by Cloud Firestore Security Rules
                </p>
              </div>

              <div className="space-y-2.5 text-xs text-[#F7F4EF]/85">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#DFC484] shrink-0" />
                  <span>Verified Firebase Email/Password & Google sign-in</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#DFC484] shrink-0" />
                  <span>Protected Director provisioning & invite-based staff onboarding</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#DFC484] shrink-0" />
                  <span>Teacher class scoping & private Parent ward isolation</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-5 border-t border-[#B8913A]/35 flex items-center justify-between text-[11px] text-[#F7F4EF]/75">
            <span className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#DFC484]" />
              Firestore: {isFirebaseConnected ? 'Ready & Online' : 'Connecting'}
            </span>
            <span>Auth: Firebase</span>
          </div>
        </div>

        {/* Right Authentication Panel */}
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center bg-white">
          {needsEmailVerification && firebaseUser ? (
            <div className="space-y-5">
              <div className="w-11 h-11 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] flex items-center justify-center">
                <Mail className="w-5 h-5" />
              </div>

              <div>
                <h2 className="text-xl font-semibold text-[#2A2A2E] tracking-tight">
                  Verify Your Email Address
                </h2>
                <p className="text-sm text-[#5E5B56] mt-2 leading-relaxed">
                  To protect student, staff, and financial records, SchoolDesk requires a verified
                  email address before unlocking database access. We sent a verification link to{' '}
                  <strong className="text-[#2A2A2E]">{firebaseUser.email}</strong>.
                </p>
              </div>

              {(errorMsg || authNotice) && (
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#86222E] mt-0.5" />
                  <span className="leading-relaxed">{errorMsg || authNotice}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2A583B]" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="p-4 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs text-[#5E5B56] space-y-1.5">
                <p className="font-semibold text-[#2A2A2E]">Next steps:</p>
                <p>1. Open the verification email in your inbox (or Spam/Junk folder).</p>
                <p>2. Click the confirmation link.</p>
                <p>3. Return here and click &quot;I Have Verified My Email&quot;.</p>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleCheckVerification}
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-sm transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
                  I Have Verified My Email — Continue
                </button>

                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium text-xs transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  Resend Verification Email
                </button>

                <button
                  type="button"
                  onClick={signOutUser}
                  disabled={isSubmitting}
                  className="w-full py-2 px-4 rounded-[8px] text-[#5E5B56] hover:text-[#86222E] hover:bg-[#FAF0F2] font-medium text-xs transition-colors duration-150 flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out / Use a Different Account
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-[#2A2A2E] tracking-tight">
                  {authMode === 'login'
                    ? 'Sign In to SchoolDesk'
                    : authMode === 'register'
                      ? 'Create a SchoolDesk Account'
                      : 'Reset Your Password'}
                </h2>
                <p className="text-sm text-[#6E6A63] mt-1">
                  {authMode === 'login'
                    ? 'Sign in with your verified Firebase Email & Password or Google account to access live school data.'
                    : authMode === 'register'
                      ? 'Register your account. Invited staff automatically receive their Director-assigned role after email verification.'
                      : 'Enter your registered email address to receive a Firebase password reset link.'}
                </p>
              </div>

              {(errorMsg || authNotice) && (
                <div className="mb-4 p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#86222E] mt-0.5" />
                  <div className="flex-1 leading-relaxed">
                    <span className="font-semibold block mb-0.5">Authentication Notice</span>
                    {errorMsg || authNotice}
                  </div>
                  {authNotice && !errorMsg && (
                    <button
                      type="button"
                      onClick={clearAuthNotice}
                      className="text-[11px] font-semibold underline shrink-0"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {successMsg && (
                <div className="mb-4 p-3.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#2A583B]" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="space-y-4">
                <form onSubmit={handleEmailAuthSubmit} className="space-y-3.5">
                  {authMode === 'register' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[#5E5B56] mb-1">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Mrs. Folashade Balogun"
                          value={displayNameInput}
                          onChange={(e) => setDisplayNameInput(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#5E5B56] mb-1">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          placeholder="+234 803 000 0000"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[#5E5B56] mb-1">
                      Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-3 text-[#7F7A72]" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="name@school.edu.ng"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                      />
                    </div>
                  </div>

                  {authMode !== 'reset' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-[#5E5B56]">
                          Password *
                        </label>
                        {authMode === 'login' && (
                          <button
                            type="button"
                            onClick={() => {
                              setAuthMode('reset');
                              setErrorMsg(null);
                              setSuccessMsg(null);
                            }}
                            className="text-[11px] font-medium text-[#6B1020] hover:underline"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 absolute left-3 top-3 text-[#7F7A72]" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete={
                            authMode === 'login' ? 'current-password' : 'new-password'
                          }
                          placeholder="••••••••"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          className="w-full pl-9 pr-10 py-2 text-sm border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-2.5 text-[#7F7A72] hover:text-[#2A2A2E] transition-colors duration-150"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {authMode === 'register' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-[#5E5B56] mb-1">
                          Confirm Password *
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 absolute left-3 top-3 text-[#7F7A72]" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            autoComplete="new-password"
                            placeholder="••••••••"
                            value={confirmPasswordInput}
                            onChange={(e) => setConfirmPasswordInput(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                          />
                        </div>
                      </div>

                      <div className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs text-[#2A2A2E] flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#6B1020] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[#2A2A2E]">Role Provisioning Policy</p>
                          <p className="text-[11px] text-[#6E6A63] mt-0.5 leading-relaxed">
                            Self-registration requires email verification and defaults to Parent /
                            Guardian access. If the School Director pre-provisioned your email in
                            Settings, your assigned staff role applies automatically upon verification.
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 px-4 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-sm transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      'Authenticating...'
                    ) : authMode === 'login' ? (
                      <>
                        <LogIn className="w-4 h-4" />
                        Sign In with Email & Password
                      </>
                    ) : authMode === 'register' ? (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Create Account
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        Send Password Reset Link
                      </>
                    )}
                  </button>
                </form>

                {/* Mode Toggle */}
                <div className="text-center text-xs text-[#6E6A63]">
                  {authMode === 'login' ? (
                    <span>
                      New parent or invited staff?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('register');
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className="text-[#6B1020] font-semibold hover:underline"
                      >
                        Register an account
                      </button>
                    </span>
                  ) : (
                    <span>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className="text-[#6B1020] font-semibold hover:underline"
                      >
                        Back to Sign In
                      </button>
                    </span>
                  )}
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="grow border-t border-[#E6DFD3]"></div>
                  <span className="shrink mx-4 text-[11px] text-[#7F7A72] uppercase font-medium tracking-wider">
                    Parent Portal &amp; Google Sign-In
                  </span>
                  <div className="grow border-t border-[#E6DFD3]"></div>
                </div>

                <div className="p-3.5 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2.5">
                  <div className="text-xs">
                    <p className="font-semibold text-[#2A2A2E]">
                      Parents &amp; Guardians — View Your Children&apos;s Report Cards
                    </p>
                    <p className="text-[11px] text-[#6E6A63] mt-0.5 leading-relaxed">
                      Sign in with the Google (Gmail) account registered as Parent Email on your child&apos;s school profile.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF0F2] hover:border-[#DFC7CA] text-[#2A2A2E] text-sm font-medium transition-colors duration-150 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    Sign in with Google
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Session Status Footer (Shown when verified & signed in) */}
          {firebaseUser?.emailVerified && currentUser && (
            <div className="mt-6 pt-4 border-t border-[#EFE9DF] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E6A63]">
              <div>
                <span>
                  Signed In: <strong className="text-[#2A2A2E]">{currentUser.displayName}</strong>
                </span>
                <span className="block text-[11px] text-[#7F7A72] capitalize">
                  Role: <strong>{role}</strong> • Live Verified Session
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={signOutUser}
                  className="text-[#86222E] hover:underline font-medium"
                >
                  Sign Out
                </button>
                <button
                  type="button"
                  onClick={onLoginSuccess}
                  className="text-[#6B1020] font-semibold hover:underline"
                >
                  Go to Dashboard →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
