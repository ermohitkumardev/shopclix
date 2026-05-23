import React, { useCallback, useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAdmin } from '../../contexts/AdminContext';
import { useNotification } from '../ui/NotificationProvider';

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const initialForm: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

const commonPasswords = [
  'password',
  'password123',
  '123456',
  '12345678',
  'qwerty',
  'admin',
  'letmein',
  'welcome'
];

const sequentialValues = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop'];

const getErrorMessage = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
);

const hasSequentialValue = (password: string) => {
  const normalized = password.toLowerCase();
  return sequentialValues.some((sequence) => {
    for (let index = 0; index <= sequence.length - 3; index += 1) {
      if (normalized.includes(sequence.slice(index, index + 3))) return true;
    }
    return false;
  });
};

const hasTooManyRepeats = (password: string, maxConsecutive: number) => {
  if (maxConsecutive <= 0) return false;
  const pattern = new RegExp(`(.)\\1{${maxConsecutive},}`);
  return pattern.test(password);
};

const PasswordUpdateForm: React.FC = () => {
  const { user } = useAuth();
  const { settings } = useAdmin();
  const notification = useNotification();
  const [formData, setFormData] = useState<PasswordFormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordErrors = useMemo(() => {
    const password = formData.newPassword;
    if (!password) return [];

    const errors: string[] = [];
    const minLength = settings.passwordMinLength || 8;
    const maxLength = settings.passwordMaxLength || 128;

    if (password.length < minLength) errors.push(`Use at least ${minLength} characters.`);
    if (password.length > maxLength) errors.push(`Use no more than ${maxLength} characters.`);
    if (settings.passwordRequireUppercase && !/[A-Z]/.test(password)) errors.push('Add an uppercase letter.');
    if (settings.passwordRequireLowercase && !/[a-z]/.test(password)) errors.push('Add a lowercase letter.');
    if (settings.passwordRequireNumbers && !/[0-9]/.test(password)) errors.push('Add a number.');

    if (settings.passwordRequireSpecialChars) {
      const allowed = settings.passwordAllowedSpecialChars || '!@#$%^&*()_+-=[]{};:\'"|,.<>?/~`';
      const allowedPattern = new RegExp(`[${allowed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
      if (!allowedPattern.test(password)) errors.push('Add a special character.');
    }

    if (settings.passwordPreventCommon && commonPasswords.includes(password.toLowerCase())) {
      errors.push('Choose a less common password.');
    }

    if (settings.passwordPreventSequences && hasSequentialValue(password)) {
      errors.push('Avoid sequential characters.');
    }

    if (settings.passwordPreventRepeats && hasTooManyRepeats(password, settings.passwordMaxConsecutive || 3)) {
      errors.push('Avoid repeated characters.');
    }

    const uniqueCharacters = new Set(password).size;
    if ((settings.passwordMinUniqueChars || 0) > 0 && uniqueCharacters < settings.passwordMinUniqueChars) {
      errors.push(`Use at least ${settings.passwordMinUniqueChars} unique characters.`);
    }

    return errors;
  }, [formData.newPassword, settings]);

  const handleChange = useCallback((field: keyof PasswordFormState, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const validateForm = () => {
    if (!user?.email) throw new Error('Your email is not available for password verification.');
    if (!formData.currentPassword) throw new Error('Current password is required.');
    if (!formData.newPassword) throw new Error('New password is required.');
    if (formData.newPassword !== formData.confirmPassword) throw new Error('New password and confirmation do not match.');
    if (formData.currentPassword === formData.newPassword) throw new Error('New password must be different from current password.');
    if (passwordErrors.length > 0) throw new Error(passwordErrors[0]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      validateForm();
    } catch (error) {
      notification.showError('Invalid Password', getErrorMessage(error, 'Please check the password fields.'));
      return;
    }

    setSaving(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user!.email,
        password: formData.currentPassword
      });

      if (verifyError) {
        throw new Error('Current password is incorrect.');
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: formData.newPassword
      });

      if (updateError) throw updateError;

      setFormData(initialForm);
      notification.showSuccess('Password Updated', 'Your password has been updated successfully.');
    } catch (error) {
      console.error('Failed to update password:', error);
      notification.showError('Update Failed', getErrorMessage(error, 'Could not update password.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 border-t border-gray-100 pt-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Update Password</h3>
          <p className="mt-1 text-sm text-gray-500">Change your account password after confirming your current one.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="profile-current-password">
              Current Password
            </label>
            <div className="relative">
              <input
                id="profile-current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={formData.currentPassword}
                onChange={(event) => handleChange('currentPassword', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-11 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
              >
                {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="profile-new-password">
              New Password
            </label>
            <div className="relative">
              <input
                id="profile-new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={formData.newPassword}
                onChange={(event) => handleChange('newPassword', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-11 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="profile-confirm-password">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                id="profile-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(event) => handleChange('confirmPassword', event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-11 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {formData.newPassword && passwordErrors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {passwordErrors[0]}
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-gray-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Password changes require your current password.</span>
          </div>
          <button
            type="submit"
            disabled={saving || passwordErrors.length > 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{saving ? 'Updating...' : 'Update Password'}</span>
          </button>
        </div>
      </form>
    </section>
  );
};

export default PasswordUpdateForm;
