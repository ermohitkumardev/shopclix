import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAdmin } from '../../contexts/AdminContext';
import { checkSponsorshipNumberExists, getSponsorStatusBySponsorshipNumber, supabase } from '../../lib/supabase';
import { Eye, EyeOff, User, Mail, Phone, Users, ChevronDown, CheckCircle, XCircle, Info, Lock } from 'lucide-react';
import ReCaptcha from '../../components/ui/ReCaptcha';
import { verifyTurnstileToken } from '../../lib/turnstile';
import { sendAccountEmail } from '../../utils/accountEmails';

const countryCodes = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+972', country: 'Israel', flag: '🇮🇱' },
  { code: '+1', country: 'United States', flag: '🇺🇸' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
  { code: '+82', country: 'South Korea', flag: '🇰🇷' },
  { code: '+34', country: 'Spain', flag: '🇪🇸' },
  { code: '+39', country: 'Italy', flag: '🇮🇹' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷' },
  { code: '+7', country: 'Russia', flag: '🇷🇺' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
];

interface FormData {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  mobileCountryCode: string;
  parentAccount: string;
  gender: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

interface UsernameValidation {
  isValid: boolean;
  errors: string[];
  suggestions: string[];
}

interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  requirements: {
    minLength: boolean;
    maxLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
    noCommon: boolean;
    noSequences: boolean;
    noRepeats: boolean;
    minUniqueChars: boolean;
  };
}

const createEmailAlias = (email: string, suffix: string) => {
  const trimmedEmail = email.trim();
  const atIndex = trimmedEmail.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmedEmail.length - 1) return trimmedEmail;

  const local = trimmedEmail.slice(0, atIndex);
  const domain = trimmedEmail.slice(atIndex + 1);
  return `${local}+${suffix}@${domain}`;
};

const isLikelyEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const checkUsernameExists = async (username: string): Promise<boolean> => {
  try {
    console.log('🔍 Checking username availability via RPC:', username);
    const { data, error } = await supabase
        .rpc('check_username_exists', {
          p_username: username
        });

    if (error) {
      console.error('❌ Error checking username via RPC:', error);
      return false;
    }

    console.log('✅ Username check result:', data);
    return data === true;
  } catch (error) {
    console.error('❌ Error checking username uniqueness:', error);
    return false;
  }
};

const CustomerRegister: React.FC = () => {
  const { register } = useAuth();
  const { settings } = useAdmin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    userName: '',
    email: '',
    mobile: '',
    mobileCountryCode: '+91',
    parentAccount: '',
    gender: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false
  });

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showUsernameTooltip, setShowUsernameTooltip] = useState(false);
  const [showPasswordTooltip, setShowPasswordTooltip] = useState(false);

  // Email/mobile uniqueness state
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [emailWillAlias, setEmailWillAlias] = useState(false);
  const [checkingMobile, setCheckingMobile] = useState(false);
  const [mobileAvailable, setMobileAvailable] = useState<boolean | null>(null);

  // Referral validation state
  const [validatingReferral, setValidatingReferral] = useState(false);
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [referralMessage, setReferralMessage] = useState<string | null>(null);

  // Username validation state
  const [usernameValidation, setUsernameValidation] = useState<UsernameValidation>({
    isValid: false,
    errors: [],
    suggestions: []
  });
  const [validatingUsername, setValidatingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  // Password validation state
  const [passwordValidation, setPasswordValidation] = useState<PasswordValidation>({
    isValid: false,
    errors: [],
    requirements: {
      minLength: false,
      maxLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSpecialChar: false,
      noCommon: false,
      noSequences: false,
      noRepeats: false,
      minUniqueChars: false
    }
  });

  // Refs for preventing duplicate operations
  const referralInitialized = useRef(false);
  const validationTimeout = useRef<NodeJS.Timeout>();
  const usernameTimeout = useRef<NodeJS.Timeout>();
  const emailTimeout = useRef<NodeJS.Timeout>();
  const mobileTimeout = useRef<NodeJS.Timeout>();
  const passwordTimeout = useRef<NodeJS.Timeout>();
  const tooltipTimeout = useRef<NodeJS.Timeout>();
  const emailCheckSeq = useRef(0);
  const mobileCheckSeq = useRef(0);

  // Initialize referral code from URL once
  useEffect(() => {
    if (referralInitialized.current) return;

    const referralCode = searchParams.get('ref');
    if (referralCode) {
      referralInitialized.current = true;
      setFormData(prev => ({
        ...prev,
        parentAccount: referralCode
      }));
      // Validate referral code
      validateReferralCode(referralCode);
    }
  }, [searchParams]);

  // Debounced referral validation
  useEffect(() => {
    if (validationTimeout.current) {
      clearTimeout(validationTimeout.current);
    }

    if (formData.parentAccount && !referralInitialized.current) {
      validationTimeout.current = setTimeout(() => {
        validateReferralCode(formData.parentAccount);
      }, 500);
    }

    return () => {
      if (validationTimeout.current) {
        clearTimeout(validationTimeout.current);
      }
    };
  }, [formData.parentAccount]);

  // Debounced username validation
  useEffect(() => {
    if (usernameTimeout.current) {
      clearTimeout(usernameTimeout.current);
    }

    if (formData.userName.trim()) {
      usernameTimeout.current = setTimeout(() => {
        validateUsername(formData.userName);
      }, 300);
    } else {
      setUsernameValidation({
        isValid: false,
        errors: [],
        suggestions: []
      });
      setUsernameAvailable(null);
    }

    return () => {
      if (usernameTimeout.current) {
        clearTimeout(usernameTimeout.current);
      }
    };
  }, [formData.userName]);

  const runEmailUniquenessCheck = useCallback(async (rawEmail: string) => {
    const email = rawEmail.trim();
    const seq = ++emailCheckSeq.current;

    setEmailWillAlias(false);

    if (!email || !isLikelyEmail(email)) {
      setCheckingEmail(false);
      setEmailAvailable(null);
      return;
    }

    setCheckingEmail(true);

    try {
      if (settings.customerEmailUnique) {
        const { data: exists, error } = await supabase.rpc('check_customer_email_exists', { p_email: email });
        if (error) throw error;

        if (seq !== emailCheckSeq.current) return;
        setEmailAvailable(exists !== true);
      } else {
        // Even when uniqueness is disabled for customers, Supabase Auth still needs a unique email.
        // If this email already exists anywhere, we'll alias it during submit.
        const { data: existsAny, error } = await supabase.rpc('check_email_exists', { p_email: email });
        if (error) throw error;

        if (seq !== emailCheckSeq.current) return;
        setEmailAvailable(true);
        setEmailWillAlias(existsAny === true);
      }
    } catch (checkError) {
      console.warn('Email uniqueness check failed:', checkError);
      if (seq !== emailCheckSeq.current) return;
      setEmailAvailable(null);
      setEmailWillAlias(false);
    } finally {
      if (seq === emailCheckSeq.current) setCheckingEmail(false);
    }
  }, [settings.customerEmailUnique]);

  // Debounced email uniqueness check
  useEffect(() => {
    if (emailTimeout.current) clearTimeout(emailTimeout.current);

    if (formData.email.trim()) {
      emailTimeout.current = setTimeout(() => {
        runEmailUniquenessCheck(formData.email);
      }, 400);
    } else {
      setCheckingEmail(false);
      setEmailAvailable(null);
      setEmailWillAlias(false);
    }

    return () => {
      if (emailTimeout.current) clearTimeout(emailTimeout.current);
    };
  }, [formData.email, runEmailUniquenessCheck]);

  const runMobileUniquenessCheck = useCallback(async (rawMobile: string, countryCode: string) => {
    const mobile = rawMobile.trim();
    const seq = ++mobileCheckSeq.current;

    if (!settings.customerMobileUnique) {
      setCheckingMobile(false);
      setMobileAvailable(null);
      return;
    }

    if (!mobile || mobile.length !== 10) {
      setCheckingMobile(false);
      setMobileAvailable(null);
      return;
    }

    const fullMobile = `${countryCode}${mobile}`;
    setCheckingMobile(true);

    try {
      const { data: exists, error } = await supabase.rpc('check_customer_mobile_exists', { p_mobile: fullMobile });
      if (error) throw error;

      if (seq !== mobileCheckSeq.current) return;
      setMobileAvailable(exists !== true);
    } catch (checkError) {
      console.warn('Mobile uniqueness check failed:', checkError);
      if (seq !== mobileCheckSeq.current) return;
      setMobileAvailable(null);
    } finally {
      if (seq === mobileCheckSeq.current) setCheckingMobile(false);
    }
  }, [settings.customerMobileUnique]);

  // Debounced mobile uniqueness check (depends on mobile + country code)
  useEffect(() => {
    if (mobileTimeout.current) clearTimeout(mobileTimeout.current);

    if (formData.mobile.trim() || formData.mobileCountryCode) {
      mobileTimeout.current = setTimeout(() => {
        runMobileUniquenessCheck(formData.mobile, formData.mobileCountryCode);
      }, 400);
    } else {
      setCheckingMobile(false);
      setMobileAvailable(null);
    }

    return () => {
      if (mobileTimeout.current) clearTimeout(mobileTimeout.current);
    };
  }, [formData.mobile, formData.mobileCountryCode, runMobileUniquenessCheck]);

  // Debounced password validation
  useEffect(() => {
    if (passwordTimeout.current) {
      clearTimeout(passwordTimeout.current);
    }

    if (formData.password) {
      passwordTimeout.current = setTimeout(() => {
        validatePassword(formData.password);
      }, 200);
    } else {
      setPasswordValidation({
        isValid: false,
        errors: [],
        requirements: {
          minLength: false,
          maxLength: false,
          hasUppercase: false,
          hasLowercase: false,
          hasNumber: false,
          hasSpecialChar: false,
          noCommon: false,
          noSequences: false,
          noRepeats: false,
          minUniqueChars: false
        }
      });
    }

    return () => {
      if (passwordTimeout.current) {
        clearTimeout(passwordTimeout.current);
      }
    };
  }, [formData.password]);

  const validateReferralCode = useCallback(async (referralCode: string) => {
    if (!referralCode.trim()) {
      setReferralValid(null);
      setReferralMessage(null);
      return;
    }

    setValidatingReferral(true);
    try {
      const sponsor = await getSponsorStatusBySponsorshipNumber(referralCode);
      if (!sponsor) {
        setReferralValid(false);
        setReferralMessage('Invalid referral code');
        return;
      }

      if (!sponsor.is_active) {
        setReferralValid(false);
        setReferralMessage('Parent A/C must be active to continue.');
        return;
      }

      if (!sponsor.is_registration_paid) {
        setReferralValid(false);
        setReferralMessage('Parent A/C must complete registration payment.');
        return;
      }

      if (!sponsor.email_verified && !sponsor.mobile_verified) {
        setReferralValid(false);
        setReferralMessage('Parent A/C must be verified (email or mobile).');
        return;
      }

      setReferralValid(true);
      setReferralMessage('Valid referral code ✓');
    } catch (error) {
      setReferralValid(false);
      setReferralMessage('Unable to validate referral code. Please try again.');
    } finally {
      setValidatingReferral(false);
    }
  }, []);

  // Username validation function
  const validateUsername = useCallback(async (username: string) => {
    if (!username.trim()) {
      setUsernameValidation({
        isValid: false,
        errors: [],
        suggestions: []
      });
      setUsernameAvailable(null);
      return;
    }

    setValidatingUsername(true);
    setUsernameAvailable(null);

    try {
      const errors: string[] = [];
      const suggestions: string[] = [];

      // Length validation
      if (username.length < settings.usernameMinLength) {
        errors.push(`Username must be at least ${settings.usernameMinLength} characters long`);
      }

      if (username.length > settings.usernameMaxLength) {
        errors.push(`Username must not exceed ${settings.usernameMaxLength} characters`);
      }

      // Space validation
      if (!settings.usernameAllowSpaces && /\s/.test(username)) {
        errors.push('Username cannot contain spaces');
      }

      // Start with letter validation
      if (settings.usernameMustStartWithLetter && !/^[a-zA-Z]/.test(username)) {
        errors.push('Username must start with a letter');
      }

      // Number validation
      if (!settings.usernameAllowNumbers && /\d/.test(username)) {
        errors.push('Username cannot contain numbers');
      }

      // Special characters validation
      if (!settings.usernameAllowSpecialChars && /[^a-zA-Z0-9]/.test(username)) {
        errors.push('Username cannot contain special characters');
      } else if (settings.usernameAllowSpecialChars && settings.usernameAllowedSpecialChars) {
        // Create regex pattern for allowed characters
        const allowedCharsPattern = new RegExp(`^[a-zA-Z0-9${settings.usernameAllowedSpecialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+$`);
        if (!allowedCharsPattern.test(username)) {
          errors.push(`Username can only contain letters, numbers, and these special characters: ${settings.usernameAllowedSpecialChars}`);
        }
      }

      // Lowercase conversion suggestion
      if (settings.usernameForceLowerCase && username !== username.toLowerCase()) {
        suggestions.push(`Username will be converted to lowercase: ${username.toLowerCase()}`);
      }

      // Check username uniqueness if no other errors
      if (settings.usernameUniqueRequired && errors.length === 0) {
        try {
          const exists = await checkUsernameExists(username);
          if (exists) {
            errors.push('Username is already taken');
            suggestions.push('Try adding numbers or underscores to make it unique');
            setUsernameAvailable(false);
          } else {
            setUsernameAvailable(true);
          }
        } catch (error) {
          console.error('Error checking username uniqueness:', error);
          errors.push('Unable to check username availability');
          setUsernameAvailable(null);
        }
      } else if (!settings.usernameUniqueRequired) {
        setUsernameAvailable(true); // If uniqueness not required, consider it available
      }

      // Generate suggestions for invalid usernames
      if (errors.length > 0 && settings.usernameUniqueRequired) {
        let suggestion = username;

        // Remove spaces if not allowed
        if (!settings.usernameAllowSpaces) {
          suggestion = suggestion.replace(/\s/g, '');
        }

        // Remove numbers if not allowed
        if (!settings.usernameAllowNumbers) {
          suggestion = suggestion.replace(/\d/g, '');
        }

        // Remove special characters if not allowed
        if (!settings.usernameAllowSpecialChars) {
          suggestion = suggestion.replace(/[^a-zA-Z0-9]/g, '');
        } else if (settings.usernameAllowedSpecialChars) {
          // Remove disallowed special characters
          const allowedChars = `a-zA-Z0-9${settings.usernameAllowedSpecialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
          suggestion = suggestion.replace(new RegExp(`[^${allowedChars}]`, 'g'), '');
        }

        // Convert to lowercase if forced
        if (settings.usernameForceLowerCase) {
          suggestion = suggestion.toLowerCase();
        }

        // Ensure starts with letter if required
        if (settings.usernameMustStartWithLetter && !/^[a-zA-Z]/.test(suggestion)) {
          suggestion = 'user' + suggestion;
        }

        // Ensure minimum length
        if (suggestion.length < settings.usernameMinLength) {
          const charsNeeded = settings.usernameMinLength - suggestion.length;
          suggestion = suggestion + '_' + Math.random().toString(36).substr(2, charsNeeded - 1);
        }

        // Ensure maximum length
        if (suggestion.length > settings.usernameMaxLength) {
          suggestion = suggestion.substring(0, settings.usernameMaxLength);
        }

        if (suggestion !== username && suggestion.length >= settings.usernameMinLength) {
          suggestions.push(`Try: ${suggestion}`);
        }
      }

      setUsernameValidation({
        isValid: errors.length === 0,
        errors,
        suggestions
      });

    } catch (error) {
      setUsernameValidation({
        isValid: false,
        errors: ['Error validating username'],
        suggestions: []
      });
      setUsernameAvailable(null);
    } finally {
      setValidatingUsername(false);
    }
  }, [settings]);

  // Password validation function
  const validatePassword = useCallback((password: string) => {
    if (!password) {
      setPasswordValidation({
        isValid: false,
        errors: [],
        requirements: {
          minLength: false,
          maxLength: false,
          hasUppercase: false,
          hasLowercase: false,
          hasNumber: false,
          hasSpecialChar: false,
          noCommon: false,
          noSequences: false,
          noRepeats: false,
          minUniqueChars: false
        }
      });
      return;
    }

    const errors: string[] = [];
    const requirements = {
      minLength: password.length >= settings.passwordMinLength,
      maxLength: password.length <= settings.passwordMaxLength,
      hasUppercase: settings.passwordRequireUppercase ? /[A-Z]/.test(password) : true,
      hasLowercase: settings.passwordRequireLowercase ? /[a-z]/.test(password) : true,
      hasNumber: settings.passwordRequireNumbers ? /\d/.test(password) : true,
      hasSpecialChar: settings.passwordRequireSpecialChars ?
          new RegExp(`[${settings.passwordAllowedSpecialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password) : true,
      noCommon: settings.passwordPreventCommon ? !isCommonPassword(password) : true,
      noSequences: settings.passwordPreventSequences ? !hasSequences(password) : true,
      noRepeats: settings.passwordPreventRepeats ? !hasRepeatedChars(password, settings.passwordMaxConsecutive) : true,
      minUniqueChars: getUniqueCharsCount(password) >= settings.passwordMinUniqueChars
    };

    // Check individual requirements and add errors
    if (!requirements.minLength) {
      errors.push(`Password must be at least ${settings.passwordMinLength} characters`);
    }

    if (!requirements.maxLength) {
      errors.push(`Password must not exceed ${settings.passwordMaxLength} characters`);
    }

    if (settings.passwordRequireUppercase && !requirements.hasUppercase) {
      errors.push('Password must contain at least one uppercase letter (A-Z)');
    }

    if (settings.passwordRequireLowercase && !requirements.hasLowercase) {
      errors.push('Password must contain at least one lowercase letter (a-z)');
    }

    if (settings.passwordRequireNumbers && !requirements.hasNumber) {
      errors.push('Password must contain at least one number (0-9)');
    }

    if (settings.passwordRequireSpecialChars && !requirements.hasSpecialChar) {
      errors.push(`Password must contain at least one special character: ${settings.passwordAllowedSpecialChars}`);
    }

    if (settings.passwordPreventCommon && !requirements.noCommon) {
      errors.push('Password is too common. Please choose a stronger password');
    }

    if (settings.passwordPreventSequences && !requirements.noSequences) {
      errors.push('Password contains sequential characters (abc, 123, etc.)');
    }

    if (settings.passwordPreventRepeats && !requirements.noRepeats) {
      errors.push(`Password contains more than ${settings.passwordMaxConsecutive} consecutive identical characters`);
    }

    if (!requirements.minUniqueChars) {
      errors.push(`Password must contain at least ${settings.passwordMinUniqueChars} unique characters`);
    }

    setPasswordValidation({
      isValid: errors.length === 0,
      errors,
      requirements
    });
  }, [settings]);

  // Helper functions for password validation
  const isCommonPassword = (password: string): boolean => {
    const commonPasswords = [
      'password', '123456', 'password123', 'qwerty', 'letmein', 'welcome',
      'admin', '12345678', '123456789', '12345', '1234567', '1234567890',
      'abc123', 'password1', '1234', 'test', 'guest', 'passw0rd'
    ];
    return commonPasswords.includes(password.toLowerCase());
  };

  const hasSequences = (password: string): boolean => {
    // Check for sequential characters (abc, 123, etc.)
    const sequences = [
      'abc', 'bcd', 'cde', 'def', 'efg', 'fgh', 'ghi', 'hij', 'ijk', 'jkl',
      'klm', 'lmn', 'mno', 'nop', 'opq', 'pqr', 'qrs', 'rst', 'stu', 'tuv',
      'uvw', 'vwx', 'wxy', 'xyz',
      '012', '123', '234', '345', '456', '567', '678', '789', '890',
      'qwe', 'wer', 'ert', 'rty', 'tyu', 'yui', 'uio', 'iop', 'asd',
      'sdf', 'dfg', 'fgh', 'ghj', 'hjk', 'jkl', 'zxc', 'xcv', 'cvb', 'vbn', 'bnm'
    ];

    const lowerPassword = password.toLowerCase();
    return sequences.some(seq => lowerPassword.includes(seq));
  };

  const hasRepeatedChars = (password: string, maxConsecutive: number): boolean => {
    let currentChar = '';
    let currentCount = 0;

    for (let i = 0; i < password.length; i++) {
      if (password[i] === currentChar) {
        currentCount++;
        if (currentCount > maxConsecutive) {
          return true;
        }
      } else {
        currentChar = password[i];
        currentCount = 1;
      }
    }
    return false;
  };

  const getUniqueCharsCount = (password: string): number => {
    const uniqueChars = new Set(password);
    return uniqueChars.size;
  };

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    // Mobile number validation
    if (name === 'mobile') {
      if (value === '' || (/^\d*$/.test(value) && value.length <= 10)) {
        setFormData(prev => ({ ...prev, [name]: value }));
      }
      return;
    }

    // Username validation - prevent spaces if not allowed
    if (name === 'userName' && !settings.usernameAllowSpaces) {
      const sanitizedValue = value.replace(/\s/g, '');
      setFormData(prev => ({
        ...prev,
        [name]: sanitizedValue
      }));
      return;
    }

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));

    // Reset referral validation when parent account changes manually
    if (name === 'parentAccount' && !referralInitialized.current) {
      setReferralValid(null);
    }
  }, [settings.usernameAllowSpaces]);

  const handleCountryCodeSelect = useCallback((code: string) => {
    setFormData(prev => ({ ...prev, mobileCountryCode: code }));
    setShowCountryDropdown(false);
  }, []);

  const handleUsernameTooltip = useCallback((show: boolean) => {
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }

    if (show) {
      setShowUsernameTooltip(true);
    } else {
      tooltipTimeout.current = setTimeout(() => {
        setShowUsernameTooltip(false);
      }, 300);
    }
  }, []);

  const handlePasswordTooltip = useCallback((show: boolean) => {
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }

    if (show) {
      setShowPasswordTooltip(true);
    } else {
      tooltipTimeout.current = setTimeout(() => {
        setShowPasswordTooltip(false);
      }, 300);
    }
  }, []);

  const validateForm = useCallback((): string | null => {
    if (!recaptchaToken) {
      return 'Please complete the security verification';
    }

    if (settings.customerEmailUnique && formData.email.trim() && isLikelyEmail(formData.email) && emailAvailable === false) {
      return 'This email address is already used by another customer.';
    }

    if (settings.customerMobileUnique && formData.mobile.trim().length === 10 && mobileAvailable === false) {
      return 'This mobile number is already used by another customer.';
    }

    if (!usernameValidation.isValid && formData.userName.trim()) {
      return 'Please fix username validation errors';
    }

    if (settings.usernameUniqueRequired && usernameAvailable === false) {
      return 'Username is already taken. Please choose a different one.';
    }

    if (!passwordValidation.isValid && formData.password) {
      return 'Please fix password validation errors';
    }

    if (formData.password !== formData.confirmPassword) {
      return 'Passwords do not match';
    }

    if (!formData.acceptTerms) {
      return 'Please accept the terms and conditions';
    }

    if (settings.referralMandatory && !formData.parentAccount) {
      return 'Referral account is mandatory';
    }

    if (formData.mobile && !/^\d{10}$/.test(formData.mobile)) {
      return 'Mobile number must be exactly 10 digits';
    }

    // Check if either email or mobile is provided when either verification is required
    if (settings.eitherVerificationRequired) {
      if (!formData.email && !formData.mobile) {
        return 'Either email or mobile number is required for verification';
      }
    }

    // Check if email is provided when email verification is required
    if (settings.emailVerificationRequired && !formData.email) {
      return 'Email address is required for verification';
    }

    // Check if mobile is provided when mobile verification is required
    if (settings.mobileVerificationRequired && !formData.mobile) {
      return 'Mobile number is required for verification';
    }

    return null;
  }, [formData, settings, recaptchaToken, usernameValidation, usernameAvailable, passwordValidation]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Validate username
    if (!usernameValidation.isValid) {
      setError('Please fix username validation errors before submitting');
      return;
    }

    // Validate password
    if (!passwordValidation.isValid) {
      setError('Please fix password validation errors before submitting');
      return;
    }

    // Final username availability check before submission
    if (settings.usernameUniqueRequired) {
      try {
        const finalCheck = await checkUsernameExists(formData.userName);
        if (finalCheck) {
          setError('Username is no longer available. Please choose a different one.');
          setUsernameAvailable(false);
          return;
        }
      } catch (error) {
        setError('Unable to verify username availability. Please try again.');
        return;
      }
    }

    // Validate referral code if provided
      let finalParentAccount = formData.parentAccount.trim();

      if (finalParentAccount) {
        try {
        const sponsor = await getSponsorStatusBySponsorshipNumber(finalParentAccount);
        if (!sponsor) {
          setError('Invalid referral code. Please check and try again.');
          return;
        }

        if (!sponsor.is_active) {
          setError('Parent A/C must be active to continue.');
          return;
        }

        if (!sponsor.is_registration_paid) {
          setError('Parent A/C must complete registration payment.');
          return;
        }

        if (!sponsor.email_verified && !sponsor.mobile_verified) {
          setError('Parent A/C must be verified (email or mobile).');
          return;
        }
      } catch (referralError) {
        setError('Unable to validate referral code at this time. Please try again.' + referralError);
        return;
      }
    } else if(settings.referralMandatory) {
      setError('Referral code is required');
      return;
    } else {
      const { data: defaultParent, error: defaultParentError } = await supabase.rpc('get_default_parent_sponsorship_number');
      if (defaultParentError) {
        setError('Unable to resolve default parent account. Please enter a referral code or try again.');
        return;
      }

      finalParentAccount = String(defaultParent || '').trim();
      if (!finalParentAccount) {
        setError('Default parent account is not configured. Please enter a referral code.');
        return;
      }
    }

    setError('');
    setIsSubmitting(true);

    try {
      await verifyTurnstileToken({
        token: recaptchaToken,
        siteMode: settings.siteMode,
        action: 'customer_register',
      });

      const fullMobile = formData.mobileCountryCode + formData.mobile;

      // Apply username transformations based on settings
      let finalUsername = formData.userName;
      if (settings.usernameForceLowerCase) {
        finalUsername = finalUsername.toLowerCase();
      }

      let finalEmail = formData.email.trim();

      if (settings.customerEmailUnique) {
        const { data: existsCustomerEmail, error } = await supabase.rpc('check_customer_email_exists', { p_email: finalEmail });
        if (error) throw error;

        if (existsCustomerEmail === true) {
          setError('This email address is already used by another customer.');
          return;
        }
      } else {
        // Supabase Auth always requires unique emails. When uniqueness is disabled in settings
        // (typically for development/testing), we auto-generate an alias to avoid auth conflicts.
        const { data: existsAnyEmail, error } = await supabase.rpc('check_email_exists', { p_email: finalEmail });
        if (error) throw error;

        if (existsAnyEmail === true) {
          const safeUsername = finalUsername.replace(/[^a-z0-9._-]/gi, '').slice(0, 16) || 'user';
          for (let attempt = 0; attempt < 5; attempt++) {
            const rand = Math.random().toString(36).slice(2, 8);
            const alias = createEmailAlias(finalEmail, `sc_${safeUsername}_${rand}`);

            const { data: aliasExistsAny, error: aliasExistsError } = await supabase.rpc('check_email_exists', { p_email: alias });
            if (aliasExistsError) throw aliasExistsError;

            if (aliasExistsAny !== true) {
              finalEmail = alias;
              break;
            }
          }
        }
      }

      if (settings.customerMobileUnique) {
        const { data: existsCustomerMobile, error } = await supabase.rpc('check_customer_mobile_exists', { p_mobile: fullMobile });
        if (error) throw error;

        if (existsCustomerMobile === true) {
          setError('This mobile number is already used by another customer.');
          return;
        }
      }

      const userId = await register({
        ...formData,
        userName: finalUsername,
        email: finalEmail,
        mobile: fullMobile,
        parentAccount: finalParentAccount
      }, 'customer');

	      // Determine verification requirements
	      const needsVerification = settings.emailVerificationRequired ||
	          settings.mobileVerificationRequired ||
	          settings.eitherVerificationRequired;
	      const nextRouteAfterVerification = (settings.launchPhase || 'prelaunch') === 'launched'
	        ? '/subscription-plans'
	        : '/registration-payment';

	      if (needsVerification) {
	        navigate('/verify-otp', {
	          state: {
            userId,
            email: finalEmail,
            mobile: fullMobile,
            verificationSettings: {
              emailRequired: settings.emailVerificationRequired,
              mobileRequired: settings.mobileVerificationRequired,
              eitherRequired: settings.eitherVerificationRequired
	            },
	            fromRegistration: true,
	            returnTo: nextRouteAfterVerification
	          }
	        });
	      } else {
	        void sendAccountEmail({ type: 'welcome' });
	        navigate(nextRouteAfterVerification);
	      }
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Please try again.');
      // Error handling is done by notification system in AuthContext
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, settings, recaptchaToken, isSubmitting, validateForm, usernameValidation, usernameAvailable, passwordValidation, register, navigate]);

  const selectedCountry = countryCodes.find(country => country.code === formData.mobileCountryCode);
  const isEmailDuplicate =
    settings.customerEmailUnique &&
    formData.email.trim() &&
    isLikelyEmail(formData.email) &&
    emailAvailable === false;
  const isMobileDuplicate =
    settings.customerMobileUnique &&
    formData.mobile.trim().length === 10 &&
    mobileAvailable === false;
  const isUniquenessCheckInProgress =
    (settings.customerEmailUnique && checkingEmail) ||
    (settings.customerMobileUnique && checkingMobile);

  return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white p-8 rounded-2xl shadow-xl">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900">Customer Registration</h2>
              <p className="mt-2 text-gray-600">Join our referral network and start earning</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                    First Name *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="firstName"
                        name="firstName"
                        type="text"
                        required
                        value={formData.firstName}
                        onChange={handleChange}
                        className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="First name"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                    Last Name *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="lastName"
                        name="lastName"
                        type="text"
                        required
                        value={formData.lastName}
                        onChange={handleChange}
                        className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="Last name"
                    />
                  </div>
                </div>
              </div>

              {/* Enhanced Username Field with Tooltip */}
              <div>
                <div className="flex items-center mb-2">
                  <label htmlFor="userName" className="block text-sm font-medium text-gray-700">
                    Username *
                  </label>
                  <div
                      className="relative ml-2"
                      onMouseEnter={() => handleUsernameTooltip(true)}
                      onMouseLeave={() => handleUsernameTooltip(false)}
                  >
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    {showUsernameTooltip && (
                        <div className="absolute z-10 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg bottom-full mb-2 left-1/2 transform -translate-x-1/2">
                          <div className="font-medium mb-1">Username Requirements:</div>
                          <ul className="space-y-1">
                            <li>• {settings.usernameMinLength}-{settings.usernameMaxLength} characters</li>
                            {!settings.usernameAllowSpaces && <li>• No spaces allowed</li>}
                            {settings.usernameMustStartWithLetter && <li>• Must start with a letter</li>}
                            {!settings.usernameAllowNumbers && <li>• No numbers allowed</li>}
                            {!settings.usernameAllowSpecialChars ? (
                                <li>• No special characters allowed</li>
                            ) : (
                                <li>• Allowed: {settings.usernameAllowedSpecialChars || 'none'}</li>
                            )}
                            {settings.usernameForceLowerCase && <li>• Will be converted to lowercase</li>}
                            {settings.usernameUniqueRequired && <li>• Must be unique</li>}
                          </ul>
                          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                        </div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                      id="userName"
                      name="userName"
                      type="text"
                      required
                      value={formData.userName}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-10 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                          formData.userName ?
                              (usernameValidation.isValid && usernameAvailable !== false ? 'border-green-300' : 'border-red-300') :
                              'border-gray-300'
                      }`}
                      placeholder="Choose a username"
                      maxLength={settings.usernameMaxLength}
                  />

                  {/* Single clear/status button */}
                  {formData.userName && (
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                        <button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, userName: '' }));
                              setUsernameValidation({
                                isValid: false,
                                errors: [],
                                suggestions: []
                              });
                              setUsernameAvailable(null);
                            }}
                            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                            title="Clear username"
                        >
                          {validatingUsername ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                          ) : usernameValidation.isValid && usernameAvailable !== false ? (
                              <CheckCircle className="h-5 w-5 text-green-500 hover:text-green-600" />
                          ) : (
                              <XCircle className="h-5 w-5 text-red-500 hover:text-red-600" />
                          )}
                        </button>
                      </div>
                  )}
                </div>

                {/* Username validation feedback */}
                {formData.userName && (
                    <div className="mt-2">
                      {usernameValidation.errors.length > 0 && (
                          <div className="space-y-1">
                            {usernameValidation.errors.map((error, index) => (
                                <p key={index} className="text-xs text-red-600 flex items-center">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  {error}
                                </p>
                            ))}
                          </div>
                      )}

                      {usernameValidation.suggestions.length > 0 && (
                          <div className="space-y-1 mt-2">
                            {usernameValidation.suggestions.map((suggestion, index) => (
                                <p key={index} className="text-xs text-blue-600 flex items-center">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  {suggestion}
                                </p>
                            ))}
                          </div>
                      )}

                      {usernameValidation.isValid && usernameAvailable === true && (
                          <p className="text-xs text-green-600 flex items-center">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Username is valid and available
                          </p>
                      )}

                      {usernameValidation.isValid && usernameAvailable === false && (
                          <p className="text-xs text-red-600 flex items-center">
                            <XCircle className="h-3 w-3 mr-1" />
                            Username is already taken
                          </p>
                      )}

                      {usernameValidation.isValid && usernameAvailable === null && settings.usernameUniqueRequired && (
                          <p className="text-xs text-yellow-600 flex items-center">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-600 mr-1"></div>
                            Checking availability...
                          </p>
                      )}

                      {/* Character count */}
                      <p className={`text-xs mt-1 ${
                          formData.userName.length > settings.usernameMaxLength ? 'text-red-600' :
                              formData.userName.length < settings.usernameMinLength ? 'text-yellow-600' :
                                  'text-gray-500'
                      }`}>
                        {formData.userName.length} / {settings.usernameMaxLength} characters
                        {formData.userName.length < settings.usernameMinLength &&
                            ` (minimum ${settings.usernameMinLength} required)`}
                      </p>
                    </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address {settings.emailVerificationRequired || settings.eitherVerificationRequired ? '*' : ''}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        required={settings.emailVerificationRequired || settings.eitherVerificationRequired}
                        value={formData.email}
                        onChange={handleChange}
                        onBlur={() => runEmailUniquenessCheck(formData.email)}
                        className={`block w-full pl-10 pr-3 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                          !formData.email.trim()
                            ? 'border-gray-300'
                            : settings.customerEmailUnique
                              ? (emailAvailable === false ? 'border-red-300' : emailAvailable === true ? 'border-green-300' : 'border-gray-300')
                              : (emailWillAlias ? 'border-blue-300' : 'border-gray-300')
                        }`}
                        placeholder="your@email.com"
                    />
                  </div>
                  {checkingEmail && formData.email.trim() && isLikelyEmail(formData.email) && (
                    <p className="text-xs text-yellow-600 flex items-center mt-1">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-600 mr-1"></div>
                      Checking email...
                    </p>
                  )}
                  {!checkingEmail && settings.customerEmailUnique && emailAvailable === true && formData.email.trim() && isLikelyEmail(formData.email) && (
                    <p className="text-xs text-green-600 flex items-center mt-1">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Email is available
                    </p>
                  )}
                  {!checkingEmail && settings.customerEmailUnique && emailAvailable === false && formData.email.trim() && isLikelyEmail(formData.email) && (
                    <p className="text-xs text-red-600 flex items-center mt-1">
                      <XCircle className="h-3 w-3 mr-1" />
                      Email is already used by another customer
                    </p>
                  )}
                  {!checkingEmail && !settings.customerEmailUnique && formData.email.trim() && isLikelyEmail(formData.email) && emailWillAlias && (
                    <p className="text-xs text-blue-600 flex items-center mt-1">
                      <Info className="h-3 w-3 mr-1" />
                      Email already exists; we will auto-generate a unique alias for this test account
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="mobile" className="block text-sm font-medium text-gray-700 mb-2">
                    Mobile Number {settings.mobileVerificationRequired || settings.eitherVerificationRequired ? '*' : ''}
                  </label>
                  <div className="flex space-x-2">
                    <div className="relative">
                      <button
                          type="button"
                          onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                          className="flex items-center space-x-1 pl-3 pr-2 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white h-full"
                      >
                        <span>{selectedCountry?.flag}</span>
                        <span>{selectedCountry?.code}</span>
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </button>

                      {showCountryDropdown && (
                          <div className="absolute z-10 mt-1 w-48 max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                            {countryCodes.map((country) => (
                                <div
                                    key={country.code}
                                    onClick={() => handleCountryCodeSelect(country.code)}
                                    className="flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer"
                                >
                                  <span className="mr-2">{country.flag}</span>
                                  <span className="flex-1">{country.country}</span>
                                  <span className="text-gray-500">{country.code}</span>
                                </div>
                            ))}
                          </div>
                      )}
                    </div>

                    <div className="flex-1 relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Phone className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                          id="mobile"
                          name="mobile"
                          type="tel"
                          required={settings.mobileVerificationRequired || settings.eitherVerificationRequired}
                          value={formData.mobile}
                          onChange={handleChange}
                          onBlur={() => runMobileUniquenessCheck(formData.mobile, formData.mobileCountryCode)}
                          className={`block w-full pl-10 pr-3 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                            !formData.mobile.trim()
                              ? 'border-gray-300'
                              : settings.customerMobileUnique && formData.mobile.trim().length === 10
                                ? (mobileAvailable === false ? 'border-red-300' : mobileAvailable === true ? 'border-green-300' : 'border-gray-300')
                                : 'border-gray-300'
                          }`}
                          placeholder="1234567890"
                          maxLength={10}
                          pattern="[0-9]{10}"
                      />
                    </div>
                  </div>
                  <div className="mt-1 space-y-1">
                    <p className="text-xs text-gray-500">Enter 10-digit mobile number</p>
                    {settings.customerMobileUnique && checkingMobile && formData.mobile.trim().length === 10 && (
                      <p className="text-xs text-yellow-600 flex items-center">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-600 mr-1"></div>
                        Checking mobile...
                      </p>
                    )}
                    {settings.customerMobileUnique && !checkingMobile && mobileAvailable === true && formData.mobile.trim().length === 10 && (
                      <p className="text-xs text-green-600 flex items-center">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Mobile is available
                      </p>
                    )}
                    {settings.customerMobileUnique && !checkingMobile && mobileAvailable === false && formData.mobile.trim().length === 10 && (
                      <p className="text-xs text-red-600 flex items-center">
                        <XCircle className="h-3 w-3 mr-1" />
                        Mobile is already used by another customer
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="parentAccount" className="block text-sm font-medium text-gray-700 mb-2">
                    Parent A/C {settings.referralMandatory ? '*' : '(Optional)'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Users className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="parentAccount"
                        name="parentAccount"
                        type="text"
                        required={settings.referralMandatory}
                        value={formData.parentAccount}
                        onChange={handleChange}
                        className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder="Referral ID"
                    />

                    {formData.parentAccount && (
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                          {validatingReferral ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                          ) : referralValid === true ? (
                              <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                                <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </div>
                          ) : referralValid === false ? (
                              <div className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center">
                                <svg className="w-3 h-3 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                              </div>
                          ) : null}
                        </div>
                    )}
                  </div>
                  {formData.parentAccount && referralValid === false && (
                      <p className="text-xs text-red-600 mt-1">{referralMessage || 'Invalid referral code'}</p>
                  )}
                  {formData.parentAccount && referralValid === true && (
                      <p className="text-xs text-green-600 mt-1">{referralMessage || 'Valid referral code ✓'}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-2">
                    Gender *
                  </label>
                  <select
                      id="gender"
                      name="gender"
                      required
                      value={formData.gender}
                      onChange={handleChange}
                      className="block w-full py-3 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Enhanced Password Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center mb-2">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                      New Password *
                    </label>
                    <div
                        className="relative ml-2"
                        onMouseEnter={() => handlePasswordTooltip(true)}
                        onMouseLeave={() => handlePasswordTooltip(false)}
                    >
                      <Info className="h-4 w-4 text-gray-400 cursor-help" />
                      {showPasswordTooltip && (
                          <div className="absolute z-10 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg bottom-full mb-2 left-1/2 transform -translate-x-1/2">
                            <div className="font-medium mb-1">Password Requirements:</div>
                            <ul className="space-y-1">
                              <li>• {settings.passwordMinLength}-{settings.passwordMaxLength} characters</li>
                              {settings.passwordRequireUppercase && <li>• At least one uppercase letter (A-Z)</li>}
                              {settings.passwordRequireLowercase && <li>• At least one lowercase letter (a-z)</li>}
                              {settings.passwordRequireNumbers && <li>• At least one number (0-9)</li>}
                              {settings.passwordRequireSpecialChars && (
                                  <li>• At least one special character: {settings.passwordAllowedSpecialChars}</li>
                              )}
                              {settings.passwordPreventCommon && <li>• Cannot be a common password</li>}
                              {settings.passwordPreventSequences && <li>• Cannot contain sequences (abc, 123)</li>}
                              {settings.passwordPreventRepeats && (
                                  <li>• Max {settings.passwordMaxConsecutive} consecutive identical characters</li>
                              )}
                              <li>• At least {settings.passwordMinUniqueChars} unique characters</li>
                            </ul>
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                          </div>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={formData.password}
                        onChange={handleChange}
                        className={`block w-full pl-10 pr-10 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                            formData.password ?
                                (passwordValidation.isValid ? 'border-green-300' : 'border-red-300') :
                                'border-gray-300'
                        }`}
                        placeholder="Create a strong password"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>

                  {/* Password validation feedback */}
                  {formData.password && (
                      <div className="mt-3 bg-gray-50 rounded-lg p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className={`flex items-center ${passwordValidation.requirements.minLength ? 'text-green-600' : 'text-red-600'}`}>
                            {passwordValidation.requirements.minLength ? (
                                <CheckCircle className="h-3 w-3 mr-2" />
                            ) : (
                                <XCircle className="h-3 w-3 mr-2" />
                            )}
                            {settings.passwordMinLength}+ characters
                          </div>

                          <div className={`flex items-center ${passwordValidation.requirements.maxLength ? 'text-green-600' : 'text-red-600'}`}>
                            {passwordValidation.requirements.maxLength ? (
                                <CheckCircle className="h-3 w-3 mr-2" />
                            ) : (
                                <XCircle className="h-3 w-3 mr-2" />
                            )}
                            Max {settings.passwordMaxLength} characters
                          </div>

                          {settings.passwordRequireUppercase && (
                              <div className={`flex items-center ${passwordValidation.requirements.hasUppercase ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.hasUppercase ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Uppercase letter
                              </div>
                          )}

                          {settings.passwordRequireLowercase && (
                              <div className={`flex items-center ${passwordValidation.requirements.hasLowercase ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.hasLowercase ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Lowercase letter
                              </div>
                          )}

                          {settings.passwordRequireNumbers && (
                              <div className={`flex items-center ${passwordValidation.requirements.hasNumber ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.hasNumber ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Number
                              </div>
                          )}

                          {settings.passwordRequireSpecialChars && (
                              <div className={`flex items-center ${passwordValidation.requirements.hasSpecialChar ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.hasSpecialChar ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Special character
                              </div>
                          )}

                          {settings.passwordPreventCommon && (
                              <div className={`flex items-center ${passwordValidation.requirements.noCommon ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.noCommon ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Not common
                              </div>
                          )}

                          {settings.passwordPreventSequences && (
                              <div className={`flex items-center ${passwordValidation.requirements.noSequences ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.noSequences ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                No sequences
                              </div>
                          )}

                          {settings.passwordPreventRepeats && (
                              <div className={`flex items-center ${passwordValidation.requirements.noRepeats ? 'text-green-600' : 'text-red-600'}`}>
                                {passwordValidation.requirements.noRepeats ? (
                                    <CheckCircle className="h-3 w-3 mr-2" />
                                ) : (
                                    <XCircle className="h-3 w-3 mr-2" />
                                )}
                                Max {settings.passwordMaxConsecutive} repeats
                              </div>
                          )}

                          <div className={`flex items-center ${passwordValidation.requirements.minUniqueChars ? 'text-green-600' : 'text-red-600'}`}>
                            {passwordValidation.requirements.minUniqueChars ? (
                                <CheckCircle className="h-3 w-3 mr-2" />
                            ) : (
                                <XCircle className="h-3 w-3 mr-2" />
                            )}
                            {settings.passwordMinUniqueChars}+ unique chars
                          </div>
                        </div>

                        {/* Password strength indicator */}
                        <div className="mt-2">
                          <div className="flex justify-between text-xs mb-1">
                            <span>Password strength:</span>
                            <span className={
                              passwordValidation.isValid ? 'text-green-600 font-medium' :
                                  formData.password.length > 0 ? 'text-yellow-600' : 'text-gray-500'
                            }>
                              {passwordValidation.isValid ? 'Strong' :
                                  formData.password.length > 0 ? 'Weak' : 'None'}
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                    passwordValidation.isValid ? 'bg-green-500 w-full' :
                                        formData.password.length > 0 ? 'bg-yellow-500 w-1/2' : 'bg-gray-300 w-0'
                                }`}
                            ></div>
                          </div>
                        </div>
                      </div>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        className={`block w-full pl-10 pr-10 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                            formData.confirmPassword ?
                                (formData.password === formData.confirmPassword ? 'border-green-300' : 'border-red-300') :
                                'border-gray-300'
                        }`}
                        placeholder="Confirm your password"
                    />
                    <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                      <p className="text-xs text-red-600 mt-1">Passwords do not match</p>
                  )}
                  {formData.confirmPassword && formData.password === formData.confirmPassword && (
                      <p className="text-xs text-green-600 mt-1">Passwords match ✓</p>
                  )}
                </div>
              </div>

              <div className="flex items-center">
                <input
                    id="acceptTerms"
                    name="acceptTerms"
                    type="checkbox"
                    checked={formData.acceptTerms}
                    onChange={handleChange}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="acceptTerms" className="ml-2 block text-sm text-gray-700">
                  I accept the{' '}
                  <Link to="#" className="text-indigo-600 hover:text-indigo-500">
                    Terms and Conditions
                  </Link>
                </label>
              </div>

              <ReCaptcha onVerify={setRecaptchaToken} />

              <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    !recaptchaToken ||
                    !usernameValidation.isValid ||
                    !passwordValidation.isValid ||
                    isUniquenessCheckInProgress ||
                    isEmailDuplicate ||
                    isMobileDuplicate
                  }
                  className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
              >
                {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Creating Account...</span>
                    </>
                ) : (
                    <span>Create Account</span>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-gray-600">
                Already have an account?{' '}
                <Link to="/customer/login" className="text-indigo-600 hover:text-indigo-500 font-medium">
                  Sign in here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
  );
};

export default CustomerRegister;
