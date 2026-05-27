import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAdmin } from '../contexts/AdminContext';
import { useNotification } from '../components/ui/NotificationProvider';
import { supabase } from '../lib/supabase';
import { WalletService } from '../services/walletService';
import { WalletInfo, WalletState, TransactionState } from '../types/wallet';
import { WalletSelector } from '../components/payment/WalletSelector';
import { WalletInfo as WalletInfoComponent } from '../components/payment/WalletInfo';
import { PaymentSection } from '../components/payment/PaymentSection';
import { TrustIndicators } from '../components/payment/TrustIndicators';
import { CreditCard, Shield, ArrowLeft, Wallet, AlertTriangle } from 'lucide-react';
import { extractEdgeFunctionErrorMessage, isRetryableEdgeFunctionError } from '../utils/edgeFunctionError';
import { sendAccountEmail } from '../utils/accountEmails';

interface SubscriptionPlan {
  tsp_id: string;
  tsp_name: string;
  tsp_description: string;
  tsp_price: number;
  tsp_duration_days: number;
  tsp_type?: string;
  tsp_features: string[];
}

// Key for storing transaction data
const PAYMENT_SUCCESS_KEY = 'payment_success_state';

// Helper function to determine wallet type from provider
const getWalletType = (provider: any): string => {
  if (provider.isMetaMask) return 'metamask';
  if (provider.isTrust || provider.isTrustWallet) return 'trust';
  if (provider.isSafePal) return 'safepal';
  if (provider.isTokenPocket || provider.isTp || provider.isTP) return 'tokenpocket';
  if (
    provider.isBitKeep ||
    provider.isBitkeep ||
    provider.isBitKeepChrome ||
    provider.isBitget ||
    provider.isBitgetWallet ||
    provider === (window as any).bitkeep?.ethereum ||
    provider === (window as any).bitkeep?.ethereumProvider ||
    provider === (window as any).bitkeep ||
    provider === (window as any).bitget?.ethereum ||
    provider === (window as any).bitget?.ethereumProvider ||
    provider === (window as any).bitget ||
    provider === (window as any).BitKeep?.ethereum ||
    provider === (window as any).BitKeep?.ethereumProvider ||
    provider === (window as any).BitKeep ||
    provider === (window as any).bitgetWallet
  ) return 'bitget';
  if (provider.isBinanceChain || provider.isBinance) return 'binance';
  return 'web3';
};


const Payment: React.FC = () => {
  // FIX: Access user object which contains hasActiveSubscription
  const { user, fetchUserData } = useAuth();
  const { settings } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const notification = useNotification();

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [walletService] = useState(() => WalletService.getInstance());
  const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);
  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: null,
    chainId: null,
    balance: '0',
    usdtBalance: '0',
    walletName: null,
  });

  const [workingWalletReservedBalance, setWorkingWalletReservedBalance] = useState(0);
  const [useReservedBalance, setUseReservedBalance] = useState(false);

  // FIX: Initialize transaction state from session storage
  const initialTransactionState: TransactionState = (() => {
    try {
      const storedState = sessionStorage.getItem(PAYMENT_SUCCESS_KEY);
      if (storedState) {
        const { success, tx } = JSON.parse(storedState);
        if (success) {
          return tx as TransactionState;
        }
      }
    } catch (e) {
      console.error("Failed to parse payment success state from session storage:", e);
      sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);
    }
    // Default initial state
    return {
      isProcessing: false,
      hash: null,
      status: 'idle',
      error: null,
      distributionSteps: [],
    } as TransactionState;
  })();

  const [transaction, setTransaction] = useState<TransactionState>(initialTransactionState);

  const [isConnecting, setIsConnecting] = useState(false);
  const [lastConnectedWallet, setLastConnectedWallet] = useState<any>(null);

  const enabledWallets = useMemo(() => ({
    trust_wallet: true,
    metamask: true,
    safepal: true,
    tokenpocket: true,
    bitget: true,
    ...settings?.paymentWalletsEnabled,
  }), [settings?.paymentWalletsEnabled]);

  const filteredWallets = useMemo(() => {
    return availableWallets.filter((wallet) => {
      if (wallet.name === 'Trust Wallet') return enabledWallets.trust_wallet;
      if (wallet.name === 'MetaMask') return enabledWallets.metamask;
      if (wallet.name === 'SafePal') return enabledWallets.safepal;
      if (wallet.name === 'TokenPocket') return enabledWallets.tokenpocket;
      if (wallet.name === 'Bitget Wallet') return enabledWallets.bitget;
      return true;
    });
  }, [availableWallets, enabledWallets]);

  // FIX: If the user has an active plan (from DB check), force success status.
  // Otherwise, rely on the session storage flag.
  const hasActivePlan = user?.hasActiveSubscription;
  const hasPaidSuccessfully = hasActivePlan || transaction.status === 'success';
  const isUpgradePlanUi = String(selectedPlan?.tsp_type || '').toLowerCase() === 'upgrade';
  const canUseReservedForUpgradeUi = isUpgradePlanUi && workingWalletReservedBalance > 0;

  const reservedUsedForUpgrade = useReservedBalance && isUpgradePlanUi
    ? Math.min(workingWalletReservedBalance, Number(selectedPlan?.tsp_price || 0))
    : 0;
  const chainPayAmountForUpgrade = Math.max(0, Number(selectedPlan?.tsp_price || 0) - reservedUsedForUpgrade);

  const loadWorkingWalletReservedBalance = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_wallets')
        .select('tw_reserved_balance')
        .eq('tw_user_id', user.id)
        .eq('tw_currency', 'USDT')
        .eq('tw_wallet_type', 'working')
        .maybeSingle();
      if (error) throw error;
      setWorkingWalletReservedBalance(Number((data as any)?.tw_reserved_balance ?? 0));
    } catch (error) {
      console.error('Failed to load reserved wallet balance:', error);
      setWorkingWalletReservedBalance(0);
    }
  }, [user?.id]);

  // Load saved wallet connections on component mount
  useEffect(() => {
    const loadSavedWalletConnections = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
            .from('tbl_user_wallet_connections')
            .select('tuwc_wallet_address, tuwc_wallet_name, tuwc_wallet_type, tuwc_chain_id, tuwc_last_connected_at')
            .eq('tuwc_user_id', user.id)
            .eq('tuwc_is_active', true)
            .order('tuwc_last_connected_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (data && !error) {
          setLastConnectedWallet(data);
        }
      } catch (error) {
        console.error('Error loading saved wallet connections:', error);
      }
    };

    loadSavedWalletConnections();
  }, [user]);

  useEffect(() => {
    loadWorkingWalletReservedBalance();
  }, [loadWorkingWalletReservedBalance]);

  // Configure wallet service with admin settings
  useEffect(() => {
    if (settings) {
      // Validate admin settings before using them
      const validateAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr);

      if (!validateAddress(settings.usdtAddress) && settings.usdtAddress !== '') {
        console.error('Invalid USDT address in settings');
        notification.showError('Configuration Error', 'Invalid USDT contract address');
        return;
      }

      if (!validateAddress(settings.subscriptionContractAddress) && settings.subscriptionContractAddress !== '') {
        console.error('Invalid subscription contract address in settings');
        notification.showError('Configuration Error', 'Invalid subscription contract address');
        return;
      }

      if (!validateAddress(settings.subscriptionWalletAddress) && settings.subscriptionWalletAddress !== '') {
        console.error('Invalid subscription wallet address in settings');
        notification.showError('Configuration Error', 'Invalid subscription wallet address');
        return;
      }

      walletService.setAdminSettings({
        paymentMode: settings.paymentMode?.toString() || '0',
        usdtAddress: settings.usdtAddress || '',
        subscriptionContractAddress: settings.subscriptionContractAddress || '',
        subscriptionWalletAddress: settings.subscriptionWalletAddress || ''
      });
    }
  }, [settings, walletService, notification]);

  useEffect(() => {
    // Validate and get selected plan from navigation state
    const planFromState = location.state?.selectedPlan;

    if (planFromState) {
      // Input validation functions
      const validatePrice = (price: number): boolean => price > 0 && price < 1000000;

      // Validate plan data
      if (!planFromState.tsp_id || !planFromState.tsp_name ||
          !validatePrice(planFromState.tsp_price)) {
        notification.showError('Invalid Plan', 'The selected plan contains invalid data.');
        navigate('/subscription-plans', { replace: true });
        return;
      }

      setSelectedPlan(planFromState);
    } else {
      // No plan selected, redirect to subscription plans
      notification.showError('No Plan Selected', 'Please select a subscription plan first.');
      navigate('/subscription-plans', { replace: true });
    }

    // Detect available wallets
    const wallets = walletService.detectWallets();
    setAvailableWallets(wallets);
  }, [location.state, navigate, notification, walletService]);

  useEffect(() => {
    const refreshDetectedWallets = () => {
      setAvailableWallets(walletService.detectWallets());
    };

    refreshDetectedWallets();

    const timeoutIds = [250, 1000, 2500, 5000].map((delay) =>
      window.setTimeout(refreshDetectedWallets, delay)
    );

    window.addEventListener('load', refreshDetectedWallets);
    window.addEventListener('focus', refreshDetectedWallets);
    window.addEventListener('ethereum#initialized', refreshDetectedWallets as EventListener);

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('load', refreshDetectedWallets);
      window.removeEventListener('focus', refreshDetectedWallets);
      window.removeEventListener('ethereum#initialized', refreshDetectedWallets as EventListener);
    };
  }, [walletService]);

  useEffect(() => {
    const isUpgrade = String(selectedPlan?.tsp_type || '').toLowerCase() === 'upgrade';
    const canUseReserved = isUpgrade && workingWalletReservedBalance > 0;
    if (!canUseReserved) {
      setUseReservedBalance(false);
    }
  }, [selectedPlan?.tsp_id, selectedPlan?.tsp_type, selectedPlan?.tsp_price, workingWalletReservedBalance]);

	  // FIX: Restore wallet state from service on re-render if connection is active
	  useEffect(() => {
	    if (isConnecting) return;
	    // Check the WalletService instance directly for connection status
	    const currentWalletState = walletService.getCurrentWalletState();
	    if (currentWalletState.isConnected && !walletState.isConnected) {
	      setWalletState(currentWalletState);
	      console.log('Restored wallet state from WalletService:', currentWalletState.address);
	    }
	  }, [walletService, walletState.isConnected, isConnecting]);

  // Input validation functions
  const validateAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const validatePrice = (price: number): boolean => {
    return price > 0 && price < 1000000; // Reasonable upper limit
  };

		  // Save wallet connection to database (best-effort)
		  const saveWalletConnection = async (address: string, walletName: string, walletType: string, chainId: number | null) => {
		    if (!user || !address) return;

		    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

		    const maxAttempts = 3;
		    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		      try {
		        // If session isn't hydrated yet, Supabase may not send Authorization. Wait briefly and retry.
		        const { data: sessionData } = await supabase.auth.getSession();
		        if (!sessionData.session?.access_token) {
		          if (attempt < maxAttempts) {
		            await sleep(300 * attempt);
		            continue;
		          }
		          console.warn('Skipping wallet connection upsert: no active session yet.');
		          return;
		        }

		        const { data, error } = await supabase.functions.invoke('upsert-wallet-connection', {
		          body: {
		            wallet_address: address,
		            wallet_name: walletName,
		            wallet_type: walletType,
		            chain_id: chainId
		          }
		        });

		        if (error) {
		          if (isRetryableEdgeFunctionError(error) && attempt < maxAttempts) {
		            await sleep(500 * attempt);
		            continue;
		          }
		          const message = await extractEdgeFunctionErrorMessage(error);
		          console.warn('Failed to save wallet connection (non-fatal):', message);
		          return;
		        }

		        if (!data?.success) {
		          console.warn('Failed to save wallet connection (non-fatal):', data?.error || 'Unknown error');
		          return;
		        }

		        return;
		      } catch (error) {
		        if (attempt < maxAttempts) {
		          await sleep(500 * attempt);
		          continue;
		        }
		        console.warn('Error saving wallet connection (non-fatal):', error);
		        return;
		      }
		    }
		  };

		  const handleWalletConnect = async (provider: any) => {
		    if (isConnecting) return; // Prevent double click
		
			    setIsConnecting(true);
			    try {
			      const wallet = await walletService.connectWallet(provider);

			      setWalletState(wallet);

		      if (wallet.address) {
		        const walletType = getWalletType(provider);
		        setLastConnectedWallet({
		          tuwc_wallet_address: wallet.address,
		          tuwc_wallet_name: wallet.walletName || 'Unknown Wallet',
		          tuwc_wallet_type: walletType,
		          tuwc_chain_id: wallet.chainId,
		          tuwc_last_connected_at: new Date().toISOString()
		        });

		        // Best-effort: don't fail wallet connection if this transiently fails (502 etc).
		        void saveWalletConnection(
		          wallet.address,
		          wallet.walletName || 'Unknown Wallet',
		          walletType,
		          wallet.chainId
		        );
		      }
		
		      notification.showSuccess('Wallet Connected', `Successfully connected to ${wallet.walletName}`);
		    } catch (error: any) {
	      console.error('Wallet connection failed:', error);
	      const errorMessage = error.message || 'Failed to connect wallet';

      // Sanitize error message before showing to user
      const sanitizedError = errorMessage.replace(/[<>]/g, '');
      notification.showError('Connection Failed', sanitizedError);

	      // Disconnect and clear wallet state on failure
	      walletService.disconnect();
	      setWalletState({
	        isConnected: false,
	        address: null,
	        chainId: null,
	        balance: '0',
	        usdtBalance: '0',
	        walletName: null,
	      });

    } finally {
      setIsConnecting(false);
    }
  };

  const handleWalletDisconnect = async () => {
    try {
      // Deactivate wallet connection in database
      if (user && walletState.address) {
        await supabase
            .from('tbl_user_wallet_connections')
            .update({
              tuwc_is_active: false,
              tuwc_updated_at: new Date().toISOString()
            })
            .eq('tuwc_user_id', user.id)
            .eq('tuwc_wallet_address', walletState.address);
      }
    } catch (error) {
      console.error('Error updating wallet connection status:', error);
    }

    walletService.disconnect();
    setWalletState({
      isConnected: false,
      address: null,
      chainId: null,
      balance: '0',
      usdtBalance: '0',
      walletName: null,
    });
    setLastConnectedWallet(null);
    // FIX: Reset transaction state and clear persistent storage on disconnect
    setTransaction(initialTransactionState);
    sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);
    notification.showInfo('Wallet Disconnected', 'Wallet has been disconnected');
  };

  const handlePayment = async () => {
    // Input validation
    if (!selectedPlan || !user) {
      notification.showError('Error', 'Missing plan or user information');
      return;
    }

    const planType = String(selectedPlan.tsp_type || '').toLowerCase();
    const isUpgradePlan = planType === 'upgrade';

    // FIX: Re-check active subscription before payment
    if (user.hasActiveSubscription && !isUpgradePlan) {
      notification.showInfo('Already Subscribed', 'You already have an active subscription.');
      // Set local state to success to enforce the success UI path immediately
      setTransaction(prev => ({ ...prev, status: 'success' }));
      return;
    }

    if (useReservedBalance && isUpgradePlan) {
      const reservedUsed = Math.min(workingWalletReservedBalance, selectedPlan.tsp_price);
      const chainAmount = Number(Math.max(0, selectedPlan.tsp_price - reservedUsed).toFixed(6));
      const reservedUsedRounded = Number(reservedUsed.toFixed(6));

      if (reservedUsedRounded <= 0) {
        notification.showError('Reserved Balance', 'No reserved balance available to use.');
        return;
      }

      // Reserved-only path.
      if (chainAmount === 0) {
        setTransaction({
          isProcessing: true,
          hash: null,
          status: 'pending',
          error: null,
          distributionSteps: ['Paid from reserved balance'],
        });
        sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);

        try {
          const { error } = await supabase.rpc('create_subscription_payment_from_reserved', {
            p_user_id: user.id,
            p_plan_id: selectedPlan.tsp_id,
            p_currency: 'USDT',
            p_gateway_response: {
              source: 'reserved_wallet',
              reserved_used: reservedUsedRounded,
              processed_at: new Date().toISOString(),
            },
          });

          if (error) throw error;

          setTransaction({
            isProcessing: false,
            hash: null,
            status: 'success',
            error: null,
            distributionSteps: ['Paid from reserved balance'],
          });

          sessionStorage.setItem(PAYMENT_SUCCESS_KEY, JSON.stringify({
            success: true,
            tx: {
              isProcessing: false,
              hash: null,
              status: 'success',
              error: null,
              distributionSteps: ['Paid from reserved balance'],
            }
          }));

          await Promise.all([fetchUserData(user.id), loadWorkingWalletReservedBalance()]);
          void sendAccountEmail({
            type: 'upgrade_payment',
            planName: selectedPlan.tsp_name,
            amount: selectedPlan.tsp_price,
            reservedUsed: reservedUsedRounded,
          });
          notification.showSuccess('Payment Successful!', 'Upgrade has been activated using reserved balance.');
          return;
        } catch (error: any) {
          const message = extractEdgeFunctionErrorMessage(error) || error?.message || 'Upgrade payment failed';
          setTransaction({
            isProcessing: false,
            hash: null,
            status: 'error',
            error: message,
            distributionSteps: ['Paid from reserved balance'],
          });
          sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);
          notification.showError('Payment Failed', message);
          return;
        }
      }

      // Mixed payment: reserved + blockchain remainder.
      if (!walletState.isConnected || !walletState.address) {
        notification.showError('Wallet Required', 'Please connect your wallet to pay the remaining amount.');
        return;
      }

      if (!validateAddress(walletState.address)) {
        notification.showError('Invalid Wallet', 'Connected wallet address is invalid');
        return;
      }

      if (!settings) {
        notification.showError('Configuration Error', 'Admin settings not loaded. Please refresh the page.');
        return;
      }

      walletService.setAdminSettings({
        paymentMode: settings.paymentMode?.toString() || '0',
        usdtAddress: settings.usdtAddress || '',
        subscriptionContractAddress: settings.subscriptionContractAddress || '',
        subscriptionWalletAddress: settings.subscriptionWalletAddress || ''
      });

      const usdtBalance = parseFloat(walletState.usdtBalance);
      if (usdtBalance < chainAmount) {
        notification.showError(
          'Insufficient Balance',
          `You need at least ${chainAmount} USDT to pay the remaining amount. Current balance: ${usdtBalance} USDT`
        );
        return;
      }

      setTransaction({
        isProcessing: true,
        hash: null,
        status: 'pending',
        error: null,
        distributionSteps: [`Reserved used: ${reservedUsedRounded} USDT`, `Remaining to pay: ${chainAmount} USDT`]
      });
      sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);

      try {
        const { hash, steps } = await walletService.executeUSDTDistribution(chainAmount);

        const { error } = await supabase.rpc('create_upgrade_payment_with_reserved_and_chain', {
          p_user_id: user.id,
          p_plan_id: selectedPlan.tsp_id,
          p_chain_amount: chainAmount,
          p_reserved_used: reservedUsedRounded,
          p_currency: 'USDT',
          p_transaction_id: hash,
          p_gateway_response: {
            blockchain: settings.paymentMode == '1' ? 'BSC Mainnet' : 'BSC Testnet',
            usdt_contract: settings.usdtAddress,
            subscription_wallet: settings.subscriptionWalletAddress,
            transaction_hash: hash,
            wallet_address: walletState.address,
            processed_at: new Date().toISOString(),
            steps
          }
        });

        if (error) throw error;

        setTransaction({
          isProcessing: false,
          hash,
          distributionSteps: [`Reserved used: ${reservedUsedRounded} USDT`, ...steps],
          status: 'success',
          error: null
        });

        sessionStorage.setItem(PAYMENT_SUCCESS_KEY, JSON.stringify({
          success: true,
          tx: {
            isProcessing: false,
            hash,
            status: 'success',
            error: null,
            distributionSteps: [`Reserved used: ${reservedUsedRounded} USDT`, ...steps]
          }
        }));

        await Promise.all([fetchUserData(user.id), loadWorkingWalletReservedBalance()]);
        void sendAccountEmail({
          type: 'upgrade_payment',
          planName: selectedPlan.tsp_name,
          amount: selectedPlan.tsp_price,
          transactionHash: hash,
          reservedUsed: reservedUsedRounded,
          network: settings.paymentMode == '1' ? 'BSC Mainnet' : 'BSC Testnet',
        });
        notification.showSuccess('Payment Successful!', 'Upgrade has been activated (reserved + blockchain).');
        return;
      } catch (error: any) {
        const errorMessage = extractEdgeFunctionErrorMessage(error) || error?.message || 'Payment processing failed';
        setTransaction({
          isProcessing: false,
          hash: transaction.hash,
          status: 'error',
          error: errorMessage,
          distributionSteps: transaction.distributionSteps
        });
        sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);
        notification.showError('Payment Failed', errorMessage);
        return;
      }
    }

    if (!walletState.isConnected || !walletState.address) {
      notification.showError('Wallet Required', 'Please connect your wallet first');
      return;
    }

    if (!validateAddress(walletState.address)) {
      notification.showError('Invalid Wallet', 'Connected wallet address is invalid');
      return;
    }

    // Ensure admin settings are configured before payment
    if (!settings) {
      notification.showError('Configuration Error', 'Admin settings not loaded. Please refresh the page.');
      return;
    }

    // Validate settings addresses
    if (!validateAddress(settings.usdtAddress) && settings.usdtAddress !== '') {
      notification.showError('Configuration Error', 'Invalid USDT contract address in settings');
      return;
    }

    if (!validateAddress(settings.subscriptionContractAddress) && settings.subscriptionContractAddress !== '') {
      notification.showError('Configuration Error', 'Invalid subscription contract address in settings');
      return;
    }

    if (!validateAddress(settings.subscriptionWalletAddress) && settings.subscriptionWalletAddress !== '') {
      notification.showError('Configuration Error', 'Invalid subscription wallet address in settings');
      return;
    }

    // Set admin settings again before payment to ensure they're current
    walletService.setAdminSettings({
      paymentMode: settings.paymentMode?.toString() || '0',
      usdtAddress: settings.usdtAddress || '',
      subscriptionContractAddress: settings.subscriptionContractAddress || '',
      subscriptionWalletAddress: settings.subscriptionWalletAddress || ''
    });

    const usdtBalance = parseFloat(walletState.usdtBalance);
    if (usdtBalance < selectedPlan.tsp_price) {
      notification.showError(
          'Insufficient Balance',
          `You need at least ${selectedPlan.tsp_price} USDT to complete this payment. Current balance: ${usdtBalance} USDT`
      );
      return;
    }

    // Reset transaction state
    setTransaction({
      isProcessing: true,
      hash: null,
      status: 'pending',
      error: null,
      distributionSteps: []
    });
    sessionStorage.removeItem(PAYMENT_SUCCESS_KEY); // Clear session storage flag

    let subscriptionData = null;
    let paymentData = null;

    try {
      console.log('Processing smart contract payment for plan:', selectedPlan.tsp_name);

      // Execute USDT distribution
      const { hash, steps } = await walletService.executeUSDTDistribution(selectedPlan.tsp_price);

      const finalTransactionState = {
        isProcessing: false,
        hash,
        distributionSteps: steps,
        status: 'success' as 'success',
        error: null
      };

      setTransaction(finalTransactionState);

      // Create subscription + payment atomically via RPC
      const { data: paymentData, error: paymentError } = await supabase
        .rpc('create_registration_payment', {
          p_user_id: user.id,
          p_plan_id: selectedPlan.tsp_id,
          p_amount: selectedPlan.tsp_price,
          p_currency: 'USDT',
          p_payment_method: 'blockchain',
          p_payment_status: 'completed',
          p_transaction_id: hash,
          p_gateway_response: {
            blockchain: settings.paymentMode == '1' ? 'BSC Mainnet' : 'BSC Testnet',
            contract_address: settings.subscriptionContractAddress,
            usdt_contract: settings.usdtAddress,
            subscription_wallet: settings.subscriptionWalletAddress,
            transaction_hash: hash,
            wallet_address: walletState.address,
            processed_at: new Date().toISOString(),
            status: 'success',
            steps: steps
          }
        });

      if (paymentError) {
        console.error('Payment record creation failed:', paymentError);
        throw new Error(paymentError.message || 'Failed to create payment record');
      }

      subscriptionData = paymentData?.subscription_id || null;
      console.log('✅ Payment record created:', paymentData);

      // FIX: Store success flag and transaction state in session storage BEFORE fetching user data
      sessionStorage.setItem(PAYMENT_SUCCESS_KEY, JSON.stringify({
        success: true,
        tx: finalTransactionState
      }));

      // Refresh user data (This causes the re-render/re-mount)
      await fetchUserData(user.id);

      if (isUpgradePlan) {
        void sendAccountEmail({
          type: 'upgrade_payment',
          planName: selectedPlan.tsp_name,
          amount: selectedPlan.tsp_price,
          transactionHash: hash,
          network: settings.paymentMode == '1' ? 'BSC Mainnet' : 'BSC Testnet',
        });
      }

      notification.showSuccess('Payment Successful!', 'Your subscription has been activated via blockchain.');

      // Local state update is handled, the component will re-render and re-initialize from storage

    } catch (error: any) {
      console.error('Payment processing failed:', error);

      const errorMessage = error?.message || 'Payment processing failed';

      const finalErrorState = {
        isProcessing: false,
        hash: transaction.hash,
        status: 'error' as 'error',
        error: errorMessage,
        distributionSteps: transaction.distributionSteps
      };

      // Set error state and stop processing
      setTransaction(finalErrorState);
      sessionStorage.removeItem(PAYMENT_SUCCESS_KEY); // Clear success flag on failure

      try {
        const { data: failedPayment, error: dbError } = await supabase
            .from('tbl_payments')
            .insert({
              tp_user_id: user.id,
            tp_subscription_id: subscriptionData || null,
              tp_amount: selectedPlan.tsp_price,
              tp_currency: 'USDT',
              tp_payment_method: 'blockchain',
              tp_payment_status: 'failed',
              tp_transaction_id: transaction.hash,
              tp_error_message: errorMessage,
              tp_gateway_response: {
                blockchain: settings.paymentMode == '1' ? 'BSC Mainnet' : 'BSC Testnet',
                contract_address: settings.subscriptionContractAddress,
                usdt_contract: settings.usdtAddress,
                subscription_wallet: settings.subscriptionWalletAddress,
                transaction_hash: transaction.hash,
                wallet_address: walletState.address,
                processed_at: new Date().toISOString(),
                status: 'failed',
                error: errorMessage,
                steps: transaction.distributionSteps,
                error_details: error?.response?.data || error?.toString()
              }
            })
            .select()
            .single();

        if (dbError) {
          console.error('❌ Failed to save failed payment record:', dbError);
        } else {
          console.log('✅ Failed payment record created:', failedPayment);
        }
      } catch (dbError) {
        console.error('❌ Error saving failed payment to database:', dbError);
      }

      notification.showError('Payment Failed', errorMessage);
    }
  };

  const handleGoToDashboard = () => {
    // FIX: Clear the persistent state upon navigating away
    sessionStorage.removeItem(PAYMENT_SUCCESS_KEY);

    navigate('/customer/dashboard', {
      state: {
        paymentSuccess: true,
        planName: selectedPlan?.tsp_name,
        transactionHash: transaction.hash
      }
    });
  };

  const handleReconnectPreviousWallet = async () => {
    if (!lastConnectedWallet || !availableWallets.length) return;

    try {
      setIsConnecting(true);

      // Find the appropriate provider for the wallet type
      let provider = null;
      const walletType = lastConnectedWallet.tuwc_wallet_type;

      if (walletType === 'metamask' && (window as any).ethereum?.isMetaMask) {
        provider = (window as any).ethereum;
      } else if (walletType === 'trust' && (window as any).ethereum?.isTrust) {
        provider = (window as any).ethereum;
      } else if (walletType === 'safepal' && (window as any).ethereum?.isSafePal) {
        provider = (window as any).ethereum;
      } else if (walletType === 'tokenpocket' && ((window as any).ethereum?.isTokenPocket || (window as any).tokenpocket?.ethereum)) {
        provider = (window as any).tokenpocket?.ethereum || (window as any).ethereum;
      } else if (walletType === 'bitget' && ((window as any).ethereum?.isBitKeep || (window as any).ethereum?.isBitkeep || (window as any).ethereum?.isBitKeepChrome || (window as any).ethereum?.isBitget || (window as any).ethereum?.isBitgetWallet || (window as any).bitkeep?.ethereum || (window as any).bitkeep?.ethereumProvider || (window as any).bitkeep?.request || (window as any).bitget?.ethereum || (window as any).bitget?.ethereumProvider || (window as any).bitget?.request || (window as any).BitKeep?.ethereum || (window as any).BitKeep?.ethereumProvider || (window as any).BitKeep?.request || (window as any).bitgetWallet)) {
        provider = (window as any).bitkeep?.ethereum || (window as any).bitkeep?.ethereumProvider || (window as any).bitkeep || (window as any).bitget?.ethereum || (window as any).bitget?.ethereumProvider || (window as any).bitget || (window as any).BitKeep?.ethereum || (window as any).BitKeep?.ethereumProvider || (window as any).BitKeep || (window as any).bitgetWallet || (window as any).ethereum;
      } else if (walletType === 'binance' && (window as any).BinanceChain) {
        provider = (window as any).BinanceChain;
      } else if ((window as any).ethereum) {
        // Fallback to generic Ethereum provider
        provider = (window as any).ethereum;
      }

      if (!provider) {
        notification.showError('Wallet Not Available', 'The previously used wallet is not available. Please install it and try again.');
        return;
      }

      const wallet = await walletService.connectWallet(provider);
      setWalletState(wallet);

      // Update wallet connection in database
      await saveWalletConnection(
          wallet.address!,
          wallet.walletName || 'Unknown Wallet',
          walletType,
          wallet.chainId
      );

      notification.showSuccess('Wallet Reconnected', `Successfully reconnected to ${wallet.walletName}`);
    } catch (error: any) {
      console.error('Wallet reconnection failed:', error);
      const errorMessage = error.message || 'Failed to reconnect wallet';
      notification.showError('Reconnection Failed', errorMessage);
    } finally {
      setIsConnecting(false);
    }
  };

  // FIX: Early return if user is not loaded or plan is not selected
  if (!user || !selectedPlan) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading user and payment information...</p>
          </div>
        </div>
    );
  }

  // FIX: If user has active subscription but we don't have transaction details,
  // ensure transaction status is set to success for PaymentSection to render correctly.
  if (hasActivePlan && transaction.status === 'idle') {
    setTransaction(prev => ({ ...prev, status: 'success' }));
  }


  return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <Link
                to="/subscription-plans"
                className="inline-flex items-center text-purple-300 hover:text-purple-200 mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Plans
            </Link>
            <h1 className="text-4xl font-bold text-white mb-2">USDT Smart Contract Payment</h1>
            <p className="text-purple-200">
              Secure blockchain payment processing
              {settings && (
                  <span className="ml-2 px-2 py-1 bg-purple-600/30 rounded-md text-sm">
                {settings.paymentMode === true ||
                settings.paymentMode === 1 ||
                settings.paymentMode === '1' ||
                settings.paymentMode === 'true'
                  ? 'BSC Mainnet'
                  : 'BSC Testnet'}
              </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Plan Summary */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-xl">
              <h2 className="text-2xl font-semibold text-white mb-6 flex items-center">
                <CreditCard className="w-6 h-6 mr-3 text-purple-300" />
                Subscription Details
              </h2>

              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 mb-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">{selectedPlan.tsp_name}</h3>
                    <p className="text-purple-200 text-sm mt-1">{selectedPlan.tsp_description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-white">{selectedPlan.tsp_price}</p>
                    <p className="text-purple-300 text-sm">USDT</p>
                  </div>
                </div>

                <div className="border-t border-white/20 pt-4">
                  <h4 className="font-medium text-white mb-3">Features included:</h4>
                  <ul className="space-y-2">
                    {selectedPlan.tsp_features.map((feature, index) => (
                        <li key={index} className="flex items-center text-sm text-purple-200">
                          <div className="w-2 h-2 bg-green-400 rounded-full mr-3 flex-shrink-0"></div>
                          {feature}
                        </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 rounded-xl p-4 border border-green-400/30">
                <div className="flex justify-between items-center">
                  <span className="text-white font-medium">Total Payment</span>
                  <span className="text-2xl font-bold text-green-300">{selectedPlan.tsp_price} USDT</span>
                </div>
                <p className="text-green-200 text-sm mt-1">
                  {selectedPlan.tsp_duration_days > 0 ? `${selectedPlan.tsp_duration_days} days` : 'Lifetime'} subscription • BEP-20 Token
                </p>
              </div>
            </div>

            {/* Payment Section */}
            <div className="space-y-6">
              {!walletState.isConnected && !hasActivePlan && (!useReservedBalance || chainPayAmountForUpgrade > 0) ? (
                  <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 shadow-xl">
                    <h2 className="text-2xl font-semibold text-white mb-6 flex items-center">
                      <Wallet className="w-6 h-6 mr-3 text-purple-300" />
                      Connect Your Wallet
                    </h2>

                    {filteredWallets.length === 0 && (
                        <div className="bg-yellow-500/20 border border-yellow-400/30 rounded-xl p-4 mb-6">
                          <div className="flex items-center space-x-2 mb-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-300" />
                            <span className="font-medium text-yellow-200">No Wallet Detected</span>
                          </div>
                          <p className="text-yellow-100 text-sm">
                            Please install MetaMask, Trust Wallet, or another Web3 wallet to continue with USDT payments.
                          </p>
                        </div>
                    )}

                    {lastConnectedWallet && (
                        <div className="bg-blue-500/20 border border-blue-400/30 rounded-xl p-4 mb-6">
                          <div className="flex items-center space-x-2 mb-2">
                            <Shield className="h-5 w-5 text-blue-300" />
                            <span className="font-medium text-blue-200">Previously Connected Wallet</span>
                          </div>
                          <div className="text-blue-100 text-sm">
                            <p className="break-all">{lastConnectedWallet.tuwc_wallet_address}</p>
                            <p className="text-blue-200 mt-1">
                              {lastConnectedWallet.tuwc_wallet_name} •
                              Last connected: {new Date(lastConnectedWallet.tuwc_last_connected_at).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                              onClick={handleReconnectPreviousWallet}
                              disabled={isConnecting}
                              className="mt-3 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                          >
                            {isConnecting ? 'Reconnecting...' : 'Reconnect Previous Wallet'}
                          </button>
                        </div>
                    )}

	                    <WalletSelector
	                        wallets={filteredWallets}
	                        onConnect={handleWalletConnect}
	                        isConnecting={isConnecting}
	                    />

                      {canUseReservedForUpgradeUi && !hasActivePlan && (
                        <div className="mt-6 bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
                          <h2 className="text-xl font-semibold text-white mb-3">Use Reserved Balance</h2>
                          <p className="text-purple-200 text-sm mb-4">
                            Reserved balance (working wallet): {workingWalletReservedBalance.toFixed(2)} USDT
                          </p>

                          {useReservedBalance && (
                            <p className="text-purple-200 text-sm mb-4">
                              Using reserved: {reservedUsedForUpgrade.toFixed(2)} USDT • Remaining: {chainPayAmountForUpgrade.toFixed(2)} USDT
                            </p>
                          )}

                          <label className="flex items-center space-x-3 text-sm text-purple-100">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={useReservedBalance}
                              onChange={(e) => setUseReservedBalance(e.target.checked)}
                            />
                            <span>Apply reserved balance to this upgrade</span>
                          </label>
                        </div>
                      )}
	                  </div>
	              ) : (
	                <>
	                  {canUseReservedForUpgradeUi && !hasActivePlan && (
	                    <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-xl">
	                      <h2 className="text-xl font-semibold text-white mb-3">Pay From Reserved Balance</h2>
	                      <p className="text-purple-200 text-sm mb-4">
	                        Reserved balance (working wallet): {workingWalletReservedBalance.toFixed(2)} USDT
	                      </p>
                        {useReservedBalance && chainPayAmountForUpgrade > 0 && (
                          <p className="text-purple-200 text-sm mb-4">
                            Using reserved: {reservedUsedForUpgrade.toFixed(2)} USDT • Remaining: {chainPayAmountForUpgrade.toFixed(2)} USDT
                          </p>
                        )}
	
	                      <label className="flex items-center space-x-3 text-sm text-purple-100 mb-4">
	                        <input
	                          type="checkbox"
	                          className="h-4 w-4"
	                          checked={useReservedBalance}
	                          onChange={(e) => setUseReservedBalance(e.target.checked)}
	                          disabled={!canUseReservedForUpgradeUi}
	                        />
	                        <span>Use reserved balance for this upgrade</span>
	                      </label>
	
	                      {useReservedBalance && transaction.status !== 'success' && (
	                        <button
	                          onClick={handlePayment}
	                          disabled={transaction.isProcessing}
	                          className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg font-medium transition-all duration-200 disabled:cursor-not-allowed shadow-lg"
	                        >
	                          <span>
                                {transaction.isProcessing
                                  ? 'Processing...'
                                  : chainPayAmountForUpgrade > 0
                                    ? `Pay Remaining ${chainPayAmountForUpgrade.toFixed(2)} USDT`
                                    : `Pay ${selectedPlan.tsp_price} USDT`}
                              </span>
	                        </button>
	                      )}
	
	                      {useReservedBalance && transaction.status === 'success' && (
	                        <button
	                          onClick={handleGoToDashboard}
	                          className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
	                        >
	                          <span>Go to Dashboard</span>
	                        </button>
	                      )}
	
	                      {useReservedBalance && transaction.status === 'error' && transaction.error && (
	                        <div className="mt-4 p-4 bg-red-500/20 border border-red-400/30 rounded-xl text-red-100 text-sm">
	                          {transaction.error}
	                        </div>
	                      )}
	                    </div>
	                  )}
	
	                  {walletState.isConnected && (
	                    <WalletInfoComponent
	                      wallet={walletState}
	                      onDisconnect={handleWalletDisconnect}
	                      settings={settings}
	                    />
	                  )}
	
	                  {walletState.isConnected && (!useReservedBalance || !canUseReservedForUpgradeUi) && (
	                    <PaymentSection
	                      onPayment={handlePayment}
	                      transaction={transaction}
	                      distributionSteps={transaction.distributionSteps}
	                      planPrice={selectedPlan.tsp_price}
	                      settings={settings}
	                      onGoToDashboard={handleGoToDashboard}
	                    />
	                  )}
	                </>
	              )}
            </div>
          </div>

          <TrustIndicators />

          {/* Instructions */}
          <div className="mt-12 bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
            <h3 className="text-xl font-semibold text-white mb-4">Payment Instructions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-purple-200">
              <div>
                <div className="bg-purple-500/30 w-8 h-8 rounded-full flex items-center justify-center mb-3">
                  <span className="text-white font-bold">1</span>
                </div>
                <h4 className="font-medium text-white mb-2">Connect Wallet</h4>
                <p>Connect your MetaMask or compatible wallet with USDT balance on BNB Smart Chain.</p>
              </div>
              <div>
                <div className="bg-purple-500/30 w-8 h-8 rounded-full flex items-center justify-center mb-3">
                  <span className="text-white font-bold">2</span>
                </div>
                <h4 className="font-medium text-white mb-2">Approve Transaction</h4>
                <p>Review the smart contract transaction and approve the USDT distribution.</p>
              </div>
              <div>
                <div className="bg-purple-500/30 w-8 h-8 rounded-full flex items-center justify-center mb-3">
                  <span className="text-white font-bold">3</span>
                </div>
                <h4 className="font-medium text-white mb-2">Verify & Access</h4>
                <p>Verify your transaction using the provided link, then proceed to dashboard.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};

export default Payment;
