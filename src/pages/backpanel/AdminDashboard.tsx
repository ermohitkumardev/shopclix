import React, { useState, useEffect, useMemo } from 'react';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { sessionUtils } from '../../utils/sessionUtils';
import { adminApi } from '../../lib/adminApi';
import GeneralSettings from '../../components/admin/GeneralSettings';
import ContactFooterSettings from '../../components/admin/ContactFooterSettings';
import RegistrationSettings from '../../components/admin/RegistrationSettings';
import CustomerManagement from '../../components/admin/CustomerManagement';
import PaymentSettings from '../../components/admin/PaymentSettings';
import PendingPayments from '../../components/admin/PendingPayments';
import WithdrawalRequests from '../../components/admin/WithdrawalRequests';
import AdminManagement from '../../components/admin/AdminManagement';
import SubscriptionManagement from '../../components/admin/SubscriptionManagement';
import CompanyManagement from '../../components/admin/CompanyManagement';
import CouponManagement from '../../components/admin/CouponManagement';
import DailyTaskManagement from '../../components/admin/DailyTaskManagement';
import WalletManagement from '../../components/admin/WalletManagement';
import EarningDistributionSettings from '../../components/admin/EarningDistributionSettings';
import AfterLaunchPlanSettings from '../../components/admin/AfterLaunchPlanSettings';
import SpinWheelManagement from '../../components/admin/SpinWheelManagement';
import MLMLevelCounts from '../../components/admin/MLMLevelCounts';
import {
  Users,
  Building,
  CreditCard,
  Settings,
  Shield,
  Activity,
  BarChart3,
  FileText,
  DollarSign,
  RefreshCw,
  Globe,
  UserCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Gift,
  Calendar,
  Wallet,
  Check,
  X,
  TrendingUp,
  Rocket,
  Contact
} from 'lucide-react';

interface SubAdmin {
  id: string;
  email: string;
  fullName: string;
  permissions: any;
  isActive: boolean;
  createdBy: string;
  lastLogin?: string;
  createdAt: string;
}

type OverviewStats = {
  totalUsers: number;
  companies: number;
  pendingWithdrawals: number;
  totalEarnings: number;
};

type OverviewRecentItem = {
  id: string;
  type: 'user' | 'payment' | 'withdrawal' | 'company';
  message: string;
  timestamp: string;
};

const AdminDashboard: React.FC = () => {
  const {
    admin,
    hasPermission,
    getSubAdmins,
    createSubAdmin,
    updateSubAdmin,
    deleteSubAdmin,
    resetSubAdminPassword,
    logout,
    loading: authLoading // <-- Renamed loading state for clarity
  } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedSubAdmin, setSelectedSubAdmin] = useState<SubAdmin | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionCheckInterval, setSessionCheckInterval] = useState<NodeJS.Timeout | null>(null);

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewStats, setOverviewStats] = useState<OverviewStats>({
    totalUsers: 0,
    companies: 0,
    pendingWithdrawals: 0,
    totalEarnings: 0
  });
  const [overviewRecent, setOverviewRecent] = useState<OverviewRecentItem[]>([]);

  const dashboardQuery = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const queryTab = dashboardQuery.get('tab') || '';
  const queryCustomerId = dashboardQuery.get('customerId') || '';
  const queryCustomerSearch = dashboardQuery.get('search') || '';

  useEffect(() => {
    if (!queryTab) return;
    const allowedTabs = new Set([
      'overview',
      'customers',
      'companies',
      'coupons',
      'tasks',
      'wallets',
      'subscriptions',
      'payments',
      'level_counts',
      'withdrawals',
      'admins',
      'settings',
    ]);
    if (allowedTabs.has(queryTab) && queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryTab]);

  const [newSubAdmin, setNewSubAdmin] = useState({
    email: '',
    fullName: '',
    permissions: {
      customers: { read: false, write: false, delete: false },
      companies: { read: false, write: false, delete: false },
      coupons: { read: false, write: false, delete: false },
      dailytasks: { read: false, write: false, delete: false },
      wallets: { read: false, write: false, delete: false },
      subscriptions: { read: false, write: false, delete: false },
      payments: { read: false, write: false, delete: false },
      withdrawals: { read: false, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      mlm: { read: false, write: false, delete: false },
      admins: { read: false, write: false, delete: false },
    }
  });

  // Setup session monitoring for admin dashboard
  useEffect(() => {
    // Check admin session every 30 seconds
    const interval = setInterval(() => {
      // FIX: Rely on sessionUtils.validateAdminSession to renew the timestamp AND check validity
      if (!sessionUtils.validateAdminSession()) {
        console.log('🔒 Admin session invalid, redirecting to login');
        handleLogout();
      }
    }, 30000); // Check every 30 seconds

    setSessionCheckInterval(interval);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
      }
    };
  }, [sessionCheckInterval]);

  const loadSubAdmins = async () => {
    setLoading(true);
    try {
      const data = await getSubAdmins();
      setSubAdmins(data);
    } catch (error) {
      console.error('Failed to load sub-admins:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSubAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSubAdmin(newSubAdmin);
      setShowCreateModal(false);
      setNewSubAdmin({
        email: '',
        fullName: '',
        permissions: {
          customers: { read: false, write: false, delete: false },
          companies: { read: false, write: false, delete: false },
          coupons: { read: false, write: false, delete: false },
          dailytasks: { read: false, write: false, delete: false },
          wallets: { read: false, write: false, delete: false },
          subscriptions: { read: false, write: false, delete: false },
          payments: { read: false, write: false, delete: false },
          withdrawals: { read: false, write: false, delete: false },
          settings: { read: false, write: false, delete: false },
          mlm: { read: false, write: false, delete: false },
          admins: { read: false, write: false, delete: false },
        }
      });
      loadSubAdmins();
    } catch (error) {
      console.error('Failed to create sub-admin:', error);
    }
  };

  const handleResetPassword = async (subAdminId: string) => {
    if (confirm('Are you sure you want to reset this sub-admin\'s password?')) {
      try {
        await resetSubAdminPassword(subAdminId);
      } catch (error) {
        console.error('Failed to reset password:', error);
      }
    }
  };

  const handleDeleteSubAdmin = async (subAdminId: string) => {
    if (confirm('Are you sure you want to delete this sub-admin? This action cannot be undone.')) {
      try {
        await deleteSubAdmin(subAdminId);
        loadSubAdmins();
      } catch (error) {
        console.error('Failed to delete sub-admin:', error);
      }
    }
  };

  const updatePermission = (module: string, action: string, value: boolean) => {
    setNewSubAdmin(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [module]: {
          ...prev.permissions[module as keyof typeof prev.permissions],
          [action]: value
        }
      }
    }));
  };

  const handleLogout = () => {
    // Clear session check interval
    if (sessionCheckInterval) {
      clearInterval(sessionCheckInterval);
      setSessionCheckInterval(null);
    }

    // Clear admin session
    sessionStorage.removeItem('admin_session_token');

    logout();
    navigate('/backpanel/login', { replace: true });
  };

  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const result = await adminApi.post<{ stats: OverviewStats; recent: OverviewRecentItem[] }>('admin-get-dashboard-overview', {});
      setOverviewStats(result?.stats || { totalUsers: 0, companies: 0, pendingWithdrawals: 0, totalEarnings: 0 });
      setOverviewRecent(Array.isArray(result?.recent) ? result.recent : []);
    } catch (error) {
      console.error('Failed to load admin dashboard overview:', error);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (!admin) return;
    if (activeTab !== 'overview') return;
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin?.id, activeTab]);

  const stats = useMemo(() => ([
    {
      title: 'Total Users',
      value: String(overviewStats.totalUsers ?? 0),
      icon: Users,
      color: 'bg-blue-500',
      change: 'All time'
    },
    {
      title: 'Companies',
      value: String(overviewStats.companies ?? 0),
      icon: Building,
      color: 'bg-green-500',
      change: 'All time'
    },
    {
      title: 'Pending Withdrawals',
      value: String(overviewStats.pendingWithdrawals ?? 0),
      icon: RefreshCw,
      color: 'bg-purple-500',
      change: 'Pending'
    },
    {
      title: 'Total Earnings',
      value: `${Number(overviewStats.totalEarnings ?? 0).toFixed(2)} USDT`,
      icon: DollarSign,
      color: 'bg-yellow-500',
      change: 'All time'
    }
  ]), [overviewStats]);

  const getOverviewActivityIcon = (type: OverviewRecentItem['type']) => {
    switch (type) {
      case 'user':
        return Users;
      case 'payment':
        return DollarSign;
      case 'withdrawal':
        return RefreshCw;
      case 'company':
        return Building;
      default:
        return Activity;
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3, permission: null },
    { id: 'customers', label: 'Customers', icon: Users, permission: 'customers' },
    { id: 'companies', label: 'Companies', icon: Building, permission: 'companies' },
    { id: 'coupons', label: 'Coupons', icon: Gift, permission: 'coupons' },
    { id: 'tasks', label: 'Daily Tasks', icon: Calendar, permission: 'dailytasks' },
    { id: 'wallets', label: 'Wallets', icon: Wallet, permission: 'wallets' },
    { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard, permission: 'subscriptions' },
    { id: 'payments', label: 'Payments', icon: DollarSign, permission: 'payments' },
    { id: 'level_counts', label: 'Level Counts', icon: BarChart3, permission: 'mlm' },
    { id: 'withdrawals', label: 'Withdrawals', icon: RefreshCw, permission: 'withdrawals' },
    { id: 'admins', label: 'Sub-Admins', icon: Shield, permission: 'admins' },
    { id: 'settings', label: 'Settings', icon: Settings, permission: 'settings' }
  ];

  const visibleTabs = tabs.filter(tab => {
      if (tab.id === 'settings') {
        return hasPermission('settings' as any, 'read') || hasPermission('mlm' as any, 'read');
      }
      return !tab.permission || hasPermission(tab.permission as any, 'read');
  });
  const activeTabPermission = tabs.find(tab => tab.id === activeTab)?.permission;

  // Settings sub-tabs
  const [settingsTab, setSettingsTab] = useState('general');
  const settingsTabs = [
    { id: 'general', label: 'General Settings', icon: Globe, permission: 'settings' },
    { id: 'contact_footer', label: 'Contact & Footer', icon: Contact, permission: 'settings' },
    { id: 'registration', label: 'Registration Settings', icon: UserCheck, permission: 'settings' },
    { id: 'payment', label: 'Payment Settings', icon: FileText, permission: 'settings' },
    { id: 'after_launch_plan', label: 'After Launch Plan', icon: Rocket, permission: 'settings' },
    { id: 'spin_wheel', label: 'Spin Wheel', icon: Gift, permission: 'settings' },
    { id: 'earning', label: 'Earning Distribution', icon: TrendingUp, permission: 'mlm' }
  ];

  const visibleSettingsTabs = settingsTabs.filter((tab: any) => hasPermission(tab.permission as any, 'read'));

  useEffect(() => {
    if (activeTab !== 'settings') return;
    if (visibleSettingsTabs.length === 0) return;
    if (!visibleSettingsTabs.some((t: any) => t.id === settingsTab)) {
      setSettingsTab(visibleSettingsTabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, settingsTab, visibleSettingsTabs.length]);

  // =========================================================
  // CRITICAL LOADING/AUTH CHECK
  // =========================================================
  if (authLoading) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading Admin Validation...</p>
          </div>
        </div>
    );
  }

  if (!admin) {
    // This handles the case where validation finished but failed (admin is null)
    // Should typically be handled by a router/wrapper, but this ensures a clean redirect.
    navigate('/backpanel/login', { replace: true });
    return null;
  }
  // =========================================================

  return (
      <div className="min-h-screen bg-gray-50 flex">
        {/* Vertical Sidebar */}
        <div className={`bg-white shadow-lg transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-64'} flex flex-col`}>
          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              {!sidebarCollapsed && (
                  <div>
                    <h1 className="text-lg font-bold text-gray-900">Admin Panel</h1>
                    <p className="text-xs text-gray-500">Management Dashboard</p>
                  </div>
              )}
              <button
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Admin Info */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-red-500 to-orange-500 w-10 h-10 rounded-xl flex items-center justify-center">
                <Shield className="h-5 w-5 text-white" />
              </div>
              {!sidebarCollapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {admin.fullName}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">
                      {admin.role === 'super_admin' ? 'Super Admin' : 'Sub Admin'}
                    </p>
                  </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2">
            {visibleTabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-3 rounded-xl text-left transition-all duration-200 ${
                        activeTab === tab.id
                            ? 'bg-red-50 text-red-600 border border-red-200'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    title={sidebarCollapsed ? tab.label : ''}
                >
                  <tab.icon className="h-5 w-5 flex-shrink-0" />
                  {!sidebarCollapsed && (
                      <span className="font-medium">{tab.label}</span>
                  )}
                </button>
            ))}
          </nav>

          {/* Logout Button */}
          <div className="p-4 border-t border-gray-200">
            <button
                onClick={handleLogout}
                className="w-full flex items-center space-x-3 px-3 py-3 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all duration-200"
                title={sidebarCollapsed ? 'Logout' : ''}
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">Logout</span>}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header */}
          <div className="bg-white shadow-sm border-b border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {tabs.find(tab => tab.id === activeTab)?.label || 'Dashboard'}
                </h2>
                <p className="text-gray-600 mt-1">
                  {activeTab === 'overview' && 'System overview and statistics'}
                  {activeTab === 'customers' && 'Manage customer accounts and profiles'}
                  {activeTab === 'companies' && 'Manage company registrations and verifications'}
                  {activeTab === 'coupons' && 'Manage coupons and sharing rewards'}
                  {activeTab === 'tasks' && 'Create and manage daily tasks for customers'}
                  {activeTab === 'wallets' && 'Monitor user wallets and transactions'}
                  {activeTab === 'subscriptions' && 'Manage subscription plans and pricing'}
                  {activeTab === 'payments' && 'View payment transactions and history'}
                  {activeTab === 'withdrawals' && 'Review and manage withdrawal requests'}
                  {activeTab === 'admins' && 'Manage sub-administrators and permissions'}
                  {activeTab === 'settings' && 'Configure system settings and preferences'}
                </p>
              </div>
              <div className="text-sm text-gray-500">
                Last updated: {new Date().toLocaleString()}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto p-6">
            {activeTab === 'overview' && (
                <div>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {stats.map((stat, index) => (
                        <div key={index} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                              <p className="text-sm text-green-600 mt-1">{stat.change}</p>
                            </div>
                            <div className={`${stat.color} p-3 rounded-lg`}>
                              <stat.icon className="h-6 w-6 text-white" />
                            </div>
                          </div>
                        </div>
                    ))}
                  </div>

                  {/* Recent Activity */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white rounded-xl shadow-sm p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
                      <div className="space-y-3">
                        {overviewLoading ? (
                          <div className="text-sm text-gray-500">Loading activity...</div>
                        ) : overviewRecent.length > 0 ? (
                          overviewRecent.map((item) => {
                            const Icon = getOverviewActivityIcon(item.type);
                            const ts = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
                            return (
                              <div key={item.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                                <Icon className="h-5 w-5 text-blue-600" />
                                <div>
                                  <p className="text-sm font-medium">{item.message}</p>
                                  <p className="text-xs text-gray-500">{ts}</p>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-sm text-gray-500">No recent activity</div>
                        )}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">System Status</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                          <span className="text-sm font-medium">Database</span>
                          <span className="text-sm text-green-600">Online</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                          <span className="text-sm font-medium">Payment Gateway</span>
                          <span className="text-sm text-green-600">Active</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
            )}

            {activeTab === 'customers' && hasPermission('customers', 'read') && (
                <CustomerManagement
                  initialSearchTerm={queryCustomerSearch || undefined}
                  openCustomerId={queryCustomerId || undefined}
                />
            )}

            {activeTab === 'companies' && hasPermission('companies', 'read') && (
                <CompanyManagement />
            )}

            {activeTab === 'coupons' && hasPermission('coupons', 'read') && (
                <CouponManagement />
            )}

            {activeTab === 'tasks' && hasPermission('dailytasks', 'read') && (
                <DailyTaskManagement />
            )}

            {activeTab === 'wallets' && hasPermission('wallets', 'read') && (
                <WalletManagement />
            )}

            {activeTab === 'subscriptions' && hasPermission('subscriptions', 'read') && (
                <SubscriptionManagement />
            )}

            {activeTab === 'payments' && hasPermission('payments', 'read') && (
                <PendingPayments />
            )}

            {activeTab === 'level_counts' && hasPermission('mlm' as any, 'read') && (
                <MLMLevelCounts />
            )}

            {activeTab === 'withdrawals' && hasPermission('withdrawals' as any, 'read') && (
                <WithdrawalRequests />
            )}

            {activeTab === 'admins' && hasPermission('admins', 'read') && (
                <AdminManagement />
            )}

            {activeTab === 'settings' && (hasPermission('settings' as any, 'read') || hasPermission('mlm' as any, 'read')) && (
                <div className="bg-white rounded-xl shadow-sm">
                  {/* Vertical Settings Navigation */}
                  <div className="flex">
                    <div className="w-64 border-r border-gray-200">
                      <div className="p-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Settings</h3>
                        <p className="text-sm text-gray-600">Configure system preferences</p>
                      </div>
                      <nav className="p-4 space-y-2">
                        {visibleSettingsTabs.map((tab: any) => (
                            <button
                                key={tab.id}
                                onClick={() => setSettingsTab(tab.id)}
                                className={`w-full flex items-center space-x-3 px-3 py-3 rounded-lg text-left transition-all duration-200 ${
                                    settingsTab === tab.id
                                        ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                            >
                              <tab.icon className="h-5 w-5" />
                              <span className="font-medium">{tab.label}</span>
                            </button>
                        ))}
                      </nav>
                    </div>

                    {/* Settings Content */}
                    <div className="flex-1 p-6">
	                      {settingsTab === 'general' && hasPermission('settings' as any, 'read') && <GeneralSettings />}
	                      {settingsTab === 'contact_footer' && hasPermission('settings' as any, 'read') && <ContactFooterSettings />}
	                      {settingsTab === 'registration' && hasPermission('settings' as any, 'read') && <RegistrationSettings />}
	                      {settingsTab === 'payment' && hasPermission('settings' as any, 'read') && <PaymentSettings />}
	                      {settingsTab === 'after_launch_plan' && hasPermission('settings' as any, 'read') && <AfterLaunchPlanSettings />}
	                      {settingsTab === 'spin_wheel' && hasPermission('settings' as any, 'read') && <SpinWheelManagement />}
	                      {settingsTab === 'earning' && hasPermission('mlm' as any, 'read') && <EarningDistributionSettings />}
                        {settingsTab === 'general' && !hasPermission('settings' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
                        {settingsTab === 'registration' && !hasPermission('settings' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
                        {settingsTab === 'payment' && !hasPermission('settings' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
                        {settingsTab === 'after_launch_plan' && !hasPermission('settings' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
                        {settingsTab === 'spin_wheel' && !hasPermission('settings' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
                        {settingsTab === 'earning' && !hasPermission('mlm' as any, 'read') && (
                          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                            <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                              <Shield className="h-8 w-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                            <p className="text-gray-600">You don't have permission to access this section.</p>
                          </div>
                        )}
	                    </div>
                  </div>
                </div>
            )}

            {/* Access Denied */}
            {activeTab !== 'overview' && admin && (
              (activeTab === 'settings'
                ? !(hasPermission('settings' as any, 'read') || hasPermission('mlm' as any, 'read'))
                : !!activeTabPermission && !hasPermission(activeTabPermission as any, 'read')
              )
            ) && (
                <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                  <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="h-8 w-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h3>
                  <p className="text-gray-600">You don't have permission to access this section.</p>
                </div>
            )}
          </div>
        </div>

        {/* Create Sub-Admin Modal */}
        {showCreateModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Create New Sub-Admin</h3>
                <form onSubmit={handleCreateSubAdmin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                    <input
                        type="text"
                        required
                        value={newSubAdmin.fullName}
                        onChange={(e) => setNewSubAdmin(prev => ({ ...prev, fullName: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                    <input
                        type="email"
                        required
                        value={newSubAdmin.email}
                        onChange={(e) => setNewSubAdmin(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-4">Permissions</label>
                    <div className="space-y-4">
                      {Object.keys(newSubAdmin.permissions).map((module) => (
                          <div key={module} className="border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-3 capitalize">{module}</h4>
                            <div className="grid grid-cols-3 gap-4">
                              {['read', 'write', 'delete'].map((action) => (
                                  <label key={action} className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={newSubAdmin.permissions[module as keyof typeof newSubAdmin.permissions][action as 'read' | 'write' | 'delete']}
                                        onChange={(e) => updatePermission(module, action, e.target.checked)}
                                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                    />
                                    <span className="ml-2 text-sm text-gray-700 capitalize">{action}</span>
                                  </label>
                              ))}
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                        type="button"
                        onClick={() => setShowCreateModal(false)}
                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      Create Sub-Admin
                    </button>
                  </div>
                </form>
              </div>
            </div>
        )}

        {/* Permissions Modal */}
        {showPermissionsModal && selectedSubAdmin && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 w-full max-w-lg">
                <h3 className="text-lg font-semibold mb-4">
                  Permissions for {selectedSubAdmin.fullName}
                </h3>
                <div className="space-y-3">
                  {Object.entries(selectedSubAdmin.permissions).map(([module, perms]: [string, any]) => (
                      <div key={module} className="border border-gray-200 rounded-lg p-3">
                        <h4 className="font-medium text-gray-900 mb-2 capitalize">{module}</h4>
                        <div className="flex space-x-4 text-sm">
                    <span className={`flex items-center ${perms.read ? 'text-green-600' : 'text-gray-400'}`}>
                      {perms.read ? <Check className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                      Read
                    </span>
                          <span className={`flex items-center ${perms.write ? 'text-green-600' : 'text-gray-400'}`}>
                      {perms.write ? <Check className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                            Write
                    </span>
                          <span className={`flex items-center ${perms.delete ? 'text-green-600' : 'text-gray-400'}`}>
                      {perms.delete ? <Check className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                            Delete
                    </span>
                        </div>
                      </div>
                  ))}
                </div>
                <div className="flex justify-end pt-4">
                  <button
                      onClick={() => setShowPermissionsModal(false)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
};

export default AdminDashboard;
