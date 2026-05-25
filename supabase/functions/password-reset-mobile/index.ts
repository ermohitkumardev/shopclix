import { createClient } from 'jsr:@supabase/supabase-js@2';
import { otpEmailTemplate, sendSmtpMail } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SITE_NAME = 'ShopClix';
const OTP_TTL_MS = 10 * 60 * 1000;
const MIN_RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const normalizeEmail = (value: string) => String(value || '').trim().toLowerCase();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const visibleName = name.length <= 2 ? name[0] : `${name.slice(0, 2)}***`;
  return `${visibleName}@${domain}`;
};

async function sendEmailOTP(email: string, otp: string) {
  try {
    await sendSmtpMail({
      to: email,
      subject: `Your Password Reset OTP - ${SITE_NAME}`,
      html: otpEmailTemplate(otp),
      text: `Your ${SITE_NAME} password reset OTP is ${otp}. This code expires in 10 minutes. Do not share this code with anyone.`,
      fromName: `${SITE_NAME} Security`,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Email send failed.',
    };
  }
}

async function findCustomerBySponsorAndEmail(
  supabase: ReturnType<typeof createClient>,
  sponsorshipNumber: string,
  email: string,
) {
  const { data: profile, error: profileError } = await supabase
    .from('tbl_user_profiles')
    .select('tup_user_id, tup_sponsorship_number')
    .eq('tup_sponsorship_number', sponsorshipNumber)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    return null;
  }

  const { data: user, error: userError } = await supabase
    .from('tbl_users')
    .select('tu_id, tu_email, tu_user_type, tu_is_active')
    .eq('tu_id', profile.tup_user_id)
    .maybeSingle();

  if (userError) throw userError;
  if (
    !user ||
    user.tu_user_type !== 'customer' ||
    user.tu_is_active === false ||
    normalizeEmail(user.tu_email || '') !== email
  ) {
    return null;
  }

  return {
    userId: profile.tup_user_id,
    email,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const action = String(body.action || '');
    const sponsorshipNumber = String(body.sponsorshipNumber || '').trim();
    const email = normalizeEmail(String(body.email || ''));

    if (!sponsorshipNumber || !isValidEmail(email)) {
      return jsonResponse({
        success: false,
        error: 'Enter a valid User ID and registered email address.',
      });
    }

    const account = await findCustomerBySponsorAndEmail(supabase, sponsorshipNumber, email);
    if (!account) {
      return jsonResponse({
        success: false,
        error: 'No customer account matched this User ID and email address.',
      });
    }

    if (action === 'request_reset') {
      const { data: recentOtp } = await supabase
        .from('tbl_otp_verifications')
        .select('tov_created_at')
        .eq('tov_user_id', account.userId)
        .eq('tov_otp_type', 'email')
        .eq('tov_contact_info', account.email)
        .eq('tov_is_verified', false)
        .gte('tov_expires_at', new Date().toISOString())
        .order('tov_created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentOtp?.tov_created_at) {
        const elapsed = Date.now() - new Date(recentOtp.tov_created_at).getTime();
        if (elapsed < MIN_RESEND_MS) {
          return jsonResponse({
            success: false,
            error: `OTP already sent. Please wait ${Math.ceil((MIN_RESEND_MS - elapsed) / 1000)} seconds before requesting again.`,
          });
        }
      }

      await supabase
        .from('tbl_otp_verifications')
        .update({ tov_is_verified: true, tov_updated_at: new Date().toISOString() })
        .eq('tov_user_id', account.userId)
        .eq('tov_otp_type', 'email')
        .eq('tov_is_verified', false);

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
      const { data: otpRecord, error: insertError } = await supabase
        .from('tbl_otp_verifications')
        .insert({
          tov_user_id: account.userId,
          tov_otp_code: otp,
          tov_otp_type: 'email',
          tov_contact_info: account.email,
          tov_expires_at: expiresAt,
          tov_is_verified: false,
          tov_attempts: 0,
        })
        .select('tov_id')
        .single();

      if (insertError) throw insertError;

      const emailResult = await sendEmailOTP(account.email, otp);
      if (!emailResult.success) {
        await supabase
          .from('tbl_otp_verifications')
          .update({ tov_is_verified: true, tov_updated_at: new Date().toISOString() })
          .eq('tov_id', otpRecord.tov_id);

        return jsonResponse({ success: false, error: emailResult.error });
      }

      return jsonResponse({
        success: true,
        message: `OTP sent to ${maskEmail(account.email)}`,
        expiresAt,
      });
    }

    if (action === 'reset_password') {
      const otpCode = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '');

      if (!/^\d{6}$/.test(otpCode)) {
        return jsonResponse({ success: false, error: 'Enter the 6-digit OTP.' });
      }

      if (newPassword.length < 8) {
        return jsonResponse({ success: false, error: 'Password must be at least 8 characters long.' });
      }

      const { data: otpRecord, error: otpError } = await supabase
        .from('tbl_otp_verifications')
        .select('tov_id, tov_attempts')
        .eq('tov_user_id', account.userId)
        .eq('tov_otp_type', 'email')
        .eq('tov_contact_info', account.email)
        .eq('tov_otp_code', otpCode)
        .eq('tov_is_verified', false)
        .gte('tov_expires_at', new Date().toISOString())
        .order('tov_created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (otpError) throw otpError;

      if (!otpRecord) {
        const { data: latestOtp } = await supabase
          .from('tbl_otp_verifications')
          .select('tov_id, tov_attempts')
          .eq('tov_user_id', account.userId)
          .eq('tov_otp_type', 'email')
          .eq('tov_contact_info', account.email)
          .eq('tov_is_verified', false)
          .order('tov_created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestOtp) {
          await supabase
            .from('tbl_otp_verifications')
            .update({ tov_attempts: (latestOtp.tov_attempts || 0) + 1 })
            .eq('tov_id', latestOtp.tov_id);
        }

        return jsonResponse({ success: false, error: 'Invalid or expired OTP. Please request a new code.' });
      }

      if ((otpRecord.tov_attempts || 0) >= MAX_ATTEMPTS) {
        return jsonResponse({ success: false, error: 'Too many failed attempts. Please request a new OTP.' });
      }

      const { error: updateAuthError } = await supabase.auth.admin.updateUserById(account.userId, {
        password: newPassword,
      });

      if (updateAuthError) throw updateAuthError;

      await supabase
        .from('tbl_otp_verifications')
        .update({
          tov_is_verified: true,
          tov_attempts: (otpRecord.tov_attempts || 0) + 1,
          tov_updated_at: new Date().toISOString(),
        })
        .eq('tov_id', otpRecord.tov_id);

      return jsonResponse({
        success: true,
        message: 'Password reset successfully.',
      });
    }

    return jsonResponse({ success: false, error: 'Invalid action.' });
  } catch (error: unknown) {
    console.error('Password reset email error:', error);
    const message = error instanceof Error ? error.message : 'Failed to reset password.';
    return jsonResponse({ success: false, error: message }, 500);
  }
});
