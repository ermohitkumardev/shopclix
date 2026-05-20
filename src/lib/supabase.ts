import { createClient } from '@supabase/supabase-js'

// Use fallback values for demo purposes when environment variables are not available
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://demo.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key'

// Only log in development
if (import.meta.env.DEV) {
  console.log('Environment check:', {
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? 'Present' : 'Missing',
    NODE_ENV: import.meta.env.NODE_ENV,
    MODE: import.meta.env.MODE
  })
}

// Create optimized Supabase client with connection pooling
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined
  },
  global: {
    headers: {
      'X-Client-Info': 'mlm-platform'
    }
  },
  db: {
    schema: 'public'
  },
  // Enable connection pooling and optimize settings
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Create a separate client for batch operations to reduce connection usage
export const supabaseBatch = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  global: {
    headers: {
      'X-Client-Info': 'mlm-platform-batch'
    }
  },
  db: {
    schema: 'public'
  }
})

// Custom session storage utilities using localStorage for persistence
export const sessionManager = {
  // Save session to localStorage
  saveSession: (session: any) => {
    if (typeof window !== 'undefined' && session?.user?.id) {
      try {
        console.log('💾 Saving session to localStorage:', {
          user_id: session.user.id,
          expires_at: session.expires_at,
          token_type: session.token_type
        });

        const sessionKey = `supabase-session-${session.user.id}`;
        const sessionData = {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          expires_in: session.expires_in,
          token_type: session.token_type,
          user: session.user
        };

        localStorage.setItem(sessionKey, JSON.stringify(sessionData));
        localStorage.setItem('current-user-id', session.user.id);

        console.log('✅ Session saved successfully');
      } catch (error) {
        console.error('❌ Failed to save session to localStorage:', error);
      }
    }
  },

  // Get session from localStorage
  getSession: (userId?: string) => {
    if (typeof window !== 'undefined') {
      try {
        const currentUserId = userId || localStorage.getItem('current-user-id');
        if (!currentUserId) {
          console.log('ℹ️ No current user ID found');
          return null;
        }

        const sessionKey = `supabase-session-${currentUserId}`;
        const sessionData = localStorage.getItem(sessionKey);

        if (!sessionData) {
          console.log('ℹ️ No session data found for user:', currentUserId);
          return null;
        }

        const session = JSON.parse(sessionData);

        // Check if session is expired (with small grace period to avoid auth flicker during refresh)
        if (session.expires_at) {
          const now = Math.floor(Date.now() / 1000);
          const graceSeconds = 90;
          if (Number(session.expires_at) <= now - graceSeconds) {
            console.log('⏰ Session expired, removing from localStorage');
            sessionManager.removeSession(currentUserId);
            return null;
          }
        }

        return session;
      } catch (error) {
        console.error('❌ Failed to get session from localStorage:', error);
        // Clear corrupted session data
        sessionManager.removeSession(userId);
        return null;
      }
    }
    return null;
  },

  // Remove session from localStorage
  removeSession: (userId?: string) => {
    if (typeof window !== 'undefined') {
      try {
        if (userId) {
          console.log('🗑️ Removing session for specific user:', userId);
          const sessionKey = `supabase-session-${userId}`;
          localStorage.removeItem(sessionKey);

          // Only remove current-user-id if it matches this user
          const currentUserId = localStorage.getItem('current-user-id');
          if (currentUserId === userId) {
            localStorage.removeItem('current-user-id');
          }
        } else {
          console.log('🗑️ Removing all session data from localStorage');

          // Remove current user session
          const currentUserId = localStorage.getItem('current-user-id');
          if (currentUserId) {
            localStorage.removeItem(`supabase-session-${currentUserId}`);
          }
          localStorage.removeItem('current-user-id');

          // Also remove any orphaned session data
          const keys = Object.keys(localStorage);
          keys.forEach(key => {
            if (key.startsWith('supabase-session-')) {
              localStorage.removeItem(key);
            }
          });
        }
        console.log('✅ Session removal completed');
      } catch (error) {
        console.error('❌ Failed to remove session from localStorage:', error);
      }
    }
  },

  // Check if session exists and is valid
  hasValidSession: (userId?: string): boolean => {
    const session = sessionManager.getSession(userId);
    return session !== null;
  },

  // Restore session to Supabase client
  restoreSession: async () => {
    if (typeof window === 'undefined') return null;

    try {
      const currentUserId = localStorage.getItem('current-user-id');
      const session = sessionManager.getSession(currentUserId);

      if (!session) {
        console.log('ℹ️ No session to restore');
        return null;
      }

      console.log('🔄 Attempting to restore session to Supabase client');

      // Set the session in Supabase client
      const { data, error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });

      if (error) {
        console.error('❌ Failed to restore session:', error);
        // Remove invalid session
        sessionManager.removeSession(currentUserId);
        return null;
      }

      if (!data.session) {
        console.warn('⚠️ Session restored but no session data returned');
        sessionManager.removeSession(currentUserId);
        return null;
      }

      console.log('✅ Session restored successfully');

      // Update localStorage with refreshed session if needed
      if (data.session.access_token !== session.access_token) {
        console.log('🔄 Session was refreshed during restore, updating storage');
        sessionManager.saveSession(data.session);
      }

      return data.session;
    } catch (error) {
      console.error('❌ Error during session restoration:', error);
      const currentUserId = localStorage.getItem('current-user-id');
      sessionManager.removeSession(currentUserId);
      return null;
    }
  },
  clearAllSessions: () => {
    if (typeof window !== 'undefined') {
      try {
        console.log('🧹 Clearing all session data');

        // Get all localStorage keys
        const keys = Object.keys(localStorage);

        // Remove all session-related keys
        keys.forEach(key => {
          if (key.startsWith('supabase-session-') || key === 'current-user-id') {
            localStorage.removeItem(key);
          }
        });

        console.log('✅ All session data cleared');
      } catch (error) {
        console.error('❌ Failed to clear all sessions:', error);
      }
    }
  }
};

// Database types
export interface User {
  id: string
  email: string
  tu_user_type: 'customer' | 'company' | 'admin'
  tu_is_verified: boolean
  tu_email_verified: boolean
  tu_mobile_verified: boolean
  tu_is_active: boolean
  tu_is_dummy?: boolean
  tu_created_at: string
  tu_updated_at: string
}

export interface UserProfile {
  id: string
  tup_user_id: string
  tup_first_name?: string
  tup_last_name?: string
  tup_username?: string
  tup_mobile?: string
  tup_gender?: string
  tup_sponsorship_number?: string
  tup_parent_account?: string
  tup_created_at: string
  tup_updated_at: string
}

export interface Company {
  id: string
  tc_user_id: string
  tc_company_name: string
  tc_brand_name?: string
  tc_business_type?: string
  tc_business_category?: string
  tc_registration_number: string
  tc_gstin: string
  tc_website_url?: string
  tc_official_email: string
  tc_affiliate_code?: string
  tc_verification_status: 'pending' | 'verified' | 'rejected'
  tc_created_at: string
  tc_updated_at: string
}

export interface SubscriptionPlan {
  id: string
  tsp_name: string
  tsp_description?: string
  tsp_price: number
  tsp_duration_days: number
  tsp_features: string[]
  tsp_parent_income?: number
  tsp_is_active: boolean
  tsp_created_at: string
  tsp_updated_at: string
}

export interface MLMTreeNode {
  id: string
  tmt_user_id: string
  tmt_parent_id?: string
  tmt_left_child_id?: string
  tmt_right_child_id?: string
  tmt_level: number
  tmt_position: 'left' | 'right' | 'root'
  tmt_sponsorship_number: string
  tmt_is_active: boolean
  tmt_created_at: string
  tmt_updated_at: string
}

export interface OTPVerification {
  id: string
  tov_user_id: string
  tov_otp_code: string
  tov_otp_type: 'email' | 'mobile' | 'password_reset'
  tov_contact_info: string
  tov_is_verified: boolean
  tov_expires_at: string
  tov_attempts: number
  tov_created_at: string
}

// API functions
export const sendOTP = async (userId: string, contactInfo: string, otpType: 'email' | 'mobile') => {
  console.log('📤 Sending OTP via Supabase edge function:', { userId, contactInfo, otpType })

  // Validate inputs before sending
  if (!userId || !contactInfo || !otpType) {
    throw new Error('Missing required parameters for OTP sending');
  }

  if (!['email', 'mobile'].includes(otpType)) {
    throw new Error('Invalid OTP type. Must be email or mobile');
  }

  // Validate email format
  if (otpType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo)) {
    throw new Error('Invalid email format');
  }

  // Validate mobile format (should include country code)
  if (otpType === 'mobile' && !/^\+\d{10,15}$/.test(contactInfo)) {
    throw new Error('Invalid mobile format. Should include country code (e.g., +1234567890)');
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-otp', {
      body: {
        user_id: userId,
        contact_info: contactInfo,
        otp_type: otpType
      }
    })

    if (error) {
      console.error('❌ Send OTP error:', error)
      throw new Error(error.message || 'Failed to send OTP')
    }

    if (!data) {
      throw new Error('No response data from OTP service')
    }

    console.log('✅ OTP sent successfully:', data)
    
    // For mobile OTP in development, show the debug info
    if (data.debug_info && otpType === 'mobile') {
      console.log('📱 Mobile OTP Debug Info:', data.debug_info);
    }
    
    return data
  } catch (error: any) {
    console.error('❌ OTP sending failed:', error);
    
    // For mobile OTP, provide more helpful error message
    if (otpType === 'mobile') {
      throw new Error(error.message || 'Mobile OTP is currently in development mode. Check console for test OTP code.');
    }
    
    throw new Error(error.message || 'Failed to send OTP. Please try again.');
  }
}

export const verifyOTP = async (userId: string, otpCode: string, otpType: 'email' | 'mobile') => {
  console.log('🔍 Verifying OTP via Supabase edge function:', { userId, otpCode, otpType })

  // Validate inputs before verifying
  if (!userId || !otpCode || !otpType) {
    throw new Error('Missing required parameters for OTP verification');
  }

  if (!['email', 'mobile'].includes(otpType)) {
    throw new Error('Invalid OTP type. Must be email or mobile');
  }

  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error('Invalid OTP format. Must be 6 digits');
  }

  try {
    console.log('📡 Calling verify-otp edge function...');
    
    const { data, error } = await supabase.functions.invoke('verify-otp', {
      body: {
        user_id: userId,
        otp_code: otpCode,
        otp_type: otpType
      }
    });

    console.log('📡 Edge function response:', { data, error });
    if (error) {
      console.error('❌ Verify OTP error:', error)
      
      // Handle specific error types
      if (error.message?.includes('Invalid or expired')) {
        throw new Error('Invalid or expired OTP. Please request a new code.');
      } else if (error.message?.includes('Too many')) {
        throw new Error('Too many failed attempts. Please request a new OTP.');
      } else if (error.message?.includes('FunctionsHttpError')) {
        throw new Error('Verification service temporarily unavailable. Please try again.');
      } else if (error.message?.includes('FunctionsFetchError')) {
        throw new Error('Network error during verification. Please check your connection.');
      } else {
        throw new Error(error.message || 'Failed to verify OTP');
      }
    }

    if (!data) {
      throw new Error('No response data from OTP verification service')
    }

    // Handle error responses from the function
    if (!data.success) {
      console.error('❌ OTP verification failed:', data.error);
      
      // Handle specific error codes from the edge function
      if (data.code === 'INVALID_OTP') {
        throw new Error('Invalid or expired OTP. Please request a new code.');
      } else if (data.code === 'TOO_MANY_ATTEMPTS') {
        throw new Error('Too many failed attempts. Please request a new OTP.');
      } else if (data.code === 'MISSING_PARAMETERS') {
        throw new Error('Invalid request parameters. Please try again.');
      } else {
        throw new Error(data.error || 'OTP verification failed');
      }
    }
    
    console.log('✅ OTP verified successfully:', data)
    return data
  } catch (error: any) {
    console.error('❌ OTP verification failed:', error);
    
    // Provide more specific error messages
    if (error.message?.includes('Invalid or expired')) {
      throw new Error('Invalid or expired OTP. Please request a new code.');
    } else if (error.message?.includes('Too many')) {
      throw new Error('Too many failed attempts. Please request a new OTP.');
    } else if (error.message?.includes('Network error')) {
      throw new Error('Network connection issue. Please check your internet and try again.');
    } else if (error.message?.includes('temporarily unavailable')) {
      throw new Error('Verification service is temporarily unavailable. Please try again in a moment.');
    } else {
      throw new Error(error.message || 'Failed to verify OTP. Please try again.');
    }
  }
}

export const getSubscriptionPlans = async () => {
  console.log('🔍 Fetching subscription plans from database...');
  
  try {
    const { data, error } = await supabase
        .from('tbl_subscription_plans')
        .select('*')
        .eq('tsp_is_active', true)
        .order('tsp_price')

    if (error) throw error
    return data
  } catch (error) {
    console.error('❌ Failed to fetch subscription plans:', error);
    throw error;
  }
}

export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase
      .from('tbl_user_profiles')
      .select('*')
      .eq('tup_user_id', userId)
      .single()

  if (error) throw error
  return data
}

export const getMLMTreeNode = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('tbl_subscription_plans')
      .select('*')
      .order('tsp_created_at', { ascending: false });

    if (error) {
      console.error('❌ Database error fetching plans:', error);
      throw error;
    }
    
    console.log('✅ Subscription plans fetched:', data?.length || 0, 'plans');
    console.log('Plans data:', data);
    return data
  } catch (error) {
    console.error('❌ Failed to fetch subscription plans:', error);
    throw error;
  }
}

export const getReferralNetwork = async (userId: string, maxLevels: number = 10) => {
  try {
    const { data, error } = await supabase.rpc('get_referral_network_v1', {
      p_user_id: userId,
      p_max_levels: maxLevels
    });

    if (error) {
      console.warn('Failed to get referral network:', error);
      return [];
    }

    return data;
  } catch (error) {
    console.warn('Failed to get referral network:', error);
    return [];
  }
};

export const getReferralNetworkPage = async (params: {
  userId: string;
  maxLevels?: number;
  level?: number | null;
  searchTerm?: string | null;
  offset?: number;
  limit?: number;
}) => {
  try {
    const { userId, maxLevels = 10, level = null, searchTerm = null, offset = 0, limit = 50 } = params;
    const { data, error } = await supabase.rpc('get_referral_network_page_v1', {
      p_user_id: userId,
      p_max_levels: maxLevels,
      p_level: level,
      p_search_term: searchTerm,
      p_offset: offset,
      p_limit: limit
    });

    if (error) {
      console.warn('Failed to get referral network page:', error);
      return [];
    }

    return data;
  } catch (error) {
    console.warn('Failed to get referral network page:', error);
    return [];
  }
};

export const getReferralNetworkStats = async (userId: string, maxLevels: number = 100) => {
  try {
    const { data, error } = await supabase.rpc('get_referral_network_stats_v1', {
      p_user_id: userId,
      p_max_levels: maxLevels
    });

    if (error) {
      console.warn('Failed to get referral network stats:', error);
      return null;
    }

    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.warn('Failed to get referral network stats:', error);
    return null;
  }
};

export const checkSponsorshipNumberExists = async (sponsorshipNumber: string) => {
  try {
    const { data, error } = await supabase
        .rpc('get_sponsor_by_sponsorship_number', {
          p_sponsorship_number: sponsorshipNumber
        });

    if (error) {
      console.error('RPC Error checking sponsorship number:', error);
      return false;
    }

    return data && data.length > 0;
  } catch (error) {
    console.error('Failed to check sponsorship number:', error);
    return false;
  }
};

export interface SponsorStatus {
  user_id: string;
  sponsorship_number: string;
  first_name: string | null;
  username: string | null;
  is_active: boolean;
  is_registration_paid: boolean;
  email_verified: boolean;
  mobile_verified: boolean;
}

export const getSponsorStatusBySponsorshipNumber = async (sponsorshipNumber: string): Promise<SponsorStatus | null> => {
  try {
    const { data, error } = await supabase
      .rpc('get_sponsor_status_by_sponsorship_number', {
        p_sponsorship_number: sponsorshipNumber
      });

    if (error) {
      console.error('RPC Error checking sponsor status:', error);
      return null;
    }

    if (!data || data.length === 0) return null;
    return data[0] as SponsorStatus;
  } catch (error) {
    console.error('Failed to check sponsor status:', error);
    return null;
  }
};
export const getSystemSettings = async () => {
  const { data, error } = await supabase
      .from('tbl_system_settings')
      .select('*')

  if (error) throw error

  // Convert to key-value object
  const settings: Record<string, any> = {}
  data.forEach(setting => {
    settings[setting.tss_setting_key] = setting.tss_setting_value
  })

  return settings
}
