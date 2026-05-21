import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../ui/NotificationProvider';
import { processingIndicator } from '../../lib/processingIndicator';
import { getCustomerFriendlyWithdrawalMessage } from '../../utils/withdrawalMessages';
import {
  Wallet,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Gift,
  Share2,
  Video,
  Target,
  Eye,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  Upload,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Link as LinkIcon,
  X
} from 'lucide-react';

interface WalletData {
  tw_id: string;
  tw_balance: number;
  tw_reserved_balance?: number;
  tw_currency: string;
  tw_wallet_address?: string;
  tw_is_active: boolean;
  tw_wallet_type?: string;
}

interface Transaction {
  twt_id: string;
  twt_transaction_type: 'credit' | 'debit' | 'transfer';
  twt_amount: number;
  twt_currency: string;
  twt_description: string;
  twt_reference_type?: string;
  twt_reference_id?: string;
  twt_blockchain_hash?: string;
  twt_status: 'pending' | 'completed' | 'failed' | 'cancelled';
  twt_created_at: string;
}

interface WithdrawalRequest {
  twr_id: string;
  twr_amount: number;
  twr_commission_percent: number;
  twr_commission_amount: number;
  twr_net_amount: number;
  twr_status: string;
  twr_destination_address: string;
  twr_requested_at: string;
  twr_blockchain_tx?: string | null;
  twr_failure_reason?: string | null;
}

interface WithdrawalSettings {
  minAmount: number;
  stepAmount: number;
  commissionPercent: number;
  autoTransfer: boolean;
  processingDays: number;
}

interface DefaultWalletConnection {
  tuwc_id: string;
  tuwc_wallet_address: string;
  tuwc_wallet_type: string;
  tuwc_chain_id: number;
}

interface DailyTask {
  tdt_id: string;
  tdt_task_type: 'coupon_share' | 'social_share' | 'video_share' | 'custom';
  tdt_title: string;
  tdt_description?: string;
  tdt_content_url?: string;
  tdt_reward_amount: number;
  tdt_expires_at: string;
  tdt_is_active: boolean;
  coupon_info?: {
    title: string;
    coupon_code?: string | null;
    image_url?: string;
    website_url?: string;
    description?: string | null;
  };
  user_task?: {
    completion_status: 'assigned' | 'in_progress' | 'completed' | 'verified' | 'expired' | 'failed';
    completed_at?: string;
    user_feedback?: 'liked' | 'disliked' | 'used';
    user_note?: string;
  };
}

const renderDescriptionWithBullets = (description?: string | null) => {
  if (!description) return null;

  const items = description
    .split(/\r?\n+/)
    .map((item) => item.replace(/^[\s\-*•\d.]+/, '').trim())
    .filter(Boolean);

  if (items.length <= 1) {
    return <p className="text-gray-600 text-sm mb-4">{description}</p>;
  }

  return (
    <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
};

const WalletDashboard: React.FC = () => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'tasks' | 'withdrawals'>('overview');
  const [selectedTask, setSelectedTask] = useState<DailyTask | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [withdrawalSettings, setWithdrawalSettings] = useState<WithdrawalSettings>({
    minAmount: 10,
    stepAmount: 10,
    commissionPercent: 0.5,
    autoTransfer: false,
    processingDays: 5
  });
  const [withdrawalAmount, setWithdrawalAmount] = useState(0);
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [defaultWallet, setDefaultWallet] = useState<DefaultWalletConnection | null>(null);
  const [cancelingWithdrawalId, setCancelingWithdrawalId] = useState<string | null>(null);
  const [userFeedback, setUserFeedback] = useState({
    feedback: '' as 'liked' | 'disliked' | '',
    note: ''
  });
  const notification = useNotification();

  const pendingWithdrawalTotal = React.useMemo(() => {
    const pendingStatuses = new Set(['pending', 'processing', 'approved']);
    return (withdrawalRequests || [])
      .filter((r) => pendingStatuses.has(String(r.twr_status || '').toLowerCase()))
      .reduce((sum, r) => sum + Number(r.twr_amount || 0), 0);
  }, [withdrawalRequests]);

  const walletTotalBalance = Number(wallet?.tw_balance || 0);
  const walletReservedBalance = Number(wallet?.tw_reserved_balance || 0);
  const withdrawableBalance = Math.max(0, walletTotalBalance - walletReservedBalance - Number(pendingWithdrawalTotal || 0));

  useEffect(() => {
    if (user?.id) {
      setWallet(null);
      setTransactions([]);
      setDailyTasks([]);
      setWithdrawalRequests([]);
      setDefaultWallet(null);
      setLoading(true);
      loadWalletData();
      loadTransactions();
      loadDailyTasks();
      loadWithdrawalSettings();
      loadWithdrawalRequests();
      loadDefaultWallet();
    } else {
      setWallet(null);
      setTransactions([]);
      setDailyTasks([]);
      setWithdrawalRequests([]);
      setDefaultWallet(null);
      setLoading(false);
      setWithdrawalsLoading(false);
    }
  }, [user?.id]);

  const loadWalletData = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
          .from('tbl_wallets')
          .select('*')
          .eq('tw_user_id', user.id)
          .eq('tw_currency', 'USDT')
          .eq('tw_wallet_type', 'working')
          .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setWallet(data);
    } catch (error) {
      console.error('Failed to load wallet:', error);
    }
  };

  const loadTransactions = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
          .from('tbl_wallet_transactions')
          .select('*')
          .eq('twt_user_id', user.id)
          .order('twt_created_at', { ascending: false })
          .limit(20);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    }
  };

  const loadDailyTasks = async () => {
    if (!user?.id) return;

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
          .from('tbl_daily_tasks')
          .select(`
          *,
          tbl_coupons(tc_title, tc_coupon_code, tc_image_url, tc_website_url, tc_description),
          tbl_user_tasks(tut_completion_status, tut_completed_at, tut_user_feedback, tut_user_note)
        `)
          .eq('tdt_task_date', today)
          .eq('tdt_is_active', true)
          .gte('tdt_expires_at', new Date().toISOString())
          .order('tdt_created_at', { ascending: false });

      if (error) throw error;

      const formattedTasks = (data || []).map(task => ({
        ...task,
        coupon_info: task.tbl_coupons ? {
          title: task.tbl_coupons.tc_title,
          coupon_code: task.tbl_coupons.tc_coupon_code,
          image_url: task.tbl_coupons.tc_image_url,
          website_url: task.tbl_coupons.tc_website_url,
          description: task.tbl_coupons.tc_description
        } : undefined,
        user_task: task.tbl_user_tasks?.[0] ? {
          completion_status: task.tbl_user_tasks[0].tut_completion_status,
          completed_at: task.tbl_user_tasks[0].tut_completed_at,
          user_feedback: task.tbl_user_tasks[0].tut_user_feedback,
          user_note: task.tbl_user_tasks[0].tut_user_note
        } : undefined
      }));

      setDailyTasks(formattedTasks);
    } catch (error) {
      console.error('Failed to load daily tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWithdrawalSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('tbl_system_settings')
        .select('tss_setting_key, tss_setting_value')
        .in('tss_setting_key', [
          'withdrawal_min_amount',
          'withdrawal_step_amount',
          'withdrawal_commission_percent',
          'withdrawal_auto_transfer',
          'withdrawal_processing_days'
        ]);

      if (error) throw error;

      const settingsMap = (data || []).reduce((acc: any, setting: any) => {
        try {
          acc[setting.tss_setting_key] = JSON.parse(setting.tss_setting_value);
        } catch {
          acc[setting.tss_setting_key] = setting.tss_setting_value;
        }
        return acc;
      }, {});

      setWithdrawalSettings({
        minAmount: Number(settingsMap.withdrawal_min_amount ?? 10),
        stepAmount: Number(settingsMap.withdrawal_step_amount ?? 10),
        commissionPercent: Number(settingsMap.withdrawal_commission_percent ?? 0.5),
        autoTransfer: Boolean(settingsMap.withdrawal_auto_transfer ?? false),
        processingDays: Number(settingsMap.withdrawal_processing_days ?? 5)
      });
    } catch (error) {
      console.error('Failed to load withdrawal settings:', error);
    }
  };

  const loadDefaultWallet = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_user_wallet_connections')
        .select('tuwc_id, tuwc_wallet_address, tuwc_wallet_type, tuwc_chain_id')
        .eq('tuwc_user_id', user.id)
        .eq('tuwc_is_default', true)
        .eq('tuwc_is_active', true)
        .maybeSingle();

      if (error) throw error;
      setDefaultWallet(data || null);
    } catch (error) {
      console.error('Failed to load default wallet:', error);
    }
  };

  const loadWithdrawalRequests = async () => {
    if (!user?.id) return;
    setWithdrawalsLoading(true);
    try {
      const { data, error } = await supabase
        .from('tbl_withdrawal_requests')
        .select('twr_id, twr_wallet_connection_id, twr_destination_address, twr_amount, twr_commission_percent, twr_commission_amount, twr_net_amount, twr_status, twr_auto_transfer, twr_requested_at, twr_processed_at, twr_blockchain_tx, twr_failure_reason')
        .eq('twr_user_id', user.id)
        .eq('twr_wallet_type', 'working')
        .order('twr_requested_at', { ascending: false });

      if (error) throw error;
      setWithdrawalRequests(data || []);
    } catch (error) {
      console.error('Failed to load withdrawals:', error);
    } finally {
      setWithdrawalsLoading(false);
    }
  };

  const isStepValid = (amount: number, step: number) => {
    if (step <= 0) return true;
    const factor = 100; // cents precision
    const scaledAmount = Math.round(amount * factor);
    const scaledStep = Math.round(step * factor);
    return scaledAmount % scaledStep === 0;
  };

  const handleWithdrawalSubmit = async () => {
    if (!user?.id) return;

    if (!defaultWallet?.tuwc_wallet_address) {
      notification.showError('Missing Wallet', 'Please set a default wallet before withdrawing.');
      return;
    }

    if (withdrawalAmount <= 0) {
      notification.showError('Invalid Amount', 'Enter a valid withdrawal amount.');
      return;
    }

    if (withdrawalAmount < withdrawalSettings.minAmount) {
      notification.showError(
        'Minimum Withdrawal',
        `Minimum withdrawal amount is ${withdrawalSettings.minAmount} USDT.`
      );
      return;
    }

    if (!isStepValid(withdrawalAmount, withdrawalSettings.stepAmount)) {
      notification.showError(
        'Invalid Step',
        `Withdrawal amount must be in multiples of ${withdrawalSettings.stepAmount} USDT.`
      );
      return;
    }

    if (withdrawalAmount > withdrawableBalance) {
      notification.showError(
        'Insufficient Balance',
        pendingWithdrawalTotal > 0 || walletReservedBalance > 0
          ? `Withdrawable balance is ${withdrawableBalance.toFixed(2)} USDT (some funds are reserved).`
          : 'Your wallet balance is too low for this withdrawal.'
      );
      return;
    }

    setWithdrawalSubmitting(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (!token) {
        throw new Error('Missing user session');
      }

      const result = await processingIndicator.track(async () => {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-withdrawal`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: withdrawalAmount,
            walletType: 'working'
          })
        });

        return response.json();
      }, 'Submitting withdrawal...');

      if (!result.success) {
        throw new Error(result.error || 'Withdrawal request failed');
      }

      notification.showSuccess(
        withdrawalSettings.autoTransfer ? 'Withdrawal Submitted' : 'Withdrawal Requested',
        withdrawalSettings.autoTransfer
          ? 'Your withdrawal is being processed automatically.'
          : `Your approval request will be entertained within ${withdrawalSettings.processingDays} working day(s).`
      );

      setWithdrawalAmount(0);
      loadWithdrawalRequests();
      loadWalletData();
    } catch (error: any) {
      notification.showError('Withdrawal Failed', error.message || 'Unable to submit withdrawal');
    } finally {
      setWithdrawalSubmitting(false);
    }
  };

  const handleCancelWithdrawal = async (withdrawalId: string) => {
    if (!user?.id) return;
    setCancelingWithdrawalId(withdrawalId);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (!token) {
        throw new Error('Missing user session');
      }

      const result = await processingIndicator.track(async () => {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-withdrawal`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ withdrawalId })
        });

        return response.json();
      }, 'Cancelling withdrawal...');
      if (!result.success) {
        throw new Error(result.error || 'Cancellation failed');
      }

      notification.showSuccess('Withdrawal Cancelled', 'Your withdrawal request has been cancelled.');
      loadWithdrawalRequests();
    } catch (error: any) {
      notification.showError('Cancellation Failed', error.message || 'Unable to cancel withdrawal');
    } finally {
      setCancelingWithdrawalId(null);
    }
  };

  const handleCouponFeedback = async (feedback: 'liked' | 'disliked', note: string = '') => {
    if (!selectedTask || !user?.id) return;

    try {
      const { error } = await supabase
          .from('tbl_user_tasks')
          .upsert({
            tut_user_id: user.id,
            tut_task_id: selectedTask.tdt_id,
            tut_completion_status: 'completed',
            tut_user_feedback: feedback,
            tut_user_note: note,
            tut_completed_at: new Date().toISOString()
          });

      if (error) throw error;

      notification.showSuccess(
          'Feedback Submitted!',
          `Thank you for your feedback on "${selectedTask.coupon_info?.title}"`
      );

      setShowFeedbackModal(false);
      setSelectedTask(null);
      setUserFeedback({ feedback: '', note: '' });

      loadDailyTasks();
    } catch (error: any) {
      console.error('Failed to submit feedback:', error);
      notification.showError('Submission Failed', error.message || 'Failed to submit feedback');
    }
  };

  const handleUseCoupon = async (task = selectedTask) => {
    if (!task || !user?.id) return;

    setSelectedTask(task);

    // Open the coupon website in a new tab
    if (task.coupon_info?.website_url) {
      window.open(task.coupon_info.website_url, '_blank', 'noopener,noreferrer');
    }

    setShowConfirmationModal(true);
  };

  const confirmCouponUsage = async () => {
    if (!selectedTask || !user?.id) return;

    try {
      const { data, error } = await supabase.rpc('complete_coupon_task', {
        p_user_id: user.id,
        p_task_id: selectedTask.tdt_id,
        p_coupon_used: true
      });

      if (error) throw error;

      notification.showSuccess(
          'Task Completed!',
          `You earned ${selectedTask.tdt_reward_amount} USDT for using the coupon!`
      );

      setShowConfirmationModal(false);
      setSelectedTask(null);

      // Refresh data
      loadWalletData();
      loadTransactions();
      loadDailyTasks();
    } catch (error: any) {
      console.error('Failed to complete task:', error);
      notification.showError('Task Failed', error.message || 'Failed to complete task');
    }
  };

  const handleCouponNotUsed = async () => {
    if (!selectedTask || !user?.id) return;

    try {
      const { error } = await supabase
        .from('tbl_user_tasks')
        .upsert({
          tut_user_id: user.id,
          tut_task_id: selectedTask.tdt_id,
          tut_completion_status: 'in_progress',
          tut_user_feedback: 'disliked',
          tut_user_note: 'Coupon was not used'
        });

      if (error) throw error;

      notification.showInfo('Noted', 'We marked this coupon as not used.');
      setShowConfirmationModal(false);
      setSelectedTask(null);
    } catch (error: any) {
      notification.showError('Update Failed', error.message || 'Failed to update coupon usage');
    }
  };

  const handleSocialTaskCompletion = async () => {
    if (!selectedTask || !user?.id) return;

    try {
      const { data, error } = await supabase.rpc('complete_social_task', {
        p_user_id: user.id,
        p_task_id: selectedTask.tdt_id
      });

      if (error) throw error;

      notification.showSuccess(
          'Task Completed!',
          `You earned ${selectedTask.tdt_reward_amount} USDT for completing the task!`
      );

      setSelectedTask(null);

      // Refresh data
      loadWalletData();
      loadTransactions();
      loadDailyTasks();
    } catch (error: any) {
      console.error('Failed to complete task:', error);
      notification.showError('Task Failed', error.message || 'Failed to complete task');
    }
  };

  const getTaskIcon = (taskType: string) => {
    switch (taskType) {
      case 'coupon_share': return Gift;
      case 'social_share': return Share2;
      case 'video_share': return Video;
      default: return Target;
    }
  };

  const getTransactionIcon = (type: string, referenceType?: string) => {
    if (
      referenceType === 'task_reward' ||
      referenceType === 'coupon_share' ||
      referenceType === 'registration_parent_income' ||
      referenceType === 'mlm_level_reward' ||
      referenceType === 'mlm_level_reward_reserved'
    ) return Gift;
    if (referenceType === 'social_share') return Share2;
    return type === 'credit' ? ArrowUpRight : ArrowDownLeft;
  };

  if (loading) {
    return (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
    );
  }

  return (
      <div className="space-y-6">
	        {/* Wallet Overview */}
	        <div className="bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-3 rounded-lg">
                <Wallet className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">USDT Wallet</h3>
                <p className="text-green-100">Your earning wallet</p>
              </div>
            </div>
            <button
                onClick={() => {
                  loadWalletData();
                  loadTransactions();
                }}
                className="bg-white/20 p-2 rounded-lg hover:bg-white/30 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
	          </div>
	          <div className="text-3xl font-bold mb-2">
	            {withdrawableBalance.toFixed(2)} USDT
	          </div>
	          <p className="text-green-100">Withdrawable Balance</p>
            <p className="text-xs text-white/80 mt-1">
              Total: {walletTotalBalance.toFixed(2)} USDT
              {pendingWithdrawalTotal > 0 ? ` • Reserved: ${pendingWithdrawalTotal.toFixed(2)} USDT` : ''}
            </p>
	        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {[
                { id: 'overview', label: 'Overview', icon: TrendingUp },
                { id: 'transactions', label: 'Transactions', icon: DollarSign },
                { id: 'tasks', label: 'Daily Tasks', icon: Calendar },
                { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpRight }
              ].map((tab) => (
                  <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                          activeTab === tab.id
                              ? 'border-green-500 text-green-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    <tab.icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Recent Transactions */}
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Recent Transactions</h4>
                    <div className="space-y-3">
                      {transactions.slice(0, 5).map((transaction) => {
                        const Icon = getTransactionIcon(transaction.twt_transaction_type, transaction.twt_reference_type);
                        return (
                            <div key={transaction.twt_id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                              <div className={`p-2 rounded-full ${
                                  transaction.twt_transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                              }`}>
                                <Icon className={`h-4 w-4 ${
                                    transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                                }`} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">{transaction.twt_description}</p>
                                <p className="text-xs text-gray-500">
                                  {new Date(transaction.twt_created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <div className={`text-sm font-medium ${
                                  transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {transaction.twt_transaction_type === 'credit' ? '+' : '-'}{transaction.twt_amount} USDT
                              </div>
                            </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Today's Tasks */}
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Today's Tasks</h4>
                    <div className="space-y-3">
                      {dailyTasks.slice(0, 5).map((task) => {
                        const TaskIcon = getTaskIcon(task.tdt_task_type);
                        const isCompleted = task.user_task?.completion_status === 'completed' || task.user_task?.completion_status === 'verified';

                        return (
                            <div key={task.tdt_id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                              <div className={`p-2 rounded-full ${
                                  isCompleted ? 'bg-green-100' : 'bg-blue-100'
                              }`}>
                                <TaskIcon className={`h-4 w-4 ${
                                    isCompleted ? 'text-green-600' : 'text-blue-600'
                                }`} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">{task.tdt_title}</p>
                                <p className="text-xs text-gray-500">
                                  Reward: {task.tdt_reward_amount} USDT
                                </p>
                              </div>
                              <div className={`text-xs px-2 py-1 rounded-full font-medium ${
                                  isCompleted ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {isCompleted ? 'Completed' : 'Available'}
                              </div>
                            </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
            )}

            {activeTab === 'transactions' && (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-semibold text-gray-900">Transaction History</h4>
                    <div className="text-sm text-gray-500">
                      Total: {transactions.length} transactions
                    </div>
                  </div>

                  <div className="space-y-4">
                    {transactions.map((transaction) => {
                      const Icon = getTransactionIcon(transaction.twt_transaction_type, transaction.twt_reference_type);
                      return (
                          <div key={transaction.twt_id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-4">
                                <div className={`p-3 rounded-full ${
                                    transaction.twt_transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                                }`}>
                                  <Icon className={`h-5 w-5 ${
                                      transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                                  }`} />
                                </div>
                                <div>
                                  <h5 className="font-medium text-gray-900">{transaction.twt_description}</h5>
                                  <div className="flex items-center space-x-4 mt-1">
                              <span className="text-sm text-gray-500">
                                {new Date(transaction.twt_created_at).toLocaleDateString()} at {new Date(transaction.twt_created_at).toLocaleTimeString()}
                              </span>
                                    {transaction.twt_reference_type && (
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                                  {transaction.twt_reference_type.replace('_', ' ')}
                                </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-lg font-bold ${
                                    transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                                }`}>
                                  {transaction.twt_transaction_type === 'credit' ? '+' : '-'}{transaction.twt_amount} USDT
                                </div>
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                    transaction.twt_status === 'completed' ? 'bg-green-100 text-green-800' :
                                        transaction.twt_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                }`}>
                            {transaction.twt_status}
                          </span>
                              </div>
                            </div>
                          </div>
                      );
                    })}
                  </div>

                  {transactions.length === 0 && (
                      <div className="text-center py-12">
                        <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions yet</h3>
                        <p className="text-gray-600">Complete daily tasks to start earning USDT rewards!</p>
                      </div>
                  )}
                </div>
            )}

            {activeTab === 'tasks' && (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-lg font-semibold text-gray-900">Today's Tasks</h4>
                    <div className="text-sm text-gray-500">
                      {dailyTasks.filter(t => t.user_task?.completion_status === 'completed' || t.user_task?.completion_status === 'verified').length} / {dailyTasks.length} completed
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {dailyTasks.map((task) => {
                      const TaskIcon = getTaskIcon(task.tdt_task_type);
                      const isCompleted = task.user_task?.completion_status === 'completed' || task.user_task?.completion_status === 'verified';
                      const isExpired = new Date(task.tdt_expires_at) < new Date();

                      return (
                          <div key={task.tdt_id} className={`border rounded-xl p-6 transition-all ${
                              isCompleted ? 'border-green-200 bg-green-50' :
                                  isExpired ? 'border-red-200 bg-red-50' :
                                      'border-gray-200 hover:shadow-lg'
                          }`}>
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center space-x-3">
                                <div className={`p-2 rounded-lg ${
                                    task.tdt_task_type === 'coupon_share' ? 'bg-orange-100' :
                                        task.tdt_task_type === 'social_share' ? 'bg-blue-100' :
                                            task.tdt_task_type === 'video_share' ? 'bg-red-100' :
                                                'bg-purple-100'
                                }`}>
                                  <TaskIcon className={`h-5 w-5 ${
                                      task.tdt_task_type === 'coupon_share' ? 'text-orange-600' :
                                          task.tdt_task_type === 'social_share' ? 'text-blue-600' :
                                              task.tdt_task_type === 'video_share' ? 'text-red-600' :
                                                  'text-purple-600'
                                  }`} />
                                </div>
                                <div>
                                  <h5 className="font-semibold text-gray-900">{task.tdt_title}</h5>
                                  <p className="text-sm text-gray-500 capitalize">{task.tdt_task_type.replace('_', ' ')}</p>
                                </div>
                              </div>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  isCompleted ? 'bg-green-100 text-green-800' :
                                      isExpired ? 'bg-red-100 text-red-800' :
                                          'bg-yellow-100 text-yellow-800'
                              }`}>
                          {isCompleted ? 'Completed' : isExpired ? 'Expired' : 'Available'}
                        </span>
                            </div>

                            {renderDescriptionWithBullets(task.coupon_info?.description || task.tdt_description)}

                            {task.coupon_info && (
                                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                                  <div className="flex items-center space-x-2">
                                    <Gift className="h-4 w-4 text-orange-600" />
                                    <span className="text-sm font-medium text-orange-800">
                              {task.coupon_info.title}
                            </span>
                                  </div>
                                  <p className="text-xs text-orange-600 font-mono mt-1">
                                    Code: {task.coupon_info.coupon_code || 'No code required'}
                                  </p>
                                </div>
                            )}

                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center space-x-2">
                                <DollarSign className="h-4 w-4 text-green-600" />
                                <span className="font-medium text-green-600">{task.tdt_reward_amount} USDT</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Clock className="h-4 w-4 text-gray-400" />
                                <span className="text-sm text-gray-500">
                                  Expires: {new Date(task.tdt_expires_at).toLocaleTimeString()}
                                </span>
                              </div>
                            </div>

                            {!isCompleted && !isExpired && (
                                <div className="space-y-3">
                                  {task.tdt_task_type === 'coupon_share' ? (
                                      <>
                                        <div className="grid grid-cols-2 gap-2">
                                          <button
                                              onClick={() => {
                                                setSelectedTask(task);
                                                setUserFeedback({ feedback: 'liked', note: '' });
                                                setShowFeedbackModal(true);
                                              }}
                                              className="flex items-center justify-center space-x-2 bg-green-100 text-green-700 py-2 px-4 rounded-lg font-medium hover:bg-green-200 transition-colors"
                                          >
                                            <ThumbsUp className="h-4 w-4" />
                                            <span>Like</span>
                                          </button>
                                          <button
                                              onClick={() => {
                                                setSelectedTask(task);
                                                setUserFeedback({ feedback: 'disliked', note: '' });
                                                setShowFeedbackModal(true);
                                              }}
                                              className="flex items-center justify-center space-x-2 bg-red-100 text-red-700 py-2 px-4 rounded-lg font-medium hover:bg-red-200 transition-colors"
                                          >
                                            <ThumbsDown className="h-4 w-4" />
                                            <span>Dislike</span>
                                          </button>
                                        </div>
                                        <button
                                            onClick={() => {
                                              setSelectedTask(task);
                                              handleUseCoupon(task);
                                            }}
                                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                                        >
                                          Use Coupon
                                        </button>
                                      </>
                                  ) : (
                                      <button
                                          onClick={() => {
                                            setSelectedTask(task);
                                            handleSocialTaskCompletion();
                                          }}
                                          className="w-full bg-green-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-700 transition-colors"
                                      >
                                        Complete Task
                                      </button>
                                  )}
                                </div>
                            )}

                            {isCompleted && task.user_task?.completed_at && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                  <div className="flex items-center space-x-2">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    <span className="text-sm text-green-800">
                              Completed on {new Date(task.user_task.completed_at).toLocaleDateString()}
                            </span>
                                  </div>
                                  {task.user_task.user_feedback && (
                                      <p className="text-xs text-green-700 mt-1">
                                        Feedback: {task.user_task.user_feedback}
                                        {task.user_task.user_note && ` - ${task.user_task.user_note}`}
                                      </p>
                                  )}
                                </div>
                            )}
                          </div>
                      );
                    })}
                  </div>

                  {dailyTasks.length === 0 && (
                      <div className="text-center py-12">
                        <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks available</h3>
                        <p className="text-gray-600">Check back later for new daily tasks!</p>
                      </div>
                  )}
                </div>
            )}

            {activeTab === 'withdrawals' && (
              <div className="space-y-6">
                <div className="border border-gray-200 rounded-xl p-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Request Withdrawal</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Amount (USDT)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={withdrawalAmount}
                        onChange={(event) => setWithdrawalAmount(Number(event.target.value))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder={`Minimum ${withdrawalSettings.minAmount} USDT`}
                      />
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Default Wallet</p>
                      <p className="text-sm font-medium text-gray-900 mt-1">
                        {defaultWallet?.tuwc_wallet_address || 'No default wallet selected'}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Withdrawals go to your default wallet.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                    <div>
                      Minimum: <span className="font-medium text-gray-900">{withdrawalSettings.minAmount} USDT</span>
                    </div>
                    <div>
                      Step: <span className="font-medium text-gray-900">{withdrawalSettings.stepAmount} USDT</span>
                    </div>
                    <div>
                      Commission: <span className="font-medium text-gray-900">{withdrawalSettings.commissionPercent}%</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm">
                    <div>
                      Estimated commission:{" "}
                      <span className="font-medium text-gray-900">
                        {(withdrawalAmount * (withdrawalSettings.commissionPercent / 100)).toFixed(2)} USDT
                      </span>
                    </div>
                    <div>
                      Estimated net:{" "}
                      <span className="font-semibold text-gray-900">
                        {(withdrawalAmount - withdrawalAmount * (withdrawalSettings.commissionPercent / 100)).toFixed(2)} USDT
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {withdrawalSettings.autoTransfer
                        ? 'Auto-transfer is enabled. Your withdrawal will be processed instantly.'
                        : `Withdrawals require admin approval. Expect ${withdrawalSettings.processingDays} working day(s).`}
                    </p>
                    <button
                      onClick={handleWithdrawalSubmit}
                      disabled={withdrawalSubmitting}
                      className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {withdrawalSubmitting ? 'Submitting...' : 'Submit Withdrawal'}
                    </button>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-900">Withdrawal History</h4>
                    <button
                      onClick={loadWithdrawalRequests}
                      className="text-sm text-green-600 hover:text-green-700"
                    >
                      Refresh
                    </button>
                  </div>

                  {withdrawalsLoading ? (
                    <div className="text-center py-6 text-sm text-gray-500">Loading withdrawals...</div>
                  ) : withdrawalRequests.length === 0 ? (
                    <div className="text-center py-6 text-sm text-gray-500">No withdrawals yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {withdrawalRequests.map((request) => (
                        <div key={request.twr_id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {Number(request.twr_amount).toFixed(2)} USDT
                              </p>
                              <p className="text-xs text-gray-500">
                                Net: {Number(request.twr_net_amount).toFixed(2)} USDT • {new Date(request.twr_requested_at).toLocaleDateString()}
                              </p>
                              <p className="text-xs text-gray-500">
                                Wallet: {request.twr_destination_address}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                request.twr_status === 'completed' ? 'bg-green-100 text-green-800' :
                                  request.twr_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                    request.twr_status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                      request.twr_status === 'rejected' ? 'bg-red-100 text-red-800' :
                                        'bg-gray-100 text-gray-800'
                              }`}>
                                {request.twr_status}
                              </span>
                              {request.twr_blockchain_tx && (
                                <span className="text-xs text-gray-500">Tx: {request.twr_blockchain_tx.slice(0, 8)}...</span>
                              )}
                              {request.twr_status === 'pending' && (
                                <button
                                  onClick={() => handleCancelWithdrawal(request.twr_id)}
                                  disabled={cancelingWithdrawalId === request.twr_id}
                                  className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  {cancelingWithdrawalId === request.twr_id ? 'Cancelling...' : 'Cancel'}
                                </button>
                              )}
                            </div>
                          </div>
                          {request.twr_failure_reason && (
                            <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                              <p className="text-xs font-medium text-red-700">Update</p>
                              <p className="text-xs text-red-600 mt-1">
                                {getCustomerFriendlyWithdrawalMessage(request.twr_failure_reason)}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Feedback Modal */}
        {showFeedbackModal && selectedTask && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Share Your Feedback</h3>
                  <button
                      onClick={() => {
                        setShowFeedbackModal(false);
                        setSelectedTask(null);
                      }}
                      className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-900">{selectedTask.coupon_info?.title}</h4>
                  <p className="text-sm text-blue-700 mt-1">Coupon Code: {selectedTask.coupon_info?.coupon_code}</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Why did you {userFeedback.feedback} this coupon?
                    </label>
                    <textarea
                        value={userFeedback.note}
                        onChange={(e) => setUserFeedback(prev => ({ ...prev, note: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Share your thoughts about this coupon..."
                    />
                  </div>

                  <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                    <button
                        type="button"
                        onClick={() => {
                          setShowFeedbackModal(false);
                          setSelectedTask(null);
                        }}
                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                        onClick={() => handleCouponFeedback(userFeedback.feedback as 'liked' | 'disliked', userFeedback.note)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Submit Feedback
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmationModal && selectedTask && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Confirm Coupon Usage</h3>
                  <button
                      onClick={() => {
                        setShowConfirmationModal(false);
                        setSelectedTask(null);
                      }}
                      className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                <div className="mb-6 p-4 bg-green-50 rounded-lg">
                  <h4 className="font-medium text-green-900">Did you use the coupon?</h4>
                  <p className="text-sm text-green-700 mt-1">
                    Please confirm if you successfully used the coupon "{selectedTask.coupon_info?.title}" on the merchant's website.
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                  <button
                      type="button"
                                onClick={handleCouponNotUsed}
                                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                            >
                                No, I didn't use it
                  </button>
                  <button
                      onClick={confirmCouponUsage}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Yes, I used the coupon
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
};

export default WalletDashboard;
