/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
  ResolvedTheme,
} from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';

const MAX_ITEMS_PER_PAGE = 25;
const quotaNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const formatWholeNumber = (value: number): string => quotaNumberFormatter.format(Math.round(value));

const formatPercentSummary = (value: number): string => `${formatWholeNumber(value)}%`;

const sumPositive = (values: Array<number | null | undefined>): number => {
  let total = 0;

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += Math.max(0, value);
  }

  return total;
};

const buildQuotaSummary = <TState extends QuotaStatusState>(
  type: QuotaConfig<TState, unknown>['type'],
  quotaEntries: Record<string, TState>
): string | null => {
  switch (type) {
    case 'antigravity': {
      const groups = Object.values(quotaEntries as unknown as Record<string, AntigravityQuotaState>)
        .filter((entry) => entry.status === 'success')
        .flatMap((entry) => entry.groups ?? []);

      if (groups.length === 0) return null;

      const remainingPercentTotal = sumPositive(
        groups.map((group) => Math.max(0, Math.min(1, group.remainingFraction)) * 100)
      );
      return formatPercentSummary(remainingPercentTotal);
    }
    case 'claude': {
      const windows = Object.values(quotaEntries as unknown as Record<string, ClaudeQuotaState>)
        .filter((entry) => entry.status === 'success')
        .flatMap((entry) => entry.windows ?? []);

      if (windows.length === 0) return null;

      const remainingPercentTotal = sumPositive(
        windows.map((window) => {
          const usedPercent = window.usedPercent;
          if (usedPercent === null || usedPercent === undefined) return 0;
          return Math.max(0, 100 - Math.min(100, usedPercent));
        })
      );
      return formatPercentSummary(remainingPercentTotal);
    }
    case 'codex': {
      const windows = Object.values(quotaEntries as unknown as Record<string, CodexQuotaState>)
        .filter((entry) => entry.status === 'success')
        .flatMap((entry) => entry.windows ?? []);

      if (windows.length === 0) return null;

      const remainingPercentTotal = sumPositive(
        windows.map((window) => {
          const usedPercent = window.usedPercent;
          if (usedPercent === null || usedPercent === undefined) return 0;
          return Math.max(0, 100 - Math.min(100, usedPercent));
        })
      );
      return formatPercentSummary(remainingPercentTotal);
    }
    case 'gemini-cli': {
      const buckets = Object.values(quotaEntries as unknown as Record<string, GeminiCliQuotaState>)
        .filter((entry) => entry.status === 'success')
        .flatMap((entry) => entry.buckets ?? []);

      if (buckets.length === 0) return null;

      const hasAbsoluteAmount = buckets.every(
        (bucket) => bucket.remainingAmount !== null && bucket.remainingAmount !== undefined
      );

      if (hasAbsoluteAmount) {
        const totalAmount = sumPositive(buckets.map((bucket) => bucket.remainingAmount));
        return formatWholeNumber(totalAmount);
      }

      const remainingPercentTotal = sumPositive(
        buckets.map((bucket) => {
          const fraction = bucket.remainingFraction;
          if (fraction === null || fraction === undefined) return 0;
          return Math.max(0, Math.min(1, fraction)) * 100;
        })
      );
      return formatPercentSummary(remainingPercentTotal);
    }
    case 'kimi': {
      const rows = Object.values(quotaEntries as unknown as Record<string, KimiQuotaState>)
        .filter((entry) => entry.status === 'success')
        .flatMap((entry) => entry.rows ?? []);

      if (rows.length === 0) return null;

      const remainingTotal = sumPositive(
        rows.map((row) => {
          if (row.limit <= 0) return row.used > 0 ? 0 : row.limit;
          return row.limit - row.used;
        })
      );
      return formatWholeNumber(remainingTotal);
    }
    default:
      return null;
  }
};

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
  refreshConcurrency?: number;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
  refreshConcurrency
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  /* Removed useRef */
  const [columns, gridRef] = useGridColumns(380); // Min card width 380px matches SCSS
  const [viewMode, setViewMode] = useState<ViewMode>('paged');

  const filteredFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [
    files,
    config
  ]);
  const effectiveViewMode: ViewMode = viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading
  } = useQuotaPagination(filteredFiles);

  // Update page size based on view mode and columns
  useEffect(() => {
    if (effectiveViewMode === 'all') {
      setPageSize(Math.max(1, filteredFiles.length));
    } else {
      // Paged mode: 3 rows * columns, capped to avoid oversized pages.
      setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, columns, filteredFiles.length, setPageSize]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    if (targets.length === 0) return;
    loadQuota(targets, scope, setLoading, refreshConcurrency);
  }, [loading, effectiveViewMode, filteredFiles, pageItems, loadQuota, setLoading, refreshConcurrency]);

  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      filteredFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [filteredFiles, loading, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState()
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data)
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status)
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>
          {filteredFiles.length}
        </span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const quotaSummary = useMemo(() => buildQuotaSummary(config.type, quota), [config.type, quota]);

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('all')}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          {quotaSummary !== null && (
            <div className={styles.quotaSummary}>
              <span className={styles.quotaSummaryLabel}>
                {t('quota_management.remaining_total')}
              </span>
              <span className={styles.quotaSummaryValue}>{quotaSummary}</span>
            </div>
          )}
          <div ref={gridRef} className={config.gridClassName}>
            {pageItems.map((item) => (
              <QuotaCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                i18nPrefix={config.i18nPrefix}
                cardIdleMessageKey={config.cardIdleMessageKey}
                cardClassName={config.cardClassName}
                defaultType={config.type}
                canRefresh={!disabled && !item.disabled}
                onRefresh={() => void refreshQuotaForFile(item)}
                renderQuotaItems={config.renderQuotaItems}
              />
            ))}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
