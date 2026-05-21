import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useNotification } from '../components/ui/NotificationProvider';
import { UserWallet, WalletTransaction, DailyTask, UserTask } from '../types/wallet';

interface WalletContextType {
  wallet: UserWallet | null;
  transactions: WalletTransaction[];
  dailyTasks: UserTask[];
  loading: boolean;
  refreshWallet: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshDailyTasks: () => Promise<void>;
  completeTask: (taskId: string, shareUrl: string, platform: string, screenshotUrl?: string) => Promise<void>;
  getWalletSummary: () => Promise<any>;
  creditWallet: (amount: number, description: string, referenceType?: string, referenceId?: string) => Promise<void>;
  debitWallet: (amount: number, description: string, referenceType?: string, referenceId?: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const notification = useNotification();
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [dailyTasks, setDailyTasks] = useState<UserTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.id) {
      refreshWallet();
      refreshTransactions();
      refreshDailyTasks();
    } else {
      setWallet(null);
      setTransactions([]);
      setDailyTasks([]);
      setLoading(false);
    }
  }, [user?.id]);

  const refreshWallet = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);
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

      if (data) {
        setWallet({
          id: data.tw_id,
          userId: data.tw_user_id,
          balance: parseFloat(data.tw_balance),
          currency: data.tw_currency,
          walletAddress: data.tw_wallet_address,
          isActive: data.tw_is_active,
          createdAt: data.tw_created_at,
          updatedAt: data.tw_updated_at
        });
      }
    } catch (error) {
      console.error('Failed to load wallet:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshTransactions = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('tbl_wallet_transactions')
        .select('*')
        .eq('twt_user_id', user.id)
        .order('twt_created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const formattedTransactions: WalletTransaction[] = (data || []).map(tx => ({
        id: tx.twt_id,
        walletId: tx.twt_wallet_id,
        userId: tx.twt_user_id,
        transactionType: tx.twt_transaction_type,
        amount: parseFloat(tx.twt_amount),
        currency: tx.twt_currency,
        description: tx.twt_description,
        referenceType: tx.twt_reference_type,
        referenceId: tx.twt_reference_id,
        blockchainHash: tx.twt_blockchain_hash,
        status: tx.twt_status,
        createdAt: tx.twt_created_at
      }));

      setTransactions(formattedTransactions);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    }
  };

  const refreshDailyTasks = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase.rpc('get_user_daily_tasks', {
        p_user_id: user.id
      });

      if (error) throw error;

      const formattedTasks: UserTask[] = (data || []).map(task => ({
        id: task.task_id,
        userId: user.id,
        taskId: task.task_id,
        completionStatus: task.completion_status,
        rewardAmount: parseFloat(task.reward_amount),
        rewardPaid: false,
        completedAt: task.completed_at,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        taskInfo: {
          id: task.task_id,
          createdBy: '',
          taskType: task.task_type,
          title: task.task_title,
          description: task.task_description,
          contentUrl: task.content_url,
          rewardAmount: parseFloat(task.reward_amount),
          maxCompletions: 1000,
          completedCount: 0,
          targetPlatforms: ['facebook', 'instagram', 'twitter', 'youtube'],
          taskDate: new Date().toISOString().split('T')[0],
          expiresAt: task.expires_at,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          couponInfo: task.coupon_info
        }
      }));

      setDailyTasks(formattedTasks);
    } catch (error) {
      console.error('Failed to load daily tasks:', error);
    }
  };

  const completeTask = async (taskId: string, shareUrl: string, platform: string, screenshotUrl?: string) => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase.rpc('complete_user_task', {
        p_user_id: user.id,
        p_task_id: taskId,
        p_share_url: shareUrl,
        p_platform: platform,
        p_screenshot_url: screenshotUrl
      });

      if (error) throw error;

      notification.showSuccess(
        'Task Completed!',
        `You earned ${data.reward_amount} USDT for completing this task.`
      );

      // Refresh data
      await Promise.all([
        refreshWallet(),
        refreshTransactions(),
        refreshDailyTasks()
      ]);

    } catch (error: any) {
      console.error('Failed to complete task:', error);
      notification.showError('Task Failed', error.message || 'Failed to complete task');
      throw error;
    }
  };

  const getWalletSummary = async () => {
    if (!user?.id) return null;

    try {
      const { data, error } = await supabase.rpc('get_wallet_summary', {
        p_user_id: user.id
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to get wallet summary:', error);
      return null;
    }
  };

  const creditWallet = async (amount: number, description: string, referenceType?: string, referenceId?: string) => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase.rpc('update_wallet_balance', {
        p_user_id: user.id,
        p_amount: amount,
        p_transaction_type: 'credit',
        p_description: description,
        p_reference_type: referenceType,
        p_reference_id: referenceId
      });

      if (error) throw error;

      notification.showSuccess('Wallet Credited', `${amount} USDT added to your wallet`);
      await refreshWallet();
      await refreshTransactions();
    } catch (error: any) {
      console.error('Failed to credit wallet:', error);
      notification.showError('Credit Failed', error.message || 'Failed to credit wallet');
      throw error;
    }
  };

  const debitWallet = async (amount: number, description: string, referenceType?: string, referenceId?: string) => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase.rpc('update_wallet_balance', {
        p_user_id: user.id,
        p_amount: amount,
        p_transaction_type: 'debit',
        p_description: description,
        p_reference_type: referenceType,
        p_reference_id: referenceId
      });

      if (error) throw error;

      notification.showSuccess('Wallet Debited', `${amount} USDT deducted from your wallet`);
      await refreshWallet();
      await refreshTransactions();
    } catch (error: any) {
      console.error('Failed to debit wallet:', error);
      notification.showError('Debit Failed', error.message || 'Failed to debit wallet');
      throw error;
    }
  };

  const value = {
    wallet,
    transactions,
    dailyTasks,
    loading,
    refreshWallet,
    refreshTransactions,
    refreshDailyTasks,
    completeTask,
    getWalletSummary,
    creditWallet,
    debitWallet
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};
