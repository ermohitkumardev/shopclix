import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAdmin } from '../../contexts/AdminContext';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, Shield, UserRound } from 'lucide-react';
import ReCaptcha from '../../components/ui/ReCaptcha';
import { verifyTurnstileToken } from '../../lib/turnstile';

type ResetStep = 'identify' | 'reset' | 'done';

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const visibleName = name.length <= 2 ? name[0] : `${name.slice(0, 2)}***`;
  return `${visibleName}@${domain}`;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback;
};

const ForgotPassword: React.FC = () => {
  const { settings } = useAdmin();
  const [step, setStep] = useState<ResetStep>('identify');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    sponsorshipNumber: '',
    email: '',
    otp: '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const emailForApi = formData.email.trim().toLowerCase();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'otp' ? value.replace(/\D/g, '').slice(0, 6) : value
    }));
  };

  const invokePasswordReset = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('password-reset-mobile', {
      body: payload
    });

    if (error) {
      throw new Error(error.message || 'Password reset request failed.');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Password reset request failed.');
    }

    return data;
  };

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    try {
      await verifyTurnstileToken({
        token: recaptchaToken,
        siteMode: settings.siteMode,
        action: 'forgot_password',
      });
    } catch (err: any) {
      setError(err?.message || 'Please complete the security verification');
      return;
    }

    if (!formData.sponsorshipNumber.trim()) {
      setError('Please enter your User ID.');
      return;
    }

    if (!isValidEmail(emailForApi)) {
      setError('Please enter a valid registered email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await invokePasswordReset({
        action: 'request_reset',
        sponsorshipNumber: formData.sponsorshipNumber.trim(),
        email: emailForApi
      });
      setSuccessMessage(data.message || `OTP sent to ${maskEmail(emailForApi)}.`);
      setStep('reset');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to send OTP. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.otp.length !== 6) {
      setError('Please enter the 6-digit OTP.');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await invokePasswordReset({
        action: 'reset_password',
        sponsorshipNumber: formData.sponsorshipNumber.trim(),
        email: emailForApi,
        otp: formData.otp,
        newPassword: formData.password
      });
      setStep('done');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to reset password. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white p-8 rounded-2xl shadow-xl text-center">
            <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Password Reset Successful</h2>
            <p className="text-gray-600 mb-6">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <Link
              to="/customer/login"
              className="inline-flex items-center space-x-2 text-indigo-600 hover:text-indigo-500"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-white p-8 rounded-2xl shadow-xl">
          <div className="text-center mb-8">
            <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              {step === 'identify' ? (
                <Mail className="h-8 w-8 text-indigo-600" />
              ) : (
                <KeyRound className="h-8 w-8 text-indigo-600" />
              )}
            </div>
            <h2 className="text-3xl font-bold text-gray-900">Forgot Password?</h2>
            <p className="mt-2 text-gray-600">
              {step === 'identify'
                ? 'Enter your User ID and registered email address to receive an OTP.'
                : `Enter the OTP sent to ${maskEmail(emailForApi)} and choose a new password.`}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-700 text-sm">{successMessage}</p>
            </div>
          )}

          {step === 'identify' ? (
            <form onSubmit={handleRequestOTP} className="space-y-6">
              <div>
                <label htmlFor="sponsorshipNumber" className="block text-sm font-medium text-gray-700 mb-2">
                  User ID
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserRound className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="sponsorshipNumber"
                    name="sponsorshipNumber"
                    type="text"
                    required
                    value={formData.sponsorshipNumber}
                    onChange={handleChange}
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Enter your User ID"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Registered Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="you@example.com"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Use the email address registered with this User ID.
                </p>
              </div>

              <ReCaptcha onVerify={setRecaptchaToken} />

              <button
                type="submit"
                disabled={isSubmitting || !recaptchaToken}
                className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Sending OTP...</span>
                  </>
                ) : (
                  <span>Send Email OTP</span>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
                  Email OTP
                </label>
                <input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  required
                  value={formData.otp}
                  onChange={handleChange}
                  className="block w-full px-3 py-3 text-center tracking-[0.5em] border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="000000"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={handleChange}
                    className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    ) : (
                      <Eye className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Confirm new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    ) : (
                      <Eye className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Resetting...</span>
                  </>
                ) : (
                  <span>Reset Password</span>
                )}
              </button>

              <button
                type="button"
                onClick={handleRequestOTP}
                disabled={isSubmitting}
                className="w-full text-sm text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
              >
                Resend OTP
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/customer/login"
              className="inline-flex items-center space-x-2 text-indigo-600 hover:text-indigo-500"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
