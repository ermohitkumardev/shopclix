import React, { useState, useEffect } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { adminApi } from '../../lib/adminApi';
import { adminSupabase as storageSupabase } from '../../lib/adminSupabase';
import { Settings, Upload, Save, AlertCircle, CheckCircle } from 'lucide-react';

const GeneralSettings: React.FC = () => {
    const { settings, updateSettings, loading, refreshSettings } = useAdmin();
    const [formData, setFormData] = useState({
        siteName: settings.siteName,
        logoUrl: settings.logoUrl,
        dateFormat: settings.dateFormat,
        timezone: settings.timezone,
        launchPhase: settings.launchPhase || 'prelaunch',
        siteMode: settings.siteMode || 'live',
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
        maintenanceNoticeEnabled: settings.maintenanceNoticeEnabled,
        maintenanceNoticeMessage: settings.maintenanceNoticeMessage,
        maintenanceWindowStartAt: settings.maintenanceWindowStartAt,
        maintenanceWindowEndAt: settings.maintenanceWindowEndAt,
        maintenanceAllowedIps: (settings.maintenanceAllowedIps || []).join('\n')
    });
    const [saving, setSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        setFormData({
            siteName: settings.siteName,
            logoUrl: settings.logoUrl,
            dateFormat: settings.dateFormat,
            timezone: settings.timezone,
            launchPhase: settings.launchPhase || 'prelaunch',
            siteMode: settings.siteMode || 'live',
            maintenanceMode: settings.maintenanceMode,
            maintenanceMessage: settings.maintenanceMessage,
            maintenanceNoticeEnabled: settings.maintenanceNoticeEnabled,
            maintenanceNoticeMessage: settings.maintenanceNoticeMessage,
            maintenanceWindowStartAt: settings.maintenanceWindowStartAt,
            maintenanceWindowEndAt: settings.maintenanceWindowEndAt,
            maintenanceAllowedIps: (settings.maintenanceAllowedIps || []).join('\n')
        });
    }, [settings]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveResult(null);

        try {
            // Update settings in database
            const updates = [
                // `tss_setting_value` is `jsonb`, so send primitives directly (not JSON-stringified strings).
                { key: 'site_name', value: String(formData.siteName || '') },
                { key: 'logo_url', value: String(formData.logoUrl || '') },
                { key: 'date_format', value: String(formData.dateFormat || '') },
                { key: 'timezone', value: String(formData.timezone || '') },
                { key: 'launch_phase', value: String(formData.launchPhase || 'prelaunch') },
                { key: 'site_mode', value: String(formData.siteMode || 'live') },
                { key: 'maintenance_mode', value: Boolean(formData.maintenanceMode) },
                { key: 'maintenance_message', value: String(formData.maintenanceMessage || '') },
                { key: 'maintenance_notice_enabled', value: Boolean(formData.maintenanceNoticeEnabled) },
                { key: 'maintenance_notice_message', value: String(formData.maintenanceNoticeMessage || '') },
                { key: 'maintenance_window_start_at', value: formData.maintenanceWindowStartAt ? String(formData.maintenanceWindowStartAt) : '' },
                { key: 'maintenance_window_end_at', value: formData.maintenanceWindowEndAt ? String(formData.maintenanceWindowEndAt) : '' },
                {
                    key: 'maintenance_allowed_ips',
                    value: String(formData.maintenanceAllowedIps || '')
                        .split(/[,\n\r]+/g)
                        .map((ip) => ip.trim())
                        .filter(Boolean)
                }
            ];

            await adminApi.post('admin-upsert-settings', {
                updates: updates.map((update) => ({
                    key: update.key,
                    value: update.value,
                    description: `${update.key.replace('_', ' ')} setting`
                }))
            });

            // Update context
            updateSettings({
                siteName: formData.siteName,
                logoUrl: formData.logoUrl,
                dateFormat: formData.dateFormat,
                timezone: formData.timezone,
                launchPhase: formData.launchPhase,
                siteMode: formData.siteMode,
                maintenanceMode: formData.maintenanceMode,
                maintenanceMessage: formData.maintenanceMessage,
                maintenanceNoticeEnabled: formData.maintenanceNoticeEnabled,
                maintenanceNoticeMessage: formData.maintenanceNoticeMessage,
                maintenanceWindowStartAt: formData.maintenanceWindowStartAt,
                maintenanceWindowEndAt: formData.maintenanceWindowEndAt,
                maintenanceAllowedIps: String(formData.maintenanceAllowedIps || '')
                    .split(/[,\n\r]+/g)
                    .map((ip) => ip.trim())
                    .filter(Boolean)
            });

            // Refresh settings from database to ensure sync
            await refreshSettings();

            setSaveResult({
                success: true,
                message: 'General settings updated successfully!'
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
            setSaveResult({
                success: false,
                message: 'Failed to save settings. Please try again.'
            });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const handleToggle = (name: 'maintenanceMode' | 'maintenanceNoticeEnabled') => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({
            ...prev,
            [name]: e.target.checked
        }));
    };

    const handleDateTimeLocalChange = (name: 'maintenanceWindowStartAt' | 'maintenanceWindowEndAt') =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            setFormData(prev => ({
                ...prev,
                [name]: value ? new Date(value).toISOString() : null
            }));
        };

    const toDateTimeLocalValue = (iso: string | null | undefined) => {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            setSaveResult({
                success: false,
                message: 'Please select a valid image file'
            });
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 10 * 1024 * 1024) {
            setSaveResult({
                success: false,
                message: 'Image file size must be less than 10MB'
            });
            return;
        }

        setUploading(true);
        setSaveResult(null);

        try {
            // Create a unique filename
            const fileExt = file.name.split('.').pop();
            const fileName = `logo-${Date.now()}.${fileExt}`;

            // Upload to Supabase Storage
            const { data, error } = await storageSupabase.storage
                .from('logos')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) {
                // If storage bucket doesn't exist, create a public URL from the file
                console.warn('Storage upload failed, using fallback method:', error);

                // Convert file to base64 data URL for preview
                const reader = new FileReader();
                reader.onload = (e) => {
                    const dataUrl = e.target?.result as string;
                    setFormData(prev => ({
                        ...prev,
                        logoUrl: dataUrl
                    }));

                    // Also update the admin context immediately
                    updateSettings({ logoUrl: dataUrl });

                    setSaveResult({
                        success: true,
                        message: 'Logo uploaded successfully! Click Save Settings to apply changes.'
                    });
                };
                reader.readAsDataURL(file);
                return;
            }

            // Get public URL
            const { data: { publicUrl } } = storageSupabase.storage
                .from('logos')
                .getPublicUrl(fileName);

            // Update form data with new URL
            setFormData(prev => ({
                ...prev,
                logoUrl: publicUrl
            }));

            // Also update the admin context immediately
            updateSettings({ logoUrl: publicUrl });

            setSaveResult({
                success: true,
                message: 'Logo uploaded successfully! Click Save Settings to apply changes.'
            });

        } catch (error) {
            console.error('Upload error:', error);
            setSaveResult({
                success: false,
                message: 'Failed to upload logo. Please try again.'
            });
        } finally {
            setUploading(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-600">Loading settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center space-x-3 mb-6">
                <div className="bg-blue-100 p-3 rounded-lg">
                    <Settings className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">General Settings</h3>
                    <p className="text-gray-600">Configure basic site settings and branding</p>
                </div>
            </div>

            {saveResult && (
                <div className={`border rounded-lg p-4 mb-6 ${
                    saveResult.success
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                }`}>
                    <div className="flex items-center space-x-2">
                        {saveResult.success ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                            <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                        <span className={`text-sm font-medium ${
                            saveResult.success ? 'text-green-800' : 'text-red-800'
                        }`}>
                            {saveResult.message}
                        </span>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="siteName" className="block text-sm font-medium text-gray-700 mb-2">
                            Site Name *
                        </label>
                        <input
                            type="text"
                            id="siteName"
                            name="siteName"
                            required
                            value={formData.siteName}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter site name"
                        />
                    </div>

                    <div>
                        <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700 mb-2">
                            Logo URL *
                        </label>
                        <div className="flex space-x-2">
                            <input
                                type="url"
                                id="logoUrl"
                                name="logoUrl"
                                required
                                value={formData.logoUrl}
                                onChange={handleChange}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="https://example.com/logo.png"
                            />
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleLogoUpload}
                                className="hidden"
                                id="logo-upload"
                            />
                            <label
                                htmlFor="logo-upload"
                                className={`px-4 py-3 rounded-lg transition-colors flex items-center space-x-2 cursor-pointer ${
                                    uploading
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-gray-600 hover:bg-gray-700'
                                } text-white`}
                            >
                                {uploading ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        <span>Uploading...</span>
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-4 w-4" />
                                        <span>Upload</span>
                                    </>
                                )}
                            </label>
                        </div>
                        {formData.logoUrl && (
                            <div className="mt-2">
                                <img
                                    src={formData.logoUrl}
                                    alt="Logo Preview"
                                    className="h-12 w-12 rounded-lg object-cover border border-gray-200"
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="dateFormat" className="block text-sm font-medium text-gray-700 mb-2">
                            Date Format
                        </label>
                        <select
                            id="dateFormat"
                            name="dateFormat"
                            value={formData.dateFormat}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-2">
                            Timezone
                        </label>
                        <select
                            id="timezone"
                            name="timezone"
                            value={formData.timezone}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="UTC">UTC</option>
                            <option value="America/New_York">Eastern Time</option>
                            <option value="America/Chicago">Central Time</option>
                            <option value="America/Denver">Mountain Time</option>
                            <option value="America/Los_Angeles">Pacific Time</option>
                            <option value="Europe/London">London</option>
                            <option value="Asia/Kolkata">India Standard Time</option>
                        </select>
                    </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-900">Site Mode</h4>
                                <p className="text-xs text-gray-600 mt-1">Controls development-only admin login behavior.</p>
                            </div>
                            <select
                                id="siteMode"
                                name="siteMode"
                                value={formData.siteMode}
                                onChange={handleChange}
                                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            >
                                <option value="live">Live</option>
                                <option value="development">Development</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-900">Launch Phase</h4>
                                <p className="text-xs text-gray-600 mt-1">Controls when upgrade plans are visible to customers.</p>
                            </div>
                            <select
                                id="launchPhase"
                                name="launchPhase"
                                value={formData.launchPhase}
                                onChange={handleChange}
                                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            >
                                <option value="prelaunch">Prelaunch</option>
                                <option value="launched">Launched</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900">Maintenance</h4>
                            <p className="text-xs text-gray-600 mt-1">Configure scheduled maintenance, topbar notice, and access allowlist.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={!!formData.maintenanceMode}
                                onChange={handleToggle('maintenanceMode')}
                            />
                            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                        </label>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label htmlFor="maintenanceWindowStartAt" className="block text-sm font-medium text-gray-700 mb-2">
                                Scheduled Start (optional)
                            </label>
                            <input
                                type="datetime-local"
                                id="maintenanceWindowStartAt"
                                value={toDateTimeLocalValue(formData.maintenanceWindowStartAt)}
                                onChange={handleDateTimeLocalChange('maintenanceWindowStartAt')}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="maintenanceWindowEndAt" className="block text-sm font-medium text-gray-700 mb-2">
                                Scheduled End (optional)
                            </label>
                            <input
                                type="datetime-local"
                                id="maintenanceWindowEndAt"
                                value={toDateTimeLocalValue(formData.maintenanceWindowEndAt)}
                                onChange={handleDateTimeLocalChange('maintenanceWindowEndAt')}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            />
                        </div>
                    </div>

                    <div className="mt-4">
                        <label htmlFor="maintenanceAllowedIps" className="block text-sm font-medium text-gray-700 mb-2">
                            Allowed IPs (bypass maintenance)
                        </label>
                        <textarea
                            id="maintenanceAllowedIps"
                            name="maintenanceAllowedIps"
                            value={formData.maintenanceAllowedIps}
                            onChange={(e) => setFormData(prev => ({ ...prev, maintenanceAllowedIps: e.target.value }))}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm bg-white"
                            rows={4}
                            placeholder="One IP per line (or comma separated)"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            During maintenance mode or during the scheduled window, only these IPs can access the site.
                        </p>
                    </div>

                    <div className="mt-4 border-t border-gray-200 pt-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h5 className="text-sm font-semibold text-gray-900">Topbar Notice</h5>
                                <p className="text-xs text-gray-600 mt-1">Shows a banner before the scheduled start. It highlights 15 minutes before start.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={!!formData.maintenanceNoticeEnabled}
                                    onChange={handleToggle('maintenanceNoticeEnabled')}
                                />
                                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                        </div>

                        <div className="mt-3">
                            <label htmlFor="maintenanceNoticeMessage" className="block text-sm font-medium text-gray-700 mb-2">
                                Notice Message
                            </label>
                            <input
                                type="text"
                                id="maintenanceNoticeMessage"
                                name="maintenanceNoticeMessage"
                                value={formData.maintenanceNoticeMessage}
                                onChange={handleChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                                placeholder="Example: Site will be under maintenance tomorrow at 10:00 AM"
                            />
                        </div>
                    </div>

                    <div className="mt-4">
                        <label htmlFor="maintenanceMessage" className="block text-sm font-medium text-gray-700 mb-2">
                            Maintenance Page Message
                        </label>
                        <textarea
                            id="maintenanceMessage"
                            name="maintenanceMessage"
                            value={formData.maintenanceMessage}
                            onChange={(e) => setFormData(prev => ({ ...prev, maintenanceMessage: e.target.value }))}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            rows={3}
                            placeholder="We’re doing some maintenance right now. Please check back shortly."
                        />
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                    >
                        {saving ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Saving...</span>
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4" />
                                <span>Save Settings</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default GeneralSettings;
