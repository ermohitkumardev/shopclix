import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAdmin } from '../../contexts/AdminContext';
import { getReferralNetworkStats, supabase } from '../../lib/supabase';
import ReferralLinkGenerator from '../../components/mlm/ReferralLinkGenerator';
import TransactionsDashboard from '../../components/customer/TransactionsDashboard';
import DailyTasksDashboard from '../../components/customer/DailyTasksDashboard';
import CouponInteractionsList from '../../components/customer/CouponInteractionsList';
import WalletList from '../../components/customer/WalletList';
import PaymentHistory from '../../components/customer/PaymentHistory';
import EarningsDashboard from '../../components/customer/EarningsDashboard';
import WithdrawalsDashboard from '../../components/customer/WithdrawalsDashboard';
import ProfileUpdateForm from '../../components/customer/ProfileUpdateForm';
import { useNotification } from '../../components/ui/NotificationProvider';
import {
  Users,
  TrendingUp,
  DollarSign,
  ArrowUpRight,
  Award,
  UserPlus,
  BarChart3,
  CheckSquare,
  ExternalLink,
  Send,
  Download,
  Menu,
  X,
  Home,
  CreditCard,
  Ticket,
  Share2,
  Wallet as WalletIcon,
  User,
} from 'lucide-react';
import MyNetwork from "../../components/mlm/MyNetwork";
import { formatWithdrawalFailureShort } from '../../utils/withdrawalMessages';

interface DashboardStats {
  totalTeam: number;
  totalDirectReferrals: number;
  activeDirectReferrals: number;
  activeTeam: number;
  totalEarnings: number;
  achievementPoints: number;
}

interface RecentActivity {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  amount?: number;
}

type WalletTxRow = {
  twt_id: string;
  twt_transaction_type: 'credit' | 'debit' | 'transfer';
  twt_amount: number;
  twt_currency?: string | null;
  twt_description?: string | null;
  twt_reference_type?: string | null;
  twt_status?: string | null;
  twt_created_at: string;
};

type WithdrawalRow = {
  twr_id: string;
  twr_amount: number;
  twr_status: string;
  twr_requested_at?: string | null;
  twr_processed_at?: string | null;
  twr_failure_reason?: string | null;
};

type EarningsRow = {
  twt_amount: number;
  twt_transaction_type: 'credit' | 'debit' | 'transfer';
};


const CustomerDashboard: React.FC = () => {
  const { user } = useAuth();
  const notification = useNotification();
  const { settings } = useAdmin();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalTeam: 0,
    totalDirectReferrals: 0,
    activeDirectReferrals: 0,
    activeTeam: 0,
    totalEarnings: 0,
    achievementPoints: 0,
  });
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Navigation items
  const navigationItems = [
    { id: 'overview', label: 'Dashboard', icon: BarChart3 },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'interactions', label: 'My Coupons', icon: Ticket, badge: 'Upcoming' },
    { id: 'tasks', label: 'Daily Tasks', icon: CheckSquare, badge: 'Upcoming' },
    { id: 'network', label: 'My Network', icon: Users },
    { id: 'payments', label: 'Payment History', icon: CreditCard },
    { id: 'transactions', label: 'Transactions', icon: CreditCard },
    { id: 'earnings', label: 'Earnings', icon: DollarSign },
    { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpRight },
    { id: 'wallets', label: 'My Wallets', icon: WalletIcon },
    { id: 'referrals', label: 'Referral Links', icon: Share2 },
  ];

  // FIXED: Load dashboard data with proper error handling
  useEffect(() => {
    let mounted = true;

    const loadDashboardData = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      console.log('🔄 Loading dashboard data for user:', user.id);

      try {
        // Load data in parallel with timeout
        const loadPromises = [
          loadTreeStats(),
          loadRecentActivities(),
          loadEarningsStats(),
          // Earnings handled in Earnings tab
        ];

        // Add timeout to prevent infinite loading
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Dashboard load timeout')), 10000)
        );

        await Promise.race([
          Promise.allSettled(loadPromises),
          timeoutPromise
        ]);

        if (mounted) {
          console.log('✅ Dashboard data loaded successfully');
          setInitialLoadComplete(true);
        }
      } catch (error) {
        console.error('❌ Failed to load dashboard data:', error);
        if (mounted) {
          notification.showError('Error', 'Failed to load some dashboard data. Please refresh.');
          setInitialLoadComplete(true); // Still show the dashboard
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDashboardData();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const loadTreeStats = async () => {
    if (!user?.id) return;

    try {
      console.log('📊 Loading tree stats...');

      const stats = await getReferralNetworkStats(user.id);
      console.log('✅ Tree stats loaded:', stats);

      const totalTeam = Number(stats?.total_team || 0);
      const totalDirectReferrals = Number(stats?.total_direct_referrals || 0);
      const activeDirectReferrals = Number(stats?.active_direct_referrals || 0);
      const activeTeam = Number(stats?.active_team || 0);

      setDashboardStats(prev => ({
        ...prev,
        totalTeam,
        totalDirectReferrals,
        activeDirectReferrals,
        activeTeam,
      }));
    } catch (error) {
      console.error('❌ Failed to load tree stats:', error);
      // Don't throw - allow other data to load
    }
  };

  const loadRecentActivities = async () => {
    try {
      console.log('📋 Loading recent activities...');

      if (!user?.id) {
        setRecentActivities([]);
        return;
      }

      const [txRes, wdRes] = await Promise.all([
        supabase
          .from('tbl_wallet_transactions')
          .select('twt_id, twt_transaction_type, twt_amount, twt_currency, twt_description, twt_reference_type, twt_status, twt_created_at')
          .eq('twt_user_id', user.id)
          .order('twt_created_at', { ascending: false })
          .limit(10),
        supabase
          .from('tbl_withdrawal_requests')
          .select('twr_id, twr_amount, twr_status, twr_requested_at, twr_processed_at, twr_failure_reason')
          .eq('twr_user_id', user.id)
          .order('twr_requested_at', { ascending: false })
          .limit(10)
      ]);

      if (txRes.error) throw txRes.error;
      if (wdRes.error) throw wdRes.error;

      const txActivities: RecentActivity[] = (txRes.data || []).map((row: WalletTxRow) => {
        const amount = Number(row.twt_amount || 0);
        const isCredit = row.twt_transaction_type === 'credit';
        const isWithdrawal = String(row.twt_reference_type || '').toLowerCase() === 'withdrawal';
        const status = String(row.twt_status || '').toLowerCase();
        const baseMessage = String(row.twt_description || (isCredit ? 'Wallet credited' : 'Wallet debited'));

        return {
          id: row.twt_id,
          type: isWithdrawal ? 'withdrawal' : isCredit ? 'earning' : 'transaction',
          message: status && status !== 'completed' ? `${baseMessage} (${status})` : baseMessage,
          timestamp: row.twt_created_at,
          amount: Number.isFinite(amount) ? amount : undefined
        };
      });

      const wdActivities: RecentActivity[] = (wdRes.data || []).map((row: WithdrawalRow) => {
        const status = String(row.twr_status || '').toLowerCase();
        const amount = Number(row.twr_amount || 0);
        const ts = row.twr_processed_at || row.twr_requested_at || new Date().toISOString();
        const failureShort = formatWithdrawalFailureShort(row.twr_failure_reason);
        const effectiveStatus = (status === 'completed' && row.twr_failure_reason) ? 'failed' : status;
        const message =
          effectiveStatus === 'pending' ? 'Withdrawal requested' :
            effectiveStatus === 'processing' ? 'Withdrawal processing' :
              effectiveStatus === 'completed' ? 'Withdrawal completed' :
                effectiveStatus === 'rejected' ? 'Withdrawal rejected' :
                  effectiveStatus === 'failed' ? 'Withdrawal failed' :
                    `Withdrawal ${effectiveStatus}`;

        return {
          id: row.twr_id,
          type: 'withdrawal',
          message: failureShort ? `${message} (${failureShort})` : message,
          timestamp: ts,
          amount: Number.isFinite(amount) ? amount : undefined
        };
      });

      const merged = [...txActivities, ...wdActivities]
        .filter((a) => a.timestamp)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
        .slice(0, 6);

      setRecentActivities(merged);
      console.log('✅ Recent activities loaded');
    } catch (error) {
      console.error('❌ Failed to load recent activities:', error);
    }
  };

  const loadEarningsStats = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_wallet_transactions')
        .select('twt_amount, twt_transaction_type, twt_status, twt_created_at')
        .eq('twt_user_id', user.id)
        .eq('twt_currency', 'USDT')
        .eq('twt_status', 'completed')
        .limit(5000);

      if (error) throw error;

      const totalCredits = ((data || []) as EarningsRow[])
        .filter((row) => row.twt_transaction_type === 'credit')
        .reduce((sum, row) => sum + Number(row.twt_amount || 0), 0);

      setDashboardStats((prev) => ({
        ...prev,
        totalEarnings: Number(totalCredits.toFixed(2))
      }));
    } catch (error) {
      console.error('❌ Failed to load earnings stats:', error);
    }
  };

  const handleInviteMembers = () => {
    setActiveTab('referrals');
    setIsSidebarOpen(false);
    notification.showInfo('Invite Members', 'Use your referral links to invite new members!');
  };

  const handleViewEarningsReport = () => {
    setActiveTab('earnings');
    setIsSidebarOpen(false);
  };

  const handleUpgradePlan = () => {
    if ((settings?.launchPhase || 'prelaunch') !== 'launched') {
      notification.showInfo('Not Available Yet', 'Upgrade plans will be available after launch.');
      return;
    }
    setIsSidebarOpen(false);
    navigate('/subscription-plans');
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    return `${Math.floor(diffInSeconds / 86400)} days ago`;
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'referral': return UserPlus;
      case 'earning': return DollarSign;
      case 'level': return Award;
      case 'withdrawal': return ArrowUpRight;
      case 'transaction': return CreditCard;
      default: return UserPlus;
    }
  };

  const stats = [
    {
      title: 'Total Team',
      value: dashboardStats.totalTeam,
      icon: Users,
      color: 'bg-blue-600',
      change: 'All downline levels',
    },
    {
      title: 'Active Team',
      value: dashboardStats.activeTeam,
      icon: Award,
      color: 'bg-emerald-600',
      change: 'Paid & active all levels',
    },
    {
      title: 'Total Referrals',
      value: dashboardStats.totalDirectReferrals,
      icon: UserPlus,
      color: 'bg-cyan-500',
      change: 'Directly by you',
    },
    {
      title: 'Active Referrals',
      value: dashboardStats.activeDirectReferrals,
      icon: TrendingUp,
      color: 'bg-green-500',
      change: 'Paid & active direct',
    },
    {
      title: 'Total Earnings',
      value: `${dashboardStats.totalEarnings.toFixed(2)} USDT`,
      icon: DollarSign,
      color: 'bg-amber-500',
      change: 'All time',
    },
  ];

  // FIXED: Show loading only on initial load
  if (loading && !initialLoadComplete) {
    return (
        <div className="min-h-screen bg-gray-50 py-8 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="text-gray-500 mt-4">Loading dashboard...</p>
            <p className="text-gray-400 text-sm mt-2">Please wait...</p>
          </div>
        </div>
    );
  }

  // FIXED: Show error if user not loaded
  if (!user) {
    return (
        <div className="min-h-screen bg-gray-50 py-8 flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-500 mb-4">
              <X className="h-12 w-12 mx-auto" />
            </div>
            <p className="text-gray-900 font-semibold">User not found</p>
            <p className="text-gray-500 mt-2">Please login again</p>
          </div>
        </div>
    );
  }

  return (
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar Navigation */}
        <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0 lg:shadow-none
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Home className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
            </div>
          </div>

          <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100vh-80px)]">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
                  <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-colors ${
                          activeTab === item.id
                              ? 'bg-indigo-50 text-indigo-700 border-r-2 border-indigo-600'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
	                  >
	                    <Icon className="h-5 w-5 flex-shrink-0" />
	                    <div className="flex-1 flex items-center justify-between min-w-0">
	                      <span className="font-medium truncate">{item.label}</span>
	                      {item.badge && (
	                        <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-800">
	                          {item.badge}
	                        </span>
	                      )}
	                    </div>
	                  </button>
	              );
	            })}
	          </nav>
	        </div>

        {/* Overlay for mobile */}
        {isSidebarOpen && (
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
                onClick={() => setIsSidebarOpen(false)}
            />
        )}

        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Welcome back, {user?.firstName || 'User'}!
                </h1>
                <p className="text-gray-600 mt-2">
                  User ID:{' '}
                  <span className="font-semibold text-indigo-600">{user?.sponsorshipNumber || 'N/A'}</span>
                </p>
              </div>

              {/* Mobile sidebar toggle (in-flow so it won't overlap content) */}
              <button
                onClick={() => setIsSidebarOpen((v) => !v)}
                className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-200 bg-white text-indigo-700 shadow-sm hover:bg-indigo-50"
                aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
                title={isSidebarOpen ? 'Close menu' : 'Open menu'}
              >
                {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

            {/* Stats Grid - Only show on overview tab */}
            {activeTab === 'overview' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
                  {stats.map((stat, index) => (
                      <div key={index} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <div className={`${stat.color} p-2.5 rounded-lg`}>
                              <stat.icon className="h-5 w-5 text-white" />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-500 leading-tight">{stat.title}</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1 leading-none">{stat.value}</p>
                            <p className="text-xs text-gray-400 mt-1">{stat.change}</p>
                          </div>
                        </div>
                      </div>
                  ))}
                </div>
            )}

            {/* Tab Content */}
            <div className="bg-white rounded-xl shadow-sm">
              <div className="p-6">
                {activeTab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Quick Actions */}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
                        <div className="space-y-3">
                          <button
                              onClick={handleInviteMembers}
                              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2"
                          >
                            <Send className="h-4 w-4" />
                            <span>Invite New Members</span>
                          </button>
                          <button
                              onClick={handleViewEarningsReport}
                              className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center justify-center space-x-2"
                          >
                            <Download className="h-4 w-4" />
                            <span>View Earnings Report</span>
                          </button>
	                          {(settings?.launchPhase || 'prelaunch') === 'launched' && (
	                            <button
	                              onClick={handleUpgradePlan}
	                              className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-purple-700 transition-colors flex items-center justify-center space-x-2"
	                            >
	                              <ExternalLink className="h-4 w-4" />
	                              <span>Upgrade Plan</span>
	                            </button>
	                          )}
                        </div>
                      </div>

                      {/* Recent Activities */}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activities</h3>
                        <div className="space-y-4">
                          {recentActivities.length > 0 ? (
                              recentActivities.map((activity) => {
                                const ActivityIcon = getActivityIcon(activity.type);
                                return (
                                    <div key={activity.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                                      <div className="bg-indigo-100 p-2 rounded-full">
                                        <ActivityIcon className="h-4 w-4 text-indigo-600" />
                                      </div>
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-900">
                                          {activity.message}
                                          {activity.amount && `: $${activity.amount}`}
                                        </p>
                                        <p className="text-xs text-gray-500">{formatTimeAgo(activity.timestamp)}</p>
                                      </div>
                                    </div>
                                );
                              })
                          ) : (
                              <p className="text-gray-500 text-center py-4">No recent activities</p>
                          )}
                        </div>
                      </div>
                    </div>
                )}

                {activeTab === 'network' && (
                    <div>
                      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                        <p className="text-gray-600">
                          Parent Account User ID:{' '}
                          <span className="font-semibold text-indigo-600">{user?.parentId || 'N/A'}</span>
                        </p>
                      </div>
                      {/* FIXED: Now uses the new MyNetwork component */}
                      <MyNetwork userId={user?.id || ''} />
                    </div>
                )}

                {activeTab === 'profile' && (
                    <div>
                      <ProfileUpdateForm />
                    </div>
                )}

                {activeTab === 'transactions' && (
                    <div>
                      <TransactionsDashboard />
                    </div>
                )}

                {activeTab === 'tasks' && (
                    <div>
                      <DailyTasksDashboard />
                    </div>
                )}

                {activeTab === 'interactions' && (
                    <div>
                      <CouponInteractionsList />
                    </div>
                )}

                {activeTab === 'earnings' && (
                    <div>
                      <EarningsDashboard />
                    </div>
                )}

                {activeTab === 'withdrawals' && (
                    <div>
                      <WithdrawalsDashboard />
                    </div>
                )}

                {activeTab === 'referrals' && (
                    <div>
                      <ReferralLinkGenerator />
                    </div>
                )}

                {activeTab === 'wallets' && (
                    <div>
                      <WalletList userId={user?.id || ''} />
                    </div>
                )}

                {activeTab === 'payments' && (
                    <div>
                      <PaymentHistory userId={user?.id || ''} />
                    </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};

export default CustomerDashboard;
