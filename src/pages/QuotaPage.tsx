/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

const DEFAULT_REFRESH_CONCURRENCY = 4;
const MIN_REFRESH_CONCURRENCY = 1;
const MAX_REFRESH_CONCURRENCY = 32;

const clampRefreshConcurrency = (value: number): number =>
  Math.max(MIN_REFRESH_CONCURRENCY, Math.min(MAX_REFRESH_CONCURRENCY, value));

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [refreshConcurrencyText, setRefreshConcurrencyText] = useLocalStorage(
    'quotaPage.refreshConcurrency',
    String(DEFAULT_REFRESH_CONCURRENCY)
  );

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const refreshConcurrency = useMemo(() => {
    const parsed = Number(refreshConcurrencyText);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_REFRESH_CONCURRENCY;
    }

    return clampRefreshConcurrency(Math.floor(parsed));
  }, [refreshConcurrencyText]);

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderTop}>
          <div className={styles.pageHeaderCopy}>
            <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
            <p className={styles.description}>{t('quota_management.description')}</p>
          </div>
          <div className={styles.pageHeaderSettings}>
            <div className={styles.settingField}>
              <label className={styles.settingLabel} htmlFor="quota-refresh-concurrency">
                {t('quota_management.refresh_concurrency_label')}
              </label>
              <input
                id="quota-refresh-concurrency"
                className={styles.settingInput}
                type="number"
                min={MIN_REFRESH_CONCURRENCY}
                max={MAX_REFRESH_CONCURRENCY}
                step={1}
                inputMode="numeric"
                value={refreshConcurrencyText}
                onChange={(event) => setRefreshConcurrencyText(event.currentTarget.value)}
                disabled={disableControls}
              />
              <div className={styles.settingHint}>
                {t('quota_management.refresh_concurrency_hint', {
                  min: MIN_REFRESH_CONCURRENCY,
                  max: MAX_REFRESH_CONCURRENCY,
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        refreshConcurrency={refreshConcurrency}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        refreshConcurrency={refreshConcurrency}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        refreshConcurrency={refreshConcurrency}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        refreshConcurrency={refreshConcurrency}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
        refreshConcurrency={refreshConcurrency}
      />
    </div>
  );
}
