/**
 * StatusBar — bottom bar: the app version and everything about updates on the
 * left, device counts on the right.
 *
 * The version is a button: clicking it checks for an update now. The result
 * appears right beside it — a spinner while checking, "Up to date" or
 * "Couldn't check" briefly after a manual check, or the update badge. The badge
 * installs in place for installed builds (NSIS/MSI) with progress shown in the
 * same spot, or opens the GitHub release page for portable builds. Keeping all
 * of it beside the version means the thing you click and what it tells you are
 * in one place.
 */

import type { Component } from 'solid-js';
import { Show, Switch, Match, createSignal, onCleanup } from 'solid-js';
import { counts, state, showProblemsOnly, setShowProblemsOnly } from '~/lib/device-store';
import {
  currentVersion,
  latestVersion,
  updateAvailable,
  canAutoUpdate,
  updateProgress,
  checking,
  lastCheck,
  checkForUpdates,
  openReleasePage,
  installUpdate,
} from '~/lib/updater';
import { shortAge } from '~/lib/connection-time';
import { useNow } from '~/lib/clock';
import Tooltip from './Tooltip';

/** How long a manual check's "Up to date" / "Couldn't check" stays up. */
const NOTICE_MS = 5000;

const Spinner: Component = () => (
  <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const DownloadIcon: Component = () => (
  <svg
    class="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 5v14" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const BADGE =
  'update-badge inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';

const StatusBar: Component = () => {
  const now = useNow();

  // Feedback for a check the user asked for. Periodic background checks stay
  // silent unless they find something (the badge).
  const [notice, setNotice] = createSignal<'current' | 'failed' | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(noticeTimer));

  const checkNow = async () => {
    if (updateProgress()) return;
    clearTimeout(noticeTimer);
    setNotice(null);
    const outcome = await checkForUpdates();
    if (outcome === 'current' || outcome === 'failed') {
      setNotice(outcome);
      noticeTimer = setTimeout(() => setNotice(null), NOTICE_MS);
    }
  };

  const versionTip = () => {
    if (checking()) return 'Checking for updates…';
    const last = lastCheck();
    const when = last
      ? ` (last checked ${last.at > now() - 60_000 ? 'just now' : `${shortAge(now() - last.at)} ago`})`
      : '';
    return `Check for updates${when}`;
  };

  return (
    <div class="h-7 px-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
      {/* Left: the version, and everything about updates right beside it */}
      <div class="flex items-center gap-2">
        <Tooltip text={versionTip()} placement="top" align="left">
          <button
            class="text-xs text-gray-400 dark:text-gray-500 rounded px-1 -mx-1 py-0.5 -my-0.5 hover:text-gray-600 hover:bg-gray-200/70 dark:hover:text-gray-300 dark:hover:bg-gray-700/50 transition-colors cursor-pointer disabled:cursor-default"
            onClick={checkNow}
            disabled={checking() || updateProgress() !== null}
            aria-label="Check for updates"
          >
            PlugSight
            <Show when={currentVersion()}>
              <span class="ml-1 tabular-nums">v{currentVersion()}</span>
            </Show>
          </button>
        </Tooltip>

        <Switch>
          {/* Download/install in progress */}
          <Match when={updateProgress()}>
            {progress => (
              <span class={BADGE}>
                <Spinner />
                <Show when={progress().phase === 'downloading'} fallback={<span>Installing…</span>}>
                  <span>
                    Downloading {latestVersion()}
                    {progress().percent != null ? ` ${progress().percent}%` : '…'}
                  </span>
                </Show>
              </span>
            )}
          </Match>

          {/* Update available — installs in place (installed builds) */}
          <Match when={updateAvailable() && canAutoUpdate()}>
            <Tooltip text={`Download and install ${latestVersion()}, then restart`} placement="top" align="left">
              <button
                class={`${BADGE} hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer`}
                onClick={installUpdate}
              >
                <DownloadIcon />
                <span>Update to {latestVersion()}</span>
              </button>
            </Tooltip>
          </Match>

          {/* Update available — opens the release page (portable builds) */}
          <Match when={updateAvailable() && !canAutoUpdate()}>
            <Tooltip text={`Open the ${latestVersion()} release page to download it`} placement="top" align="left">
              <button
                class={`${BADGE} hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors cursor-pointer`}
                onClick={openReleasePage}
              >
                <DownloadIcon />
                <span>{latestVersion()} available</span>
              </button>
            </Tooltip>
          </Match>

          <Match when={checking()}>
            <span class="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <Spinner />
              Checking…
            </span>
          </Match>

          <Match when={notice() === 'current'}>
            <span class="text-xs text-gray-500 dark:text-gray-400">Up to date</span>
          </Match>

          <Match when={notice() === 'failed'}>
            <span class="text-xs text-amber-600 dark:text-amber-400">Couldn't check for updates</span>
          </Match>
        </Switch>
      </div>

      {/* Right: device counts */}
      <Show when={state.enumerationComplete}>
        <div class="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 tabular-nums">
          <span>{counts().total} devices</span>
          <Show when={counts().problems > 0}>
            <Tooltip
              text={showProblemsOnly() ? 'Show all devices' : 'Show only problem devices'}
              placement="top"
              align="right"
            >
              <button
                class={`font-medium cursor-pointer transition-colors rounded px-1.5 py-0.5 -my-0.5 ${
                  showProblemsOnly()
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                    : 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
                }`}
                onClick={() => setShowProblemsOnly(prev => !prev)}
              >
                {counts().problems} problem{counts().problems !== 1 ? 's' : ''}
              </button>
            </Tooltip>
          </Show>
          <Show when={counts().ghosts > 0}>
            <span class="italic">{counts().ghosts} removed</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default StatusBar;
