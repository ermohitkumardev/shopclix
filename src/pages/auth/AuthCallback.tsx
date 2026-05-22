import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
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
        } else if (type === 'magiclink' && mode === 'admin_impersonation' && token) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: 'magiclink',
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
