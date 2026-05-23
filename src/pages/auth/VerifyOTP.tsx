import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../components/ui/NotificationProvider';
import { OTPService } from '../../services/otpService';
import { Smartphone, RefreshCw, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { sendAccountEmail } from '../../utils/accountEmails';

interface VerificationSettings {
  emailRequired: boolean;
  mobileRequired: boolean;
  eitherRequired: boolean;
}

interface ContactInfo {
  email: string;
  mobile: string;
}

interface CompletedVerifications {
  email: boolean;
  mobile: boolean;
}

const VerifyOTP: React.FC = () => {
  const { user, fetchUserData, loading } = useAuth();
  const notification = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [otpService] = useState(() => OTPService.getInstance());

  // Core state
  const [currentUserId, setCurrentUserId] = useState('');
  const [contactInfo, setContactInfo] = useState<ContactInfo>({ email: '', mobile: '' });
  const [verificationSettings, setVerificationSettings] = useState<VerificationSettings>({
    emailRequired: false,
    mobileRequired: false,
    eitherRequired: false
  });
  const [completedVerifications, setCompletedVerifications] = useState<CompletedVerifications>({
    email: false,
    mobile: false
  });

  // OTP state
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpType, setOtpType] = useState<'email' | 'mobile'>('email');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Timer and resend state
  const [resendTimer, setResendTimer] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Progress tracking
  const [verificationProgress, setVerificationProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    stepName: string;
  }>({ currentStep: 1, totalSteps: 1, stepName: 'Verify Account' });

  // Refs for state management
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const componentInitialized = useRef(false);
  const sendingInProgress = useRef(false);
  const mountedRef = useRef(true);
  const sessionRedirectHandledRef = useRef(false);

  const redirectToLoginForMissingSession = useCallback((message: string) => {
    if (sessionRedirectHandledRef.current) return;
    sessionRedirectHandledRef.current = true;

    const isIntentionalLogout =
      typeof window !== 'undefined' &&
      sessionStorage.getItem('customer_logout_in_progress') === 'true';

    if (!isIntentionalLogout) {
      notification.showError('Session Expired', 'Your session has expired. Please login again to verify your account.');
    }

    navigate('/customer/login', {
      replace: true,
      state: { returnTo: '/verify-otp', message }
    });
  }, [navigate, notification]);

  // Initialize refs
  useEffect(() => {
    mountedRef.current = true;
    otpRefs.current = otpRefs.current.slice(0, 6);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !user) return;

    if (user.hasActiveSubscription || user.registrationPaid) {
      navigate('/customer/dashboard', { replace: true });
      return;
    }

    if (user.isVerified || user.mobileVerified) {
      navigate('/registration-payment', { replace: true });
    }
  }, [
    loading,
    navigate,
    user?.hasActiveSubscription,
    user?.id,
    user?.isVerified,
    user?.mobileVerified,
    user?.registrationPaid
  ]);

  // Initialize component data - SINGLE INITIALIZATION
  useEffect(() => {
    if (componentInitialized.current) return;
    componentInitialized.current = true;

    const initializeComponent = () => {
      const state = location.state as any;

      if (state) {
        // Coming from some flow with state
        setCurrentUserId(state.userId || user?.id || '');
        setContactInfo({
          email: state.email || user?.email || '',
          mobile: state.mobile || ''
        });

        const settings = state.verificationSettings || {
          emailRequired: false,
          mobileRequired: false,
          eitherRequired: false
        };
        setVerificationSettings(settings);

        // Determine initial OTP type based on settings and available contact info
        let initialType: 'email' | 'mobile' = 'email';

        if (settings.eitherRequired) {
          // For either required, prefer mobile if available, otherwise email
          initialType = (state.mobile && String(state.mobile).trim()) ? 'mobile' : 'email';
        } else if (settings.mobileRequired && !settings.emailRequired) {
          // Mobile-only should never default to email (even if mobile missing)
          initialType = 'mobile';
        } else if (settings.emailRequired && !settings.mobileRequired) {
          initialType = 'email';
        } else if (settings.mobileRequired && state.mobile) {
          initialType = 'mobile';
        } else if (settings.emailRequired && (state.email || user?.email)) {
          initialType = 'email';
        }

        setOtpType(initialType);

        // Update progress
        updateVerificationProgress(settings, completedVerifications);

        // If mobile-only is configured but mobile is unavailable, surface the issue immediately.
        if (!settings.eitherRequired && settings.mobileRequired && !settings.emailRequired) {
          const mobileValue = String(state.mobile || '').trim();
          if (!mobileValue) {
            setError('Mobile verification is required, but no mobile number is available for this account.');
            notification.showError(
              'Mobile Required',
              'Mobile verification is required, but this account has no mobile number. Please add a mobile number to the profile, then try again.'
            );
          }
        }

      } else if (user) {
        // Regular user session
        setCurrentUserId(user.id);
        setContactInfo({
          email: user.email || '',
          mobile: ''
        });
        setOtpType('email');
        console.log('Initialized for existing user with email verification');
      }
    };

    initializeComponent();
  }, [location.state, user]);

  // Monitor for logout - redirect if user gets logged out while on verify page
  useEffect(() => {
    if (componentInitialized.current && currentUserId && !user) {
      console.log('User logged out during verification, redirecting to login');
      redirectToLoginForMissingSession('Session expired. Please login again.');
    }
  }, [user, currentUserId, redirectToLoginForMissingSession]);

  // Update verification progress
  const updateVerificationProgress = useCallback((settings: VerificationSettings, completed: CompletedVerifications) => {
    let totalSteps = 0;
    let currentStep = 1;
    let stepName = 'Verify Account';

    if (settings.eitherRequired) {
      totalSteps = 1;
      stepName = 'Choose Verification Method';
      currentStep = completed.email || completed.mobile ? 1 : 1;
    } else {
      if (settings.emailRequired) totalSteps++;
      if (settings.mobileRequired) totalSteps++;

      if (settings.emailRequired && settings.mobileRequired) {
        if (!completed.email && !completed.mobile) {
          currentStep = 1;
          stepName = 'Verify Email';
        } else if (completed.email && !completed.mobile) {
          currentStep = 2;
          stepName = 'Verify Mobile';
        } else if (!completed.email && completed.mobile) {
          currentStep = 1;
          stepName = 'Verify Email';
        } else {
          currentStep = totalSteps;
          stepName = 'Complete';
        }
      } else if (settings.emailRequired) {
        stepName = 'Verify Email';
      } else if (settings.mobileRequired) {
        stepName = 'Verify Mobile';
      }
    }

    setVerificationProgress({ currentStep, totalSteps, stepName });
  }, []);

  // Timer effect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendTimer > 0 && mountedRef.current) {
      timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendTimer]);

  // Handle OTP input changes
  const handleOtpChange = useCallback((index: number, value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);

    if (!digits) {
      setOtp((currentOtp) => {
        const newOtp = [...currentOtp];
        newOtp[index] = '';
        return newOtp;
      });
      return;
    }

    setOtp((currentOtp) => {
      const newOtp = [...currentOtp];
      digits.split('').forEach((digit, digitIndex) => {
        const targetIndex = index + digitIndex;
        if (targetIndex < newOtp.length) {
          newOtp[targetIndex] = digit;
        }
      });
      return newOtp;
    });

    const nextIndex = Math.min(index + digits.length, 5);
    setTimeout(() => {
      otpRefs.current[nextIndex]?.focus();
    }, 10);
  }, []);

  const fillOtpCode = useCallback((code: string) => {
    const digits = code.replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) return false;

    setOtp(digits.split(''));
    setTimeout(() => {
      otpRefs.current[5]?.focus();
    }, 10);
    return true;
  }, []);

  const handleOtpInput = useCallback((index: number, e: React.FormEvent<HTMLInputElement>) => {
    const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
    if (digits.length > 1) {
      handleOtpChange(index, digits);
    }
  }, [handleOtpChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    fillOtpCode(e.clipboardData.getData('text/plain'));
  }, [fillOtpCode]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handleSendOTP = useCallback(async () => {
    // Check if user is still logged in
    if (!user) {
      console.log('User logged out, redirecting to login');
      redirectToLoginForMissingSession('Please login to continue verification');
      return;
    }

    if (!currentUserId || !contactInfo[otpType] || sendingInProgress.current) {
      console.log('Send OTP blocked:', {
        userId: !!currentUserId,
        contact: !!contactInfo[otpType],
        sending: sendingInProgress.current
      });
      return;
    }

    console.log(`Sending ${otpType} OTP to:`, contactInfo[otpType]);

    setError('');
    setIsResending(true);
    sendingInProgress.current = true;

    try {
      const result = await otpService.sendOTP(currentUserId, contactInfo[otpType], otpType);

      if (!mountedRef.current) return; // Component unmounted

      if (!result.success) {
        throw new Error(result.error || 'Failed to send OTP');
      }

      setOtpSent(true);
      setResendTimer(30);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);

      const contactDisplay = otpType === 'mobile'
          ? contactInfo[otpType].replace(/(.{3}).*(.{4})/, '$1***$2')
          : contactInfo[otpType].replace(/(.{3}).*(@.*)/, '$1***$2');

      notification.showSuccess('OTP Sent', `Verification code sent to ${contactDisplay}`);

      // Show debug info in development
      if (result.debug_info && import.meta.env.DEV) {
        notification.showInfo('Development Mode', `Test OTP: ${result.debug_info.otp_code}`);
      }

    } catch (error: any) {
      if (!mountedRef.current) return; // Component unmounted

      const errorMessage = error?.message || 'Failed to send OTP';
      console.error('OTP send error:', errorMessage);
      setError(errorMessage);
      notification.showError('Send Failed', errorMessage);
      setOtpSent(false);
    } finally {
      // Always reset states regardless of success/failure
      if (mountedRef.current) {
        setIsResending(false);
      }
      sendingInProgress.current = false;
    }
  }, [currentUserId, contactInfo, otpType, otpService, notification, redirectToLoginForMissingSession]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if user is still logged in
    if (!user) {
      console.log('User logged out, redirecting to login');
      redirectToLoginForMissingSession('Please login to continue verification');
      return;
    }

    if (isSubmitting) return;

    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setError('Please enter the complete 6-digit OTP');
      return;
    }

    if (!/^\d{6}$/.test(otpString)) {
      setError('OTP must contain only numbers');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await otpService.verifyOTP(currentUserId, otpString, otpType);

      if (!mountedRef.current) return; // Component unmounted

      if (!result.success) {
        throw new Error(result.error || 'OTP verification failed');
      }

      notification.showSuccess('Verification Successful', `${otpType === 'email' ? 'Email' : 'Mobile'} verified successfully!`);

      const newCompletedVerifications = {
        ...completedVerifications,
        [otpType]: true
      };
      setCompletedVerifications(newCompletedVerifications);

      const allRequiredCompleted = checkAllVerificationsCompleted(newCompletedVerifications);

      if (allRequiredCompleted) {
        if (user) {
          await fetchUserData(user.id);
        }
        void sendAccountEmail({ type: 'welcome' });
        notification.showSuccess('Account Verified', 'Your account has been fully verified!');
        const state = location.state as any;
        const returnTo =
          typeof state?.returnTo === 'string' && state.returnTo.trim()
            ? state.returnTo
            : state?.from?.pathname
              ? `${state.from.pathname || ''}${state.from.search || ''}`
              : '/customer/dashboard';

        navigate(returnTo, { replace: true });
      } else {
        // Reset for next verification
        setOtp(['', '', '', '', '', '']);
        setError('');
        setOtpSent(false);
        setResendTimer(0);

        const nextType = getNextVerificationType(newCompletedVerifications);
        if (nextType) {
          notification.showInfo('Next Step', `Please verify your ${nextType} address to complete registration`);
          setOtpType(nextType);
          updateVerificationProgress(verificationSettings, newCompletedVerifications);
        }
      }

    } catch (err: any) {
      if (!mountedRef.current) return; // Component unmounted

      let errorMessage = 'Invalid OTP. Please try again.';

      if (err?.message) {
        if (err.message.includes('timeout')) {
          errorMessage = 'Verification timed out. Please try again.';
        } else if (err.message.includes('expired')) {
          errorMessage = 'OTP has expired. Please request a new code.';
        } else if (err.message.includes('attempts')) {
          errorMessage = 'Too many failed attempts. Please request a new OTP.';
        } else if (err.message.includes('Invalid')) {
          errorMessage = 'Invalid OTP code. Please check and try again.';
        } else {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
      notification.showError('Verification Failed', errorMessage);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [isSubmitting, otp, currentUserId, otpType, otpService, completedVerifications, user, fetchUserData, notification, navigate, verificationSettings, updateVerificationProgress, redirectToLoginForMissingSession]);

  const handleResend = useCallback(async () => {
    if (resendTimer > 0 || isResending || sendingInProgress.current) return;

    console.log(`Resending ${otpType} OTP`);

    // Clear cache to force new OTP
    otpService.clearCache(currentUserId, otpType);

    // Reset all OTP-related states
    setOtp(['', '', '', '', '', '']);
    setError('');
    setOtpSent(false);
    setResendTimer(0);

    // Send new OTP
    await handleSendOTP();

    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  }, [resendTimer, isResending, handleSendOTP, otpService, currentUserId, otpType]);

  const handleOtpTypeChange = useCallback((newType: 'email' | 'mobile') => {
    if (otpType === newType) return; // Prevent unnecessary changes

    const isAllowed = verificationSettings.eitherRequired ||
        (newType === 'email' && verificationSettings.emailRequired) ||
        (newType === 'mobile' && verificationSettings.mobileRequired);

    const hasContactInfo = contactInfo[newType] && contactInfo[newType].trim() !== '';
    const isAlreadyVerified = completedVerifications[newType];

    if (isAllowed && hasContactInfo && !isAlreadyVerified) {
      console.log(`Switching OTP type from ${otpType} to ${newType}`);

      // Reset states for new type
      setOtp(['', '', '', '', '', '']);
      setError('');
      setOtpSent(false);
      setResendTimer(0);

      // Change type
      setOtpType(newType);

      // Check for existing OTP cache for new type
      const cacheStatus = otpService.getCacheStatus(currentUserId, newType);
      if (cacheStatus && cacheStatus.status === 'sent' && cacheStatus.expires > Date.now()) {
        const remainingTime = Math.ceil((cacheStatus.expires - Date.now()) / 1000);
        setOtpSent(true);
        setResendTimer(Math.min(remainingTime, 30));
        notification.showInfo('OTP Available', `${newType} OTP is still valid for ${remainingTime} seconds`);
      }

      notification.showInfo('Verification Type Changed', `Switched to ${newType} verification`);
    } else if (isAlreadyVerified) {
      notification.showInfo('Already Verified', `Your ${newType} is already verified`);
    } else if (!hasContactInfo) {
      setError(`No ${newType} address provided for verification`);
      notification.showError('Missing Information', `No ${newType} address available for verification`);
    } else {
      setError(`${newType} verification is not enabled`);
      notification.showError('Not Available', `${newType} verification is not enabled`);
    }
  }, [otpType, verificationSettings, contactInfo, completedVerifications, notification, currentUserId, otpService]);

  // Helper functions
  const getNextVerificationType = (completed: CompletedVerifications): 'email' | 'mobile' | null => {
    if (verificationSettings.emailRequired && !completed.email) {
      return 'email';
    }
    if (verificationSettings.mobileRequired && !completed.mobile) {
      return 'mobile';
    }
    return null;
  };

  const checkAllVerificationsCompleted = (completed: CompletedVerifications): boolean => {
    if (verificationSettings.eitherRequired) {
      return completed.email || completed.mobile;
    }

    if (verificationSettings.emailRequired && verificationSettings.mobileRequired) {
      return completed.email && completed.mobile;
    }

    if (verificationSettings.emailRequired) {
      return completed.email;
    }

    if (verificationSettings.mobileRequired) {
      return completed.mobile;
    }

    return true;
  };

  const canSwitchType = (type: 'email' | 'mobile'): boolean => {
    if (verificationSettings.eitherRequired ||
        (verificationSettings.emailRequired && verificationSettings.mobileRequired)) {
      return contactInfo[type] &&
          contactInfo[type].trim() !== '' &&
          !completedVerifications[type];
    }
    return false;
  };

  const showTypeSelector = (): boolean => {
    return (verificationSettings.eitherRequired ||
            (verificationSettings.emailRequired && verificationSettings.mobileRequired)) &&
        contactInfo.email && contactInfo.email.trim() !== '' &&
        contactInfo.mobile && contactInfo.mobile.trim() !== '';
  };

  const getVerificationTitle = (): string => {
    if (verificationSettings.eitherRequired) {
      return 'Choose Verification Method';
    } else if (verificationSettings.emailRequired && verificationSettings.mobileRequired) {
      if (completedVerifications.email && !completedVerifications.mobile) {
        return 'Verify Mobile Number';
      } else if (completedVerifications.mobile && !completedVerifications.email) {
        return 'Verify Email Address';
      } else if (otpType === 'email') {
        return 'Verify Email Address';
      } else {
        return 'Verify Mobile Number';
      }
    } else if (verificationSettings.emailRequired) {
      return 'Verify Email Address';
    } else if (verificationSettings.mobileRequired) {
      return 'Verify Mobile Number';
    }
    return 'Verify Account';
  };

  const getVerificationDescription = (): string => {
    if (verificationSettings.eitherRequired) {
      return 'Choose your preferred verification method. We will send a 6-digit code to verify your account.';
    }
    return 'Enter the 6-digit verification code sent to ';
  };

  // Don't render if missing critical data
  if (!currentUserId || (!contactInfo.email && !contactInfo.mobile)) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-8">
            <div className="bg-white p-8 rounded-2xl shadow-xl text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Verification Required</h2>
              <p className="text-gray-600 mb-4">
                Please complete registration first to continue verification.
              </p>
              <button
                  onClick={() => navigate('/customer/register')}
                  className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Go to Registration
              </button>
            </div>
          </div>
        </div>
    );
  }

  return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white p-8 rounded-2xl shadow-xl">
            {/* Header */}
            <div className="text-center mb-8">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                  otpType === 'mobile' ? 'bg-indigo-100' : 'bg-green-100'
              }`}>
                {otpType === 'mobile' ? (
                    <Smartphone className="h-8 w-8 text-indigo-600" />
                ) : (
                    <Mail className="h-8 w-8 text-green-600" />
                )}
              </div>
              <h2 className="text-3xl font-bold text-gray-900">
                {getVerificationTitle()}
              </h2>
              <p className="mt-2 text-gray-600">
                {getVerificationDescription()}
                {!verificationSettings.eitherRequired && contactInfo[otpType] && (
                    <span className="font-semibold text-indigo-600 block mt-1">
                  {otpType === 'mobile'
                      ? contactInfo[otpType].replace(/(.{3}).*(.{4})/, '$1***$2')
                      : contactInfo[otpType].replace(/(.{3}).*(@.*)/, '$1***$2')
                  }
                </span>
                )}
              </p>
            </div>

            {/* Progress Indicator */}
            {verificationProgress.totalSteps > 1 && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-blue-700">Verification Progress</h4>
                    <span className="text-sm text-blue-600">
                  Step {verificationProgress.currentStep} of {verificationProgress.totalSteps}
                </span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(verificationProgress.currentStep / verificationProgress.totalSteps) * 100}%` }}
                    ></div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <div className={`flex items-center space-x-1 ${completedVerifications.email ? 'text-green-600' : 'text-gray-400'}`}>
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Email</span>
                    </div>
                    <div className={`flex items-center space-x-1 ${completedVerifications.mobile ? 'text-green-600' : 'text-gray-400'}`}>
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Mobile</span>
                    </div>
                  </div>
                </div>
            )}

            {/* Type Selector */}
            {showTypeSelector() && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    {verificationSettings.eitherRequired ? 'Choose verification method:' : 'Switch verification method:'}
                  </h4>
                  <div className="flex space-x-4 justify-center">
                    <button
                        type="button"
                        onClick={() => handleOtpTypeChange('mobile')}
                        disabled={!canSwitchType('mobile')}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            otpType === 'mobile'
                                ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-300'
                                : canSwitchType('mobile')
                                    ? 'bg-gray-100 text-gray-600 border-2 border-gray-200 hover:bg-gray-200'
                                    : 'bg-gray-50 text-gray-400 border-2 border-gray-100 cursor-not-allowed'
                        }`}
                    >
                      <Smartphone className="h-4 w-4" />
                      <span>Mobile ({contactInfo.mobile?.replace(/(.{3}).*(.{4})/, '$1***$2')})</span>
                      {completedVerifications.mobile && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => handleOtpTypeChange('email')}
                        disabled={!canSwitchType('email')}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            otpType === 'email'
                                ? 'bg-green-100 text-green-700 border-2 border-green-300'
                                : canSwitchType('email')
                                    ? 'bg-gray-100 text-gray-600 border-2 border-gray-200 hover:bg-gray-200'
                                    : 'bg-gray-50 text-gray-400 border-2 border-gray-100 cursor-not-allowed'
                        }`}
                    >
                      <Mail className="h-4 w-4" />
                      <span>Email ({contactInfo.email?.replace(/(.{3}).*(@.*)/, '$1***$2')})</span>
                      {completedVerifications.email && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </button>
                  </div>
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
            )}

            {/* Manual Send OTP button */}
            {!otpSent && (
                <div className="mb-6 text-center">
                  <button
                      onClick={handleSendOTP}
                      disabled={isSubmitting || isResending || sendingInProgress.current || !currentUserId || !contactInfo[otpType]}
                      className={`w-full py-3 px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2 ${
                          otpType === 'mobile'
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                  >
                    {(isResending || sendingInProgress.current) ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>Sending OTP...</span>
                        </>
                    ) : (
                        <>
                          {otpType === 'mobile' ? <Smartphone className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
                          <span>Send {otpType === 'mobile' ? 'Mobile' : 'Email'} OTP</span>
                        </>
                    )}
                  </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                  Enter Verification Code
                </label>
                <div className="flex justify-center space-x-3">
                  {otp.map((digit, index) => (
                      <input
                          key={index}
                          ref={(el) => (otpRefs.current[index] = el)}
                          type="text"
                          inputMode="numeric"
                          autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          name={index === 0 ? 'one-time-code' : `otp-${index + 1}`}
                          aria-label={`OTP digit ${index + 1}`}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onInput={(e) => handleOtpInput(index, e)}
                          onPaste={handlePaste}
                          onKeyDown={(e) => handleKeyDown(index, e)}
                          className="w-12 h-12 text-center text-xl font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
                          maxLength={6}
                          pattern="[0-9]*"
                          disabled={isSubmitting || !otpSent}
                      />
                  ))}
                </div>
                <div className="mt-2 text-center">
                  <p className="text-xs text-gray-500">
                    Tip: You can paste the entire 6-digit code into any field
                  </p>
                </div>
              </div>

              <button
                  type="submit"
                  disabled={isSubmitting || otp.join('').length !== 6 || !otpSent}
                  className={`w-full py-3 px-4 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2 text-white ${
                      otpType === 'mobile'
                          ? 'bg-indigo-600 hover:bg-indigo-700'
                          : 'bg-green-600 hover:bg-green-700'
                  }`}
              >
                {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Verifying...</span>
                    </>
                ) : (
                    <span>Verify {otpType === 'mobile' ? 'Mobile' : 'Email'} OTP</span>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              {otpSent && (
                  <>
                    <p className="text-sm text-gray-600 mb-4">
                      {resendTimer > 0 ? `Resend OTP in ${resendTimer} seconds` : "Didn't receive the code?"}
                    </p>
                    {resendTimer === 0 && (
                        <button
                            onClick={handleResend}
                            disabled={isSubmitting || isResending || sendingInProgress.current}
                            className="inline-flex items-center space-x-2 text-indigo-600 hover:text-indigo-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw className={`h-4 w-4 ${(isResending || sendingInProgress.current) ? 'animate-spin' : ''}`} />
                          <span>{(isResending || sendingInProgress.current) ? 'Sending...' : 'Resend OTP'}</span>
                        </button>
                    )}
                  </>
              )}

              {/* Alternative verification method */}
              {showTypeSelector() && !verificationSettings.eitherRequired && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">
                      Need to verify {otpType === 'mobile' ? 'email' : 'mobile'} too?
                    </p>
                    <button
                        type="button"
                        onClick={() => handleOtpTypeChange(otpType === 'mobile' ? 'email' : 'mobile')}
                        disabled={!canSwitchType(otpType === 'mobile' ? 'email' : 'mobile')}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      Verify {otpType === 'mobile' ? 'Email' : 'Mobile'} instead
                    </button>
                  </div>
              )}

              {/* For either verification, show switch option if having trouble */}
              {verificationSettings.eitherRequired && showTypeSelector() && otpSent && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">
                      Having trouble with {otpType}?
                    </p>
                    <button
                        type="button"
                        onClick={() => handleOtpTypeChange(otpType === 'mobile' ? 'email' : 'mobile')}
                        disabled={!canSwitchType(otpType === 'mobile' ? 'email' : 'mobile')}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      Try {otpType === 'mobile' ? 'Email' : 'Mobile'} verification instead
                    </button>
                  </div>
              )}

              {/* Help text */}
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-500">
                  Having trouble? {otpType === 'email' ? 'Check your spam folder' : 'Check your messages'}
                  {showTypeSelector() ? ' or try switching verification method above' : ''}.
                </p>
                {verificationSettings.eitherRequired && (
                    <p className="text-xs text-gray-400 mt-1">
                      You only need to verify one method to continue.
                    </p>
                )}
              </div>

              {/* Support contact */}
              <div className="mt-4 text-center">
                <p className="text-xs text-gray-400">
                  Still need help?{' '}
                  <button
                      type="button"
                      onClick={() => notification.showInfo('Support', 'Please contact support for assistance with verification')}
                      className="text-blue-500 hover:text-blue-600"
                  >
                    Contact Support
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};

export default VerifyOTP;
