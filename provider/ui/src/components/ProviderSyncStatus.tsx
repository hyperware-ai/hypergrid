import React, { useState, useEffect, useCallback } from 'react';
import { ProviderSyncStatus } from '../types/hypergrid_provider';
import { getProviderSyncStatusApi } from '../utils/api';
import FloatingNotification from './FloatingNotification';

interface ProviderSyncStatusProps {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

const ProviderSyncStatusComponent: React.FC<ProviderSyncStatusProps> = ({ 
  autoRefresh = true, 
  refreshInterval = 30000 // 30 seconds
}) => {
  const [syncStatus, setSyncStatus] = useState<ProviderSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getProviderSyncStatusApi();
      setSyncStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sync status');
      console.error('Failed to fetch sync status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchSyncStatus();

    // Set up polling if autoRefresh is enabled
    if (autoRefresh) {
      const interval = setInterval(fetchSyncStatus, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchSyncStatus, autoRefresh, refreshInterval]);

  const handleManualRefresh = () => {
    fetchSyncStatus();
  };

  // Don't show anything while loading initially or if synchronized
  if ((!syncStatus && loading) || (syncStatus && syncStatus.is_synchronized)) {
    return null;
  }

  // Determine display state
  const hasError = !!error;
  const hasIssues = syncStatus && syncStatus.has_issues;
  const shouldShow = hasError || hasIssues;

  if (!shouldShow) {
    return null;
  }

  // Prepare notification props
  const notificationType = hasError ? 'error' : 'warning';
  const title = hasError ? 'Sync Failed' : 'Synchronization Issues';
  const subtitle = hasError 
    ? 'Click to retry' 
    : `${syncStatus?.missing_from_index.length || 0} missing, ${syncStatus?.mismatched.length || 0} mismatched`;
  const retryTooltip = hasError 
    ? "Click to retry sync status check" 
    : "Click to refresh sync status";

  return (
    <FloatingNotification
      type={notificationType}
      title={title}
      subtitle={subtitle}
      loading={loading}
      onRetry={handleManualRefresh}
      className="sync-notification"
      show={shouldShow}
      retryTooltip={retryTooltip}
    />
  );
};

export default ProviderSyncStatusComponent;