import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { sessionManager, supabase } from '../../lib/supabase';
import { useNotification } from '../../components/ui/NotificationProvider';
import { Shield, Loader } from 'lucide-react';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const notification = useNotification();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const handleAuthCallback = async () => {
      try {
        const token = searchParams.get('token');
        const type = searchParams.get('type');
        const mode = searchParams.get('mode');

        if (type === 'recovery' && token) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: 'recovery',
          });

          if (error) throw error;

          if (data.session) {
            notification.showSuccess('Email Verified', 'You can now reset your password.');
            navigate('/reset-password');
          } else {
            throw new Error('Failed to verify reset token');
          }
        } else if (mode === 'admin_impersonation') {
          const key = searchParams.get('key');
          if (!key) throw new Error('Missing impersonation key');

          const stored = localStorage.getItem(key);
          localStorage.removeItem(key); // always remove immediately, even on error

          if (!stored) throw new Error('Impersonation session data not found or already used');

          const payload = JSON.parse(stored);

          // Reject if the stored token has passed its 60s TTL
          if (!payload.expiresAt || Date.now() > payload.expiresAt) {
            throw new Error('Impersonation token has expired');
          }

          if (!payload.accessToken || !payload.refreshToken) {
            throw new Error('Malformed impersonation payload');
          }

          const { data, error } = await supabase.auth.setSession({
            access_token: payload.accessToken,
            refresh_token: payload.refreshToken,
          });

          if (error) throw error;

          if (data.session) {
            sessionStorage.removeItem('customer_logout_in_progress');
            sessionStorage.setItem('session_type', 'customer');
            sessionManager.saveSession(data.session);
            notification.showSuccess('Customer Session Started', 'Opening customer dashboard.');
            navigate('/customer/dashboard', { replace: true });
          } else {
            throw new Error('Failed to create customer session');
          }
        } else {
          navigate('/');
        }
      } catch (err: any) {
        console.error('Auth callback error:', err);
        setError(err?.message || 'Authentication failed');
        notification.showError('Authentication Failed', 'The login link is invalid or has expired.');
        setTimeout(() => navigate(type === 'recovery' ? '/forgot-password' : '/customer/login'), 3000);
      } finally {
        setLoading(false);
      }
    };

    void handleAuthCallback();
  }, [navigate, notification, searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white p-8 rounded-2xl shadow-xl text-center">
            <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Loader className="h-8 w-8 text-indigo-600 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Verifying...</h2>
            <p className="text-gray-600">Please wait while we verify your login link.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white p-8 rounded-2xl shadow-xl text-center">
            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="h-8 w-8 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Verification Failed</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <p className="text-sm text-gray-500">You will be redirected to the forgot password page shortly.</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default AuthCallback;
