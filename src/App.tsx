import React, { useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './components/ui/NotificationProvider';
import SessionWarning from './components/ui/SessionWarning';
import { MLMProvider } from './contexts/MLMContext';
import { AdminProvider } from './contexts/AdminContext';
import { useAdmin } from './contexts/AdminContext';
import { AdminAuthProvider } from './contexts/AdminAuthContext';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import CustomerLogin from './pages/auth/CustomerLogin';
import CustomerRegister from './pages/auth/CustomerRegister';
import RegistrationPayment from './pages/auth/RegistrationPayment';
import RegistrationPaymentSuccess from './pages/auth/RegistrationPaymentSuccess';
import CompanyLogin from './pages/auth/CompanyLogin';
import CompanyRegister from './pages/auth/CompanyRegister';
import CustomerDashboard from './pages/dashboard/CustomerDashboard';
import CompanyDashboard from './pages/dashboard/CompanyDashboard';
import BackpanelLogin from './pages/backpanel/AdminLogin';
import BackpanelDashboard from './pages/backpanel/AdminDashboard';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import AuthCallback from './pages/auth/AuthCallback';
import VerifyOTP from './pages/auth/VerifyOTP';
import SubscriptionPlans from './pages/SubscriptionPlans';
import Payment from './pages/Payment';
import ContactUs from './pages/ContactUs';
import AboutUs from './pages/AboutUs';
import SitePolicies from './pages/SitePolicies';
import FAQ from './pages/FAQ';
import JoinAsCustomer from './pages/JoinAsCustomer';
import JoinAsCompany from './pages/JoinAsCompany';
import UpcomingPlan from './pages/UpcomingPlan';
import Maintenance from './pages/Maintenance';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AdminProtectedRoute from './components/auth/AdminProtectedRoute';
import GuestRoute from './components/auth/GuestRoute';
import { getMaintenanceNoticeState, isMaintenanceActiveNow } from './utils/maintenanceWindow';

// Persists the current route so MetaMask DApp browser can restore it after reload
const SESSION_ROUTE_KEY = 'app_last_route';

function RouteTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // Don't persist auth callback or reset-password paths to avoid redirect loops
    if (pathname !== '/' && !pathname.startsWith('/auth/')) {
      sessionStorage.setItem(SESSION_ROUTE_KEY, pathname + search);
    }
  }, [pathname, search]);

  return null;
}

// Scroll to top component
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Smooth scroll to top when route changes
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth'
    });
  }, [pathname]);

  return null;
}

function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <SessionWarning />
        <MLMProvider>
          <AdminProvider>
            <AdminAuthProvider>
              <Router>
                <div className="min-h-screen bg-gray-50">
                  <ScrollToTop />
                  <RouteTracker />
                  <Routes>
                    {/* Backpanel Routes (No Navbar/Footer) */}
                    <Route path="/backpanel/login" element={
                      <GuestRoute>
                        <BackpanelLogin />
                      </GuestRoute>
                    } />
                    <Route path="/backpanel/dashboard" element={
                      <AdminProtectedRoute>
                        <BackpanelDashboard />
                      </AdminProtectedRoute>
                    } />
                    
                    {/* Main App Routes (With Navbar/Footer) */}
                    <Route path="/*" element={<MainSite />} />
                  </Routes>
                </div>
              </Router>
            </AdminAuthProvider>
          </AdminProvider>
        </MLMProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}

const MainSite: React.FC = () => {
  const { settings } = useAdmin();
  const maintenanceActive = isMaintenanceActiveNow(settings as any);
  const allowedIps = Array.isArray((settings as any)?.maintenanceAllowedIps) ? ((settings as any).maintenanceAllowedIps as string[]) : [];
  const notice = useMemo(() => getMaintenanceNoticeState(settings as any), [settings]);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [ipChecked, setIpChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadIp = async () => {
      if (!maintenanceActive || allowedIps.length === 0) {
        if (mounted) setIpChecked(true);
        return;
      }

      try {
        const baseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const res = await fetch(`${baseUrl}/functions/v1/get-client-ip`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
        });
        const json = await res.json();
        const ip = String(json?.ip || '').trim();
        if (mounted) setClientIp(ip || null);
      } catch {
        if (mounted) setClientIp(null);
      } finally {
        if (mounted) setIpChecked(true);
      }
    };

    setIpChecked(false);
    loadIp();
    return () => {
      mounted = false;
    };
  }, [maintenanceActive, allowedIps.length]);

  const isAllowedByIp = useMemo(() => {
    if (!maintenanceActive) return true;
    if (allowedIps.length === 0) return false;
    if (!clientIp) return false;
    return allowedIps.includes(clientIp);
  }, [maintenanceActive, allowedIps, clientIp]);

  if (maintenanceActive) {
    if (allowedIps.length === 0) return <Maintenance />;
    if (!ipChecked) return <Maintenance />;
    if (!isAllowedByIp) return <Maintenance />;
  }

  return (
    <>
      <Navbar />
      <main className={notice.showBanner ? 'pt-24' : 'pt-16'}>
        <Routes>
          <Route path="/" element={<Home />} />

          {/* Static Pages */}
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/about" element={<AboutUs />} />
          <Route path="/policies" element={<SitePolicies />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/join-customer" element={<JoinAsCustomer />} />
          <Route path="/join-company" element={<JoinAsCompany />} />
          <Route path="/upcoming-plan" element={<UpcomingPlan />} />

          {/* Customer Routes */}
          <Route path="/customer/login" element={
            <GuestRoute>
              <CustomerLogin />
            </GuestRoute>
          } />
          <Route path="/customer/register" element={
            <GuestRoute>
              <CustomerRegister />
            </GuestRoute>
          } />
          <Route path="/registration-payment" element={
            <ProtectedRoute userType="customer">
              <RegistrationPayment />
            </ProtectedRoute>
          } />
          <Route path="/registration-payment-success" element={
            <ProtectedRoute userType="customer" requiresSubscription={false}>
              <RegistrationPaymentSuccess />
            </ProtectedRoute>
          } />
          <Route path="/customer/dashboard" element={
            <ProtectedRoute userType="customer">
              <CustomerDashboard />
            </ProtectedRoute>
          } />

          {/* Company Routes */}
          <Route path="/company/login" element={
            <GuestRoute>
              <CompanyLogin />
            </GuestRoute>
          } />
          <Route path="/company/register" element={
            <GuestRoute>
              <CompanyRegister />
            </GuestRoute>
          } />
          <Route path="/company/dashboard" element={
            <ProtectedRoute userType="company">
              <CompanyDashboard />
            </ProtectedRoute>
          } />

          {/* Shared Routes */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/customer/impersonation-callback" element={<AuthCallback />} />
          <Route path="/verify-otp" element={<VerifyOTP />} />
          <Route path="/subscription-plans" element={<SubscriptionPlans />} />
          <Route path="/payment" element={
            <ProtectedRoute userType="customer">
              <Payment />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
};

export default App;
